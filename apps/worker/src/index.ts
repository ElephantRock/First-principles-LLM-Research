import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import {
  advanceSubmissionTestJob,
  finalizeSubmissionTestJob,
  leaseNextSubmissionTestJob,
  prisma,
  retrySubmissionTestJobAfterInfrastructureFailure,
} from "../../../packages/db/src/index.ts";
import { GitHubAppClient } from "../../../packages/github/src/index.ts";
import { logEvent } from "@fpllm/observability";
import {
  executeSubmissionTest,
  infrastructureFailureCode,
  type WorkerRuntimeConfig,
} from "./runtime";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function positiveIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name}_INVALID`);
  return value;
}

function privateKeyFromEnv(): string {
  return requiredEnv("FPLLM_GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n");
}

function digestPinnedImage(name: string): string {
  const value = requiredEnv(name);
  if (!/@sha256:[0-9a-f]{64}$/i.test(value)) throw new Error(`${name}_MUST_BE_DIGEST_PINNED`);
  return value;
}

const workerId = process.env.FPLLM_WORKER_ID?.trim() || `${hostname()}-${process.pid}`;
const leaseSeconds = positiveIntegerEnv("FPLLM_WORKER_LEASE_SECONDS", 300, 60, 900);
const pollMilliseconds = positiveIntegerEnv("FPLLM_WORKER_POLL_MS", 2_000, 250, 60_000);
const dockerImage = digestPinnedImage("FPLLM_TEST_RUNTIME_IMAGE");
const hiddenEvaluatorImage = digestPinnedImage("FPLLM_HIDDEN_EVALUATOR_IMAGE");

const sourceClient = new GitHubAppClient({
  appId: requiredEnv("FPLLM_GITHUB_APP_ID"),
  privateKey: privateKeyFromEnv(),
});

const runtimeConfig: WorkerRuntimeConfig = {
  publicTestBundleRoot: requiredEnv("FPLLM_PUBLIC_TEST_BUNDLE_ROOT"),
  privateTestBundleRoot: requiredEnv("FPLLM_PRIVATE_TEST_BUNDLE_ROOT"),
  dockerImage,
  hiddenEvaluatorImage,
  dockerBinary: process.env.FPLLM_DOCKER_BINARY?.trim() || "docker",
};
const tempRoot = process.env.FPLLM_WORKER_TEMP_ROOT?.trim();
if (tempRoot) runtimeConfig.tempRoot = tempRoot;

let stopRequested = false;
process.once("SIGTERM", () => { stopRequested = true; });
process.once("SIGINT", () => { stopRequested = true; });

async function processOneSubmissionTest(): Promise<boolean> {
  const leased = await leaseNextSubmissionTestJob({ workerId, leaseSeconds });
  if (!leased) return false;

  logEvent("worker.job.leased", {}, {
    workerId,
    jobId: leased.id,
    testRunId: leased.testRunId,
    attemptCount: leased.attemptCount,
  });

  try {
    const evidence = await executeSubmissionTest({
      payload: leased.payloadJson,
      sourceClient,
      control: {
        async advance(stage) {
          await advanceSubmissionTestJob({
            jobId: leased.id,
            workerId,
            stage,
            leaseSeconds,
          });
          logEvent("worker.job.stage", {}, { workerId, jobId: leased.id, stage });
        },
      },
      config: runtimeConfig,
    });

    const finalized = await finalizeSubmissionTestJob({
      jobId: leased.id,
      workerId,
      evidence,
    });
    logEvent("worker.job.finalized", { submissionId: finalized.submissionId }, {
      workerId,
      jobId: leased.id,
      testRunId: finalized.testRunId,
      state: finalized.state,
      executionId: evidence.executionId,
      stdoutSha256: evidence.stdoutSha256,
      stderrSha256: evidence.stderrSha256,
    });
    return true;
  } catch (error) {
    const failureCode = infrastructureFailureCode(error);
    logEvent("worker.job.execution_error", {}, {
      workerId,
      jobId: leased.id,
      failureCode,
      message: error instanceof Error ? error.message.slice(0, 1000) : "unknown error",
    });

    try {
      const state = await retrySubmissionTestJobAfterInfrastructureFailure({
        jobId: leased.id,
        workerId,
        failureCode,
      });
      logEvent("worker.job.retry_disposition", {}, { workerId, jobId: leased.id, state, failureCode });
    } catch (retryError) {
      logEvent("worker.job.retry_disposition_failed", {}, {
        workerId,
        jobId: leased.id,
        failureCode,
        message: retryError instanceof Error ? retryError.message.slice(0, 1000) : "unknown error",
      });
    }
    return true;
  }
}

async function main(): Promise<void> {
  const runOnce = process.env.FPLLM_WORKER_ONCE === "1";
  logEvent("worker.ready", {}, {
    workerId,
    leaseSeconds,
    pollMilliseconds,
    executionEnabled: true,
    dockerImage,
    hiddenEvaluatorImage,
    hiddenEvaluatorIsolation: "separate-container-unix-socket",
    runOnce,
  });

  do {
    const processed = await processOneSubmissionTest();
    if (runOnce) break;
    if (!processed && !stopRequested) await sleep(pollMilliseconds);
  } while (!stopRequested);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}

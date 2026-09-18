import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SandboxJob } from "@fpllm/test-sandbox";
import {
  advanceSubmissionTestJob,
  createVerifiedExperimentForDemo,
  finalizeSubmissionTestJob,
  getDemoUser,
  prisma,
} from "../../../packages/db/src/index.ts";
import {
  executeSubmissionTest,
  type WorkerSourceClient,
} from "./runtime";

const TEST_BUNDLE_ID = "phase1-causal-attention@1.0";

function sourceClientWithHiddenFailure(failHidden: boolean): WorkerSourceClient {
  const student = new TextEncoder().encode("ATTENTION = 1\n");
  const marker = new TextEncoder().encode("1\n");
  return {
    async repositoryTree() {
      return [
        { path: "student.py", mode: "100644", sha: "a".repeat(40), size: student.byteLength },
        ...(failHidden ? [{ path: "FAIL_HIDDEN", mode: "100644" as const, sha: "b".repeat(40), size: marker.byteLength }] : []),
      ];
    },
    async repositoryBlob(input) {
      if (input.blobSha === "a".repeat(40)) return student;
      if (input.blobSha === "b".repeat(40)) return marker;
      throw new Error("unexpected fixture blob");
    },
  };
}

async function writeFakeDocker(root: string): Promise<string> {
  const executable = join(root, "fake-docker.mjs");
  await writeFile(executable, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
if (args[0] === "kill" || args[0] === "rm") process.exit(0);
const outputMount = args.find((value) => value.startsWith("--mount=type=bind,") && value.includes("target=/output"));
const workspaceMount = args.find((value) => value.startsWith("--mount=type=bind,") && value.includes("target=/workspace"));
if (!outputMount || !workspaceMount) process.exit(81);
const outputMatch = outputMount.match(/source=([^,]+),target=\\/output/);
const workspaceMatch = workspaceMount.match(/source=([^,]+),target=\\/workspace/);
if (!outputMatch || !workspaceMatch) process.exit(82);
const visibilityIndex = args.indexOf("--visibility");
const bundleIndex = args.indexOf("--bundle-id");
if (visibilityIndex < 0 || bundleIndex < 0) process.exit(83);
const visibility = args[visibilityIndex + 1];
const testBundleId = args[bundleIndex + 1];
const failHidden = fs.existsSync(path.join(workspaceMatch[1], "FAIL_HIDDEN"));
const ids = visibility === "public"
  ? ["attention.shape", "attention.causal", "attention.gqa_equivalence", "attention.gradients"]
  : ["attention.randomized_numerics", "attention.no_permanent_kv_repeat"];
const results = ids.map((invariantId) => ({
  groupId: invariantId.split(".").at(-1),
  invariantId,
  passed: !(failHidden && invariantId === "attention.no_permanent_kv_repeat"),
  summary: failHidden && invariantId === "attention.no_permanent_kv_repeat" ? "fixture hidden failure" : "fixture passed",
  evidence: { protocolFixture: true },
}));
fs.writeFileSync(path.join(outputMatch[1], visibility + ".json"), JSON.stringify({ schemaVersion: "1", testBundleId, results }));
console.log("phase=" + visibility);
`);
  await chmod(executable, 0o755);
  return executable;
}

async function createLeasedFixture(input: { commitSha: string; workerId: string }) {
  const user = await getDemoUser();
  const [repository, courseVersion] = await Promise.all([
    prisma.repository.findFirstOrThrow({ where: { userId: user.id } }),
    prisma.courseVersion.findFirstOrThrow({ where: { courseId: "first-principles-llm-research", version: "1.0" } }),
  ]);
  const submission = await prisma.submission.create({
    data: {
      userId: user.id,
      repositoryId: repository.id,
      courseVersionId: courseVersion.id,
      labId: "phase1-causal-attention-lab",
      labVersion: "1.0",
      branch: "worker-integration-fixture",
      commitSha: input.commitSha,
      state: "submitted",
    },
  });
  const testRun = await prisma.testRun.create({
    data: { submissionId: submission.id, state: "queued" },
  });
  const payload: SandboxJob = {
    schemaVersion: "1",
    submissionId: submission.id,
    testRunId: testRun.id,
    source: {
      provider: "github",
      installationId: "fixture-installation",
      repositoryId: null,
      owner: "fixture",
      name: "learner-repository",
      commitSha: submission.commitSha,
    },
    testBundleId: TEST_BUNDLE_ID,
    execution: {
      timeoutSeconds: 10,
      cpuLimit: 2,
      memoryMiB: 4096,
      pidsLimit: 256,
      networkEnabled: false,
    },
  };
  const job = await prisma.job.create({
    data: {
      jobType: "submission_test",
      state: "leased",
      payloadJson: JSON.parse(JSON.stringify(payload)),
      testRunId: testRun.id,
      attemptCount: 1,
      leaseOwner: input.workerId,
      leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
      startedAt: new Date(),
    },
  });
  return { user, submission, testRun, job, payload };
}

async function cleanupFixture(input: {
  submissionId: string;
  testRunId: string;
  jobId: string;
  experimentId?: string;
}) {
  if (input.experimentId) await prisma.experiment.delete({ where: { id: input.experimentId } }).catch(() => undefined);
  await prisma.masteryEvidence.deleteMany({
    where: {
      evidenceRef: {
        in: [input.submissionId, `${input.testRunId}:public`, `${input.testRunId}:hidden`],
      },
    },
  });
  await prisma.job.delete({ where: { id: input.jobId } }).catch(() => undefined);
  await prisma.testResult.deleteMany({ where: { testRunId: input.testRunId } });
  await prisma.testRun.delete({ where: { id: input.testRunId } }).catch(() => undefined);
  await prisma.submission.delete({ where: { id: input.submissionId } }).catch(() => undefined);
}

async function runFixture(input: { failHidden: boolean; commitSha: string; workerId: string }) {
  const root = await mkdtemp(join(tmpdir(), "fpllm-worker-db-integration-"));
  const bundleRoot = join(root, "bundles");
  const scratch = join(root, "scratch");
  await mkdir(join(bundleRoot, TEST_BUNDLE_ID), { recursive: true });
  await mkdir(scratch, { recursive: true });
  await writeFile(join(bundleRoot, TEST_BUNDLE_ID, "runner.py"), "# protocol fixture only\n");
  const fakeDocker = await writeFakeDocker(root);
  const fixture = await createLeasedFixture({ commitSha: input.commitSha, workerId: input.workerId });
  return {
    root,
    fixture,
    evidence: await executeSubmissionTest({
      payload: fixture.payload,
      sourceClient: sourceClientWithHiddenFailure(input.failHidden),
      control: {
        async advance(stage) {
          await advanceSubmissionTestJob({
            jobId: fixture.job.id,
            workerId: input.workerId,
            stage,
            leaseSeconds: 300,
          });
        },
      },
      config: {
        privateTestBundleRoot: bundleRoot,
        dockerImage: "fpllm/test-runtime@sha256:" + "c".repeat(64),
        dockerBinary: fakeDocker,
        tempRoot: scratch,
      },
    }),
  };
}

test("worker runtime -> persisted passing evidence -> verified experiment", async () => {
  const workerId = `worker-integration-pass-${Date.now()}`;
  const run = await runFixture({ failHidden: false, commitSha: "3333333333333333333333333333333333333333", workerId });
  let experimentId: string | undefined;
  try {
    const finalized = await finalizeSubmissionTestJob({
      jobId: run.fixture.job.id,
      workerId,
      evidence: run.evidence,
    });
    assert.equal(finalized.state, "passed");

    const results = await prisma.testResult.findMany({ where: { testRunId: run.fixture.testRun.id } });
    assert.equal(results.length, 6);
    assert.equal(results.every((result) => result.passed), true);
    const evidenceJson = results[0]?.evidenceJson as { stdoutSha256?: string } | null;
    assert.equal(evidenceJson?.stdoutSha256, run.evidence.stdoutSha256);

    const experiment = await createVerifiedExperimentForDemo(run.fixture.submission.id);
    experimentId = experiment.id;
    assert.equal(experiment.commitSha, run.fixture.submission.commitSha);
  } finally {
    await cleanupFixture({
      submissionId: run.fixture.submission.id,
      testRunId: run.fixture.testRun.id,
      jobId: run.fixture.job.id,
      ...(experimentId ? { experimentId } : {}),
    });
    await rm(run.root, { recursive: true, force: true });
  }
});

test("worker runtime -> persisted hidden failure -> experiment blocked", async () => {
  const workerId = `worker-integration-fail-${Date.now()}`;
  const run = await runFixture({ failHidden: true, commitSha: "4444444444444444444444444444444444444444", workerId });
  try {
    const finalized = await finalizeSubmissionTestJob({
      jobId: run.fixture.job.id,
      workerId,
      evidence: run.evidence,
    });
    assert.equal(finalized.state, "failed");

    const failure = await prisma.testResult.findFirstOrThrow({
      where: { testRunId: run.fixture.testRun.id, invariantId: "attention.no_permanent_kv_repeat" },
    });
    assert.equal(failure.passed, false);
    await assert.rejects(createVerifiedExperimentForDemo(run.fixture.submission.id), /SUBMISSION_NOT_VERIFIED/);
  } finally {
    await cleanupFixture({
      submissionId: run.fixture.submission.id,
      testRunId: run.fixture.testRun.id,
      jobId: run.fixture.job.id,
    });
    await rm(run.root, { recursive: true, force: true });
  }
});

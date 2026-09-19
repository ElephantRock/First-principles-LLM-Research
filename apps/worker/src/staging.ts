import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createVerifiedExperimentForDemo,
  createVerifiedSubmissionAndQueueForDemo,
  getDemoUser,
  prisma,
} from "../../../packages/db/src/index.ts";
import { GitHubAppClient } from "../../../packages/github/src/index.ts";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const DIGEST_IMAGE = /@sha256:[0-9a-f]{64}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const TEST_BUNDLE_ID = "phase1-causal-attention@1.0";
const PRIVATE_BUNDLE_COMMITMENT_PATH = "hidden-tests/phase1/causal-attention/private-bundle-commitment.json";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function fullShaEnv(name: string): string {
  const value = requiredEnv(name).toLowerCase();
  if (!FULL_SHA.test(value)) throw new Error(`${name}_MUST_BE_FULL_SHA`);
  return value;
}

function digestImageEnv(name: string): string {
  const value = requiredEnv(name);
  if (!DIGEST_IMAGE.test(value)) throw new Error(`${name}_MUST_BE_DIGEST_PINNED`);
  return value;
}

function privateKeyFromEnv(): string {
  return requiredEnv("GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n");
}

async function loadPrivateEvaluatorCommitment() {
  const configured = process.env.FPLLM_PRIVATE_BUNDLE_COMMITMENT_PATH?.trim() || PRIVATE_BUNDLE_COMMITMENT_PATH;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(configured), "utf8"));
  } catch (error) {
    throw new Error("STAGING_PRIVATE_BUNDLE_COMMITMENT_INVALID", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("STAGING_PRIVATE_BUNDLE_COMMITMENT_INVALID");
  }
  const document = value as Record<string, unknown>;
  const hiddenInvariants = document.hiddenInvariants;
  if (
    document.schemaVersion !== "1" ||
    document.testBundleId !== TEST_BUNDLE_ID ||
    typeof document.privateEvaluatorVersion !== "string" ||
    document.privateEvaluatorVersion.length < 1 ||
    document.archiveFormat !== "tar.gz" ||
    typeof document.archiveSha256 !== "string" ||
    !SHA256_HEX.test(document.archiveSha256) ||
    typeof document.archiveBytes !== "number" ||
    !Number.isSafeInteger(document.archiveBytes) ||
    document.archiveBytes <= 0 ||
    document.adapterInterface !== "causal-attention-v1" ||
    document.memoryTraceSchema !== "2" ||
    !Array.isArray(hiddenInvariants) ||
    hiddenInvariants.length !== 2 ||
    hiddenInvariants[0] !== "attention.randomized_numerics" ||
    hiddenInvariants[1] !== "attention.no_permanent_kv_repeat"
  ) {
    throw new Error("STAGING_PRIVATE_BUNDLE_COMMITMENT_CONTRACT_INVALID");
  }

  return {
    commitmentPath: PRIVATE_BUNDLE_COMMITMENT_PATH,
    privateEvaluatorVersion: document.privateEvaluatorVersion,
    archiveFormat: document.archiveFormat,
    archiveSha256: document.archiveSha256,
    archiveBytes: document.archiveBytes,
    adapterInterface: document.adapterInterface,
    memoryTraceSchema: document.memoryTraceSchema,
    hiddenInvariants: [...hiddenInvariants] as string[],
  };
}

async function runWorkerOnce(label: string): Promise<void> {
  const root = resolve(process.cwd());
  const child = spawn(
    "pnpm",
    ["--dir", "packages/db", "exec", "tsx", "../../apps/worker/src/index.ts"],
    {
      cwd: root,
      shell: false,
      env: {
        ...process.env,
        FPLLM_WORKER_ONCE: "1",
        FPLLM_WORKER_ID: `staging-${label}-${process.pid}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  const append = (current: string, chunk: Buffer | string) =>
    (current + chunk.toString()).slice(-128 * 1024);
  child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });

  const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", resolvePromise);
  });
  if (exitCode !== 0) {
    throw new Error(
      `STAGING_WORKER_FAILED:${label}:${exitCode}\nstdout=${stdout.slice(-4000)}\nstderr=${stderr.slice(-4000)}`,
    );
  }
}

async function bindRepository(input: {
  client: GitHubAppClient;
  installationId: string;
  owner: string;
  repo: string;
  goodSha: string;
  badSha: string;
}) {
  const [good, bad, user] = await Promise.all([
    input.client.resolveRepository({
      installationId: input.installationId,
      owner: input.owner,
      repo: input.repo,
      ref: input.goodSha,
    }),
    input.client.resolveRepository({
      installationId: input.installationId,
      owner: input.owner,
      repo: input.repo,
      ref: input.badSha,
    }),
    getDemoUser(),
  ]);

  if (good.commitSha.toLowerCase() !== input.goodSha) throw new Error("STAGING_GOOD_COMMIT_IDENTITY_MISMATCH");
  if (bad.commitSha.toLowerCase() !== input.badSha) throw new Error("STAGING_BAD_COMMIT_IDENTITY_MISMATCH");
  if (good.repositoryId !== bad.repositoryId) throw new Error("STAGING_FIXTURE_REPOSITORY_MISMATCH");
  if (good.owner !== bad.owner || good.name !== bad.name) throw new Error("STAGING_FIXTURE_REPOSITORY_NAME_MISMATCH");

  const githubInstallationId = BigInt(input.installationId);
  const installation = await prisma.gitHubInstallation.upsert({
    where: { githubInstallationId },
    update: {
      accountLogin: good.owner,
      accountType: "Organization",
      suspendedAt: null,
    },
    create: {
      githubInstallationId,
      accountLogin: good.owner,
      accountType: "Organization",
    },
  });

  const repository = await prisma.repository.upsert({
    where: {
      userId_provider_owner_name: {
        userId: user.id,
        provider: "github",
        owner: good.owner,
        name: good.name,
      },
    },
    update: {
      githubInstallationDbId: installation.id,
      providerRepositoryId: BigInt(good.repositoryId),
      defaultBranch: good.defaultBranch,
    },
    create: {
      userId: user.id,
      githubInstallationDbId: installation.id,
      provider: "github",
      owner: good.owner,
      name: good.name,
      providerRepositoryId: BigInt(good.repositoryId),
      defaultBranch: good.defaultBranch,
    },
  });

  await prisma.repositoryBinding.upsert({
    where: {
      repositoryId_githubInstallationDbId: {
        repositoryId: repository.id,
        githubInstallationDbId: installation.id,
      },
    },
    update: { boundAt: new Date() },
    create: {
      repositoryId: repository.id,
      githubInstallationDbId: installation.id,
    },
  });

  return {
    repository,
    providerRepositoryId: good.repositoryId,
    defaultBranch: good.defaultBranch,
  };
}

async function runSubmissionCase(input: {
  client: GitHubAppClient;
  repositoryDbId: string;
  installationId: string;
  owner: string;
  repo: string;
  commitSha: string;
  label: string;
  expected: "passed" | "failed";
}) {
  const resolved = await input.client.resolveRepository({
    installationId: input.installationId,
    owner: input.owner,
    repo: input.repo,
    ref: input.commitSha,
  });
  if (resolved.commitSha.toLowerCase() !== input.commitSha) {
    throw new Error(`STAGING_COMMIT_IDENTITY_MISMATCH:${input.label}`);
  }

  const queued = await createVerifiedSubmissionAndQueueForDemo({
    repositoryId: input.repositoryDbId,
    branch: `staging-${input.label}`,
    commitSha: resolved.commitSha.toLowerCase(),
    labVersion: "1.0",
  });

  await runWorkerOnce(input.label);

  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: queued.submission.id },
  });
  const testRun = await prisma.testRun.findUniqueOrThrow({
    where: { id: queued.testRun.id },
    include: { results: { orderBy: { invariantId: "asc" } } },
  });
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: queued.job.id },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });

  if (testRun.results.length !== 6) {
    throw new Error(`STAGING_RESULT_COUNT_INVALID:${input.label}:${testRun.results.length}`);
  }
  const firstEvidence = testRun.results[0]?.evidenceJson as { executionId?: unknown; testBundleId?: unknown } | null;
  const executionId = typeof firstEvidence?.executionId === "string" ? firstEvidence.executionId : null;
  if (!executionId) throw new Error(`STAGING_EXECUTION_ID_MISSING:${input.label}`);
  if (firstEvidence?.testBundleId !== TEST_BUNDLE_ID) throw new Error(`STAGING_BUNDLE_IDENTITY_MISMATCH:${input.label}`);

  let experimentUnlocked = false;
  let experimentId: string | null = null;
  let experimentError: string | null = null;
  try {
    const experiment = await createVerifiedExperimentForDemo(submission.id);
    experimentUnlocked = true;
    experimentId = experiment.id;
  } catch (error) {
    experimentError = error instanceof Error ? error.message : "UNKNOWN_EXPERIMENT_ERROR";
  }

  if (input.expected === "passed") {
    if (submission.state !== "passed" || testRun.state !== "passed" || job.state !== "passed") {
      throw new Error(`STAGING_GOOD_STATE_INVALID:${input.label}:${submission.state}:${testRun.state}:${job.state}`);
    }
    if (!testRun.results.every((result) => result.passed)) throw new Error(`STAGING_GOOD_INVARIANT_FAILED:${input.label}`);
    if (!experimentUnlocked || !experimentId) throw new Error(`STAGING_GOOD_EXPERIMENT_BLOCKED:${input.label}:${experimentError ?? "unknown"}`);
  } else {
    if (submission.state !== "needs_revision" || testRun.state !== "failed" || job.state !== "failed") {
      throw new Error(`STAGING_BAD_STATE_INVALID:${input.label}:${submission.state}:${testRun.state}:${job.state}`);
    }
    const hiddenFailure = testRun.results.some((result) => result.visibility === "hidden" && result.passed === false);
    if (!hiddenFailure) throw new Error(`STAGING_BAD_HIDDEN_FAILURE_MISSING:${input.label}`);
    if (experimentUnlocked) throw new Error(`STAGING_BAD_EXPERIMENT_UNLOCKED:${input.label}`);
    if (!experimentError?.includes("SUBMISSION_NOT_VERIFIED")) {
      throw new Error(`STAGING_BAD_EXPERIMENT_ERROR_INVALID:${input.label}:${experimentError ?? "none"}`);
    }
  }

  return {
    label: input.label,
    commitSha: submission.commitSha,
    submissionId: submission.id,
    submissionState: submission.state,
    testRunId: testRun.id,
    testRunState: testRun.state,
    jobId: job.id,
    jobState: job.state,
    executionId,
    testBundleId: TEST_BUNDLE_ID,
    invariantResults: testRun.results.map((result) => ({
      visibility: result.visibility,
      invariantId: result.invariantId,
      passed: result.passed,
    })),
    jobEvents: job.events.map((event: { eventType: string }) => event.eventType),
    experimentUnlocked,
    experimentId,
    experimentError,
  };
}

async function main() {
  const installationId = requiredEnv("FPLLM_STAGING_GITHUB_INSTALLATION_ID");
  if (!/^\d+$/.test(installationId)) throw new Error("FPLLM_STAGING_GITHUB_INSTALLATION_ID_INVALID");
  const owner = requiredEnv("FPLLM_STAGING_REPOSITORY_OWNER");
  const repo = requiredEnv("FPLLM_STAGING_REPOSITORY_NAME");
  const goodSha = fullShaEnv("FPLLM_STAGING_GOOD_SHA");
  const badSha = fullShaEnv("FPLLM_STAGING_BAD_SHA");
  const learnerImage = digestImageEnv("FPLLM_TEST_RUNTIME_IMAGE");
  const evaluatorImage = digestImageEnv("FPLLM_HIDDEN_EVALUATOR_IMAGE");
  requiredEnv("FPLLM_PUBLIC_TEST_BUNDLE_ROOT");
  requiredEnv("FPLLM_PRIVATE_TEST_BUNDLE_ROOT");
  const privateEvaluator = await loadPrivateEvaluatorCommitment();

  const client = new GitHubAppClient({
    appId: requiredEnv("GITHUB_APP_ID"),
    privateKey: privateKeyFromEnv(),
  });

  const binding = await bindRepository({ client, installationId, owner, repo, goodSha, badSha });
  const goodA = await runSubmissionCase({
    client,
    repositoryDbId: binding.repository.id,
    installationId,
    owner,
    repo,
    commitSha: goodSha,
    label: "good-a",
    expected: "passed",
  });
  const goodB = await runSubmissionCase({
    client,
    repositoryDbId: binding.repository.id,
    installationId,
    owner,
    repo,
    commitSha: goodSha,
    label: "good-b",
    expected: "passed",
  });
  const bad = await runSubmissionCase({
    client,
    repositoryDbId: binding.repository.id,
    installationId,
    owner,
    repo,
    commitSha: badSha,
    label: "bad",
    expected: "failed",
  });

  if (goodA.executionId === goodB.executionId) throw new Error("STAGING_REEXECUTION_ID_REUSED");
  if (goodA.submissionId === goodB.submissionId || goodA.testRunId === goodB.testRunId) {
    throw new Error("STAGING_REEXECUTION_EVIDENCE_REUSED");
  }

  const outputPath = resolve(requiredEnv("FPLLM_STAGING_EVIDENCE_PATH"));
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  const document = {
    schemaVersion: "1",
    kind: "fpllm-staging-submission-e2e",
    capturedAt: new Date().toISOString(),
    repository: {
      owner: binding.repository.owner,
      name: binding.repository.name,
      providerRepositoryId: String(binding.providerRepositoryId),
      defaultBranch: binding.defaultBranch,
      installationId,
    },
    runtime: {
      learnerImage,
      hiddenEvaluatorImage: evaluatorImage,
      testBundleId: TEST_BUNDLE_ID,
      adapterInterface: "causal-attention-v1",
      memoryTraceSchema: "2",
      privateEvaluator,
    },
    assertions: {
      privateEvaluatorMatchedPublicCommitment: true,
      githubAppResolvedExactGoodSha: true,
      githubAppResolvedExactBadSha: true,
      goodCommitPassedAndUnlockedExperiment: true,
      badCommitProducedHiddenFailureAndBlockedExperiment: true,
      identicalGoodIdentityReexecutedAsDistinctEvidence: true,
    },
    executions: [goodA, goodB, bad],
  };
  await writeFile(outputPath, JSON.stringify(document, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify({ ok: true, evidencePath: outputPath, assertions: document.assertions }, null, 2) + "\n");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}

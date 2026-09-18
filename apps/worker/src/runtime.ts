import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
  assertSafeRepositoryRelativePath,
  assertSandboxJob,
  buildDockerSandboxArgs,
  type SandboxJob,
} from "@fpllm/test-sandbox";

const MAX_REPOSITORY_ENTRIES = 10_000;
const MAX_REPOSITORY_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_LOG_BYTES = 1024 * 1024;
const DEFAULT_MAX_EVIDENCE_BYTES = 256 * 1024;
const TEST_BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/;

const EXPECTED_INVARIANTS = {
  public: new Set([
    "attention.shape",
    "attention.causal",
    "attention.gqa_equivalence",
    "attention.gradients",
  ]),
  hidden: new Set([
    "attention.randomized_numerics",
    "attention.no_permanent_kv_repeat",
  ]),
} as const;

export type WorkerStage = "preparing" | "running_public" | "running_hidden" | "finalizing";
export type TestVisibility = "public" | "hidden";

export interface RepositoryTreeEntry {
  path: string;
  mode: "100644" | "100755";
  sha: string;
  size: number;
}

export interface WorkerSourceClient {
  repositoryTree(input: {
    installationId: string | number;
    owner: string;
    repo: string;
    commitSha: string;
  }): Promise<readonly RepositoryTreeEntry[]>;
  repositoryBlob(input: {
    installationId: string | number;
    owner: string;
    repo: string;
    blobSha: string;
    expectedSize: number;
  }): Promise<Uint8Array>;
}

export interface WorkerControlPlane {
  advance(stage: WorkerStage): Promise<void>;
}

export interface WorkerInvariantResult {
  visibility: TestVisibility;
  groupId: string;
  invariantId: string;
  passed: boolean;
  summary: string;
  evidence?: unknown;
}

export interface WorkerExecutionEvidence {
  executionId: string;
  testBundleId: string;
  startedAt: string;
  completedAt: string;
  stdoutSha256: string;
  stderrSha256: string;
  results: readonly WorkerInvariantResult[];
}

export interface WorkerRuntimeConfig {
  privateTestBundleRoot: string;
  dockerImage: string;
  dockerBinary?: string;
  tempRoot?: string;
  maxLogBytes?: number;
  maxEvidenceBytes?: number;
}

interface ProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: Buffer;
  stderr: Buffer;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

interface BundleResultDocument {
  schemaVersion: "1";
  testBundleId: string;
  results: Array<{
    groupId: string;
    invariantId: string;
    passed: boolean;
    summary: string;
    evidence?: unknown;
  }>;
}

export class WorkerInfrastructureError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "WorkerInfrastructureError";
  }
}

export function infrastructureFailureCode(error: unknown): string {
  if (error instanceof WorkerInfrastructureError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_:-]{3,160}$/.test(error.message)) return error.message.slice(0, 160);
  return "WORKER_EXECUTION_FAILED";
}

function containedPath(root: string, relativePath: string): string {
  assertSafeRepositoryRelativePath(relativePath);
  const base = resolve(root);
  const candidate = resolve(base, relativePath);
  if (!candidate.startsWith(`${base}${sep}`)) throw new WorkerInfrastructureError("REPOSITORY_PATH_ESCAPE");
  return candidate;
}

export function resolvePrivateTestBundle(root: string, testBundleId: string): string {
  if (!TEST_BUNDLE_ID.test(testBundleId)) throw new WorkerInfrastructureError("TEST_BUNDLE_ID_INVALID");
  const base = resolve(root);
  const candidate = resolve(base, testBundleId);
  if (!candidate.startsWith(`${base}${sep}`)) throw new WorkerInfrastructureError("TEST_BUNDLE_PATH_ESCAPE");
  return candidate;
}

export async function materializeExactCommit(input: {
  job: SandboxJob;
  sourceClient: WorkerSourceClient;
  workspacePath: string;
}): Promise<{ files: number; bytes: number }> {
  assertSandboxJob(input.job);
  await mkdir(input.workspacePath, { recursive: true });

  const tree = await input.sourceClient.repositoryTree({
    installationId: input.job.source.installationId,
    owner: input.job.source.owner,
    repo: input.job.source.name,
    commitSha: input.job.source.commitSha,
  });
  if (tree.length > MAX_REPOSITORY_ENTRIES) throw new WorkerInfrastructureError("REPOSITORY_TREE_TOO_LARGE");

  let totalBytes = 0;
  for (const entry of tree) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new WorkerInfrastructureError("REPOSITORY_BLOB_SIZE_INVALID");
    }
    totalBytes += entry.size;
    if (totalBytes > MAX_REPOSITORY_BYTES) throw new WorkerInfrastructureError("REPOSITORY_BYTES_TOO_LARGE");

    const destination = containedPath(input.workspacePath, entry.path);
    const bytes = await input.sourceClient.repositoryBlob({
      installationId: input.job.source.installationId,
      owner: input.job.source.owner,
      repo: input.job.source.name,
      blobSha: entry.sha,
      expectedSize: entry.size,
    });
    if (bytes.byteLength !== entry.size) throw new WorkerInfrastructureError("REPOSITORY_BLOB_SIZE_MISMATCH");

    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
    if (entry.mode === "100755") await chmod(destination, 0o755);
  }

  return { files: tree.length, bytes: totalBytes };
}

function appendBounded(chunks: Buffer[], currentBytes: number, chunk: Buffer, limit: number) {
  const remaining = Math.max(0, limit - currentBytes);
  if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
  return {
    storedBytes: currentBytes + Math.min(remaining, chunk.byteLength),
    truncated: chunk.byteLength > remaining,
  };
}

export async function runBoundedProcess(input: {
  executable: string;
  args: readonly string[];
  timeoutSeconds: number;
  maxCaptureBytes?: number;
  onTimeout?: () => Promise<void>;
  onStdoutChunk?: (chunk: Buffer) => void;
  onStderrChunk?: (chunk: Buffer) => void;
}): Promise<ProcessResult> {
  const maxCaptureBytes = input.maxCaptureBytes ?? DEFAULT_MAX_LOG_BYTES;
  if (!Number.isInteger(maxCaptureBytes) || maxCaptureBytes < 4096 || maxCaptureBytes > 8 * 1024 * 1024) {
    throw new WorkerInfrastructureError("LOG_CAPTURE_LIMIT_INVALID");
  }
  if (!Number.isFinite(input.timeoutSeconds) || input.timeoutSeconds <= 0 || input.timeoutSeconds > 600) {
    throw new WorkerInfrastructureError("PROCESS_TIMEOUT_INVALID");
  }

  return await new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
    const child = spawn(input.executable, [...input.args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    child.stdout.on("data", (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      input.onStdoutChunk?.(chunk);
      const next = appendBounded(stdoutChunks, stdoutBytes, chunk, maxCaptureBytes);
      stdoutBytes = next.storedBytes;
      stdoutTruncated ||= next.truncated;
    });
    child.stderr.on("data", (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      input.onStderrChunk?.(chunk);
      const next = appendBounded(stderrChunks, stderrBytes, chunk, maxCaptureBytes);
      stderrBytes = next.storedBytes;
      stderrTruncated ||= next.truncated;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      if (input.onTimeout) void input.onTimeout().catch(() => undefined);
    }, Math.ceil(input.timeoutSeconds * 1000));

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new WorkerInfrastructureError("PROCESS_SPAWN_FAILED", error.message));
    });

    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        exitCode,
        timedOut,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        stdoutTruncated,
        stderrTruncated,
      });
    });
  });
}

async function bestEffortDockerCommand(dockerBinary: string, args: readonly string[]): Promise<void> {
  try {
    await runBoundedProcess({ executable: dockerBinary, args, timeoutSeconds: 15, maxCaptureBytes: 64 * 1024 });
  } catch {
    // Cleanup failure is logged by the caller's surrounding infrastructure path.
  }
}

async function loadBundleResult(input: {
  filePath: string;
  visibility: TestVisibility;
  testBundleId: string;
  maxEvidenceBytes: number;
}): Promise<readonly WorkerInvariantResult[]> {
  const file = await stat(input.filePath).catch(() => null);
  if (!file?.isFile()) throw new WorkerInfrastructureError("TEST_BUNDLE_RESULT_MISSING");
  if (file.size <= 0 || file.size > input.maxEvidenceBytes) {
    throw new WorkerInfrastructureError("TEST_BUNDLE_RESULT_SIZE_INVALID");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(input.filePath, "utf8"));
  } catch {
    throw new WorkerInfrastructureError("TEST_BUNDLE_RESULT_JSON_INVALID");
  }
  if (!parsed || typeof parsed !== "object") throw new WorkerInfrastructureError("TEST_BUNDLE_RESULT_INVALID");
  const document = parsed as Partial<BundleResultDocument>;
  if (document.schemaVersion !== "1" || document.testBundleId !== input.testBundleId || !Array.isArray(document.results)) {
    throw new WorkerInfrastructureError("TEST_BUNDLE_RESULT_IDENTITY_INVALID");
  }

  const expected = EXPECTED_INVARIANTS[input.visibility];
  const seen = new Set<string>();
  const normalized: WorkerInvariantResult[] = [];
  for (const item of document.results) {
    if (!item || typeof item !== "object") throw new WorkerInfrastructureError("TEST_RESULT_INVALID");
    const candidate = item as BundleResultDocument["results"][number];
    if (typeof candidate.groupId !== "string" || candidate.groupId.length < 1 || candidate.groupId.length > 120) {
      throw new WorkerInfrastructureError("TEST_RESULT_GROUP_INVALID");
    }
    if (typeof candidate.invariantId !== "string" || !expected.has(candidate.invariantId)) {
      throw new WorkerInfrastructureError("TEST_RESULT_INVARIANT_INVALID");
    }
    if (seen.has(candidate.invariantId)) throw new WorkerInfrastructureError("TEST_RESULT_DUPLICATE_INVARIANT");
    if (typeof candidate.passed !== "boolean") throw new WorkerInfrastructureError("TEST_RESULT_STATUS_INVALID");
    if (typeof candidate.summary !== "string" || candidate.summary.length < 1 || candidate.summary.length > 2000) {
      throw new WorkerInfrastructureError("TEST_RESULT_SUMMARY_INVALID");
    }
    seen.add(candidate.invariantId);
    const base = {
      visibility: input.visibility,
      groupId: candidate.groupId,
      invariantId: candidate.invariantId,
      passed: candidate.passed,
      summary: candidate.summary,
    } as const;
    normalized.push(candidate.evidence === undefined ? base : { ...base, evidence: candidate.evidence });
  }

  if (seen.size !== expected.size || [...expected].some((id) => !seen.has(id))) {
    throw new WorkerInfrastructureError("TEST_RESULT_REQUIRED_INVARIANTS_MISSING");
  }
  return normalized;
}

async function runSandboxPhase(input: {
  job: SandboxJob;
  visibility: TestVisibility;
  workspacePath: string;
  privateBundlePath: string;
  outputPath: string;
  dockerBinary: string;
  dockerImage: string;
  maxLogBytes: number;
  maxEvidenceBytes: number;
  stdoutHash: ReturnType<typeof createHash>;
  stderrHash: ReturnType<typeof createHash>;
}): Promise<readonly WorkerInvariantResult[]> {
  const containerName = `fpllm-${input.job.testRunId.replace(/[^A-Za-z0-9_.-]/g, "-")}-${input.visibility}-${randomUUID().slice(0, 8)}`;
  const outputFileName = `${input.visibility}.json`;
  const outputFilePath = join(input.outputPath, outputFileName);
  await rm(outputFilePath, { force: true });

  const command = [
    "python",
    "/opt/fpllm/tests/runner.py",
    "--bundle-id",
    input.job.testBundleId,
    "--visibility",
    input.visibility,
    "--output",
    `/output/${outputFileName}`,
  ];
  const args = buildDockerSandboxArgs({
    job: input.job,
    mounts: {
      workspaceHostPath: input.workspacePath,
      hiddenTestsHostPath: input.privateBundlePath,
      outputHostPath: input.outputPath,
    },
    image: input.dockerImage,
    command,
    containerName,
  });

  const result = await runBoundedProcess({
    executable: input.dockerBinary,
    args,
    timeoutSeconds: input.job.execution.timeoutSeconds,
    maxCaptureBytes: input.maxLogBytes,
    onStdoutChunk: (chunk) => input.stdoutHash.update(chunk),
    onStderrChunk: (chunk) => input.stderrHash.update(chunk),
    onTimeout: async () => {
      await bestEffortDockerCommand(input.dockerBinary, ["kill", containerName]);
    },
  });
  await bestEffortDockerCommand(input.dockerBinary, ["rm", "-f", containerName]);

  if (result.timedOut) throw new WorkerInfrastructureError("SANDBOX_TIMEOUT");
  if (result.exitCode !== 0) {
    const suffix = result.stderr.toString("utf8").slice(0, 500).replace(/[\r\n]+/g, " ");
    throw new WorkerInfrastructureError("SANDBOX_RUNNER_FAILED", suffix ? `SANDBOX_RUNNER_FAILED: ${suffix}` : "SANDBOX_RUNNER_FAILED");
  }

  return await loadBundleResult({
    filePath: outputFilePath,
    visibility: input.visibility,
    testBundleId: input.job.testBundleId,
    maxEvidenceBytes: input.maxEvidenceBytes,
  });
}

export async function executeSubmissionTest(input: {
  payload: unknown;
  sourceClient: WorkerSourceClient;
  control: WorkerControlPlane;
  config: WorkerRuntimeConfig;
}): Promise<WorkerExecutionEvidence> {
  assertSandboxJob(input.payload);
  const job = input.payload;
  const dockerBinary = input.config.dockerBinary ?? "docker";
  const maxLogBytes = input.config.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
  const maxEvidenceBytes = input.config.maxEvidenceBytes ?? DEFAULT_MAX_EVIDENCE_BYTES;
  if (!Number.isInteger(maxEvidenceBytes) || maxEvidenceBytes < 4096 || maxEvidenceBytes > 2 * 1024 * 1024) {
    throw new WorkerInfrastructureError("EVIDENCE_SIZE_LIMIT_INVALID");
  }

  const executionId = randomUUID();
  const startedAt = new Date().toISOString();
  const root = await mkdtemp(join(input.config.tempRoot ?? tmpdir(), "fpllm-worker-"));
  const workspacePath = join(root, "workspace");
  const outputPath = join(root, "output");
  const privateBundlePath = resolvePrivateTestBundle(input.config.privateTestBundleRoot, job.testBundleId);
  const stdoutHash = createHash("sha256");
  const stderrHash = createHash("sha256");

  try {
    const bundle = await stat(privateBundlePath).catch(() => null);
    if (!bundle?.isDirectory()) throw new WorkerInfrastructureError("PRIVATE_TEST_BUNDLE_NOT_FOUND");

    await mkdir(workspacePath, { recursive: true });
    await mkdir(outputPath, { recursive: true });
    await chmod(outputPath, 0o733);

    await input.control.advance("preparing");
    await materializeExactCommit({ job, sourceClient: input.sourceClient, workspacePath });

    await input.control.advance("running_public");
    const publicResults = await runSandboxPhase({
      job,
      visibility: "public",
      workspacePath,
      privateBundlePath,
      outputPath,
      dockerBinary,
      dockerImage: input.config.dockerImage,
      maxLogBytes,
      maxEvidenceBytes,
      stdoutHash,
      stderrHash,
    });

    await input.control.advance("running_hidden");
    const hiddenResults = await runSandboxPhase({
      job,
      visibility: "hidden",
      workspacePath,
      privateBundlePath,
      outputPath,
      dockerBinary,
      dockerImage: input.config.dockerImage,
      maxLogBytes,
      maxEvidenceBytes,
      stdoutHash,
      stderrHash,
    });

    await input.control.advance("finalizing");
    return {
      executionId,
      testBundleId: job.testBundleId,
      startedAt,
      completedAt: new Date().toISOString(),
      stdoutSha256: stdoutHash.digest("hex"),
      stderrSha256: stderrHash.digest("hex"),
      results: [...publicResults, ...hiddenResults],
    };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

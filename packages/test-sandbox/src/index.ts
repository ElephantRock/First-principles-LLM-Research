export interface SandboxSource {
  provider: "github";
  installationId: string;
  repositoryId: string | null;
  owner: string;
  name: string;
  commitSha: string;
}

export interface SandboxExecutionLimits {
  timeoutSeconds: number;
  cpuLimit: number;
  memoryMiB: number;
  pidsLimit: number;
  networkEnabled: false;
}

export interface SandboxJob {
  schemaVersion: "1";
  submissionId: string;
  testRunId: string;
  source: SandboxSource;
  testBundleId: string;
  execution: SandboxExecutionLimits;
}

export interface SandboxResult {
  jobId: string;
  exitCode: number;
  status: "passed" | "failed" | "infrastructure_error";
  publicSummary: { passed: number; total: number };
  hiddenSummary: { passed: number; total: number };
  invariantFailures: readonly string[];
  startedAt: string;
  completedAt: string;
  stdoutSha256?: string;
  stderrSha256?: string;
}

export interface SandboxMounts {
  workspaceHostPath: string;
  hiddenTestsHostPath: string;
  outputHostPath: string;
}

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

export function assertSandboxJob(value: unknown): asserts value is SandboxJob {
  if (!value || typeof value !== "object") throw new Error("SANDBOX_JOB_INVALID");
  const job = value as Partial<SandboxJob>;
  if (job.schemaVersion !== "1") throw new Error("SANDBOX_JOB_SCHEMA_UNSUPPORTED");
  if (!job.source || job.source.provider !== "github") throw new Error("SANDBOX_SOURCE_UNSUPPORTED");
  if (!FULL_GIT_SHA.test(job.source.commitSha ?? "")) throw new Error("SANDBOX_COMMIT_INVALID");
  if (!job.execution || job.execution.networkEnabled !== false) throw new Error("SANDBOX_NETWORK_MUST_BE_DISABLED");
  if (!Number.isFinite(job.execution.timeoutSeconds) || job.execution.timeoutSeconds <= 0 || job.execution.timeoutSeconds > 600) throw new Error("SANDBOX_TIMEOUT_INVALID");
  if (!Number.isFinite(job.execution.cpuLimit) || job.execution.cpuLimit <= 0 || job.execution.cpuLimit > 8) throw new Error("SANDBOX_CPU_LIMIT_INVALID");
  if (!Number.isInteger(job.execution.memoryMiB) || job.execution.memoryMiB < 256 || job.execution.memoryMiB > 16384) throw new Error("SANDBOX_MEMORY_LIMIT_INVALID");
  if (!Number.isInteger(job.execution.pidsLimit) || job.execution.pidsLimit < 32 || job.execution.pidsLimit > 1024) throw new Error("SANDBOX_PIDS_LIMIT_INVALID");
  if (!job.testBundleId || !job.submissionId || !job.testRunId) throw new Error("SANDBOX_IDENTITY_INCOMPLETE");
}

function safeMountPath(path: string): string {
  if (!path || path.includes(",") || path.includes("\n") || path.includes("\r")) {
    throw new Error("SANDBOX_MOUNT_PATH_INVALID");
  }
  return path;
}

/**
 * Build Docker CLI arguments for the v0.3 worker boundary.
 *
 * This function never invokes a shell and never receives platform secrets.
 * The worker is responsible for materializing the exact commit and hidden-test
 * bundle before calling the container runtime.
 */
export function buildDockerSandboxArgs(input: {
  job: SandboxJob;
  mounts: SandboxMounts;
  image: string;
  command: readonly string[];
}): readonly string[] {
  assertSandboxJob(input.job);
  if (!input.image || input.image.includes("\n") || input.image.includes("\r")) throw new Error("SANDBOX_IMAGE_INVALID");
  if (input.command.length === 0) throw new Error("SANDBOX_COMMAND_REQUIRED");

  const workspace = safeMountPath(input.mounts.workspaceHostPath);
  const hiddenTests = safeMountPath(input.mounts.hiddenTestsHostPath);
  const output = safeMountPath(input.mounts.outputHostPath);
  const limits = input.job.execution;

  return [
    "run",
    "--rm",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    `--pids-limit=${limits.pidsLimit}`,
    `--cpus=${limits.cpuLimit}`,
    `--memory=${limits.memoryMiB}m`,
    "--user=65532:65532",
    "--env=PYTHONDONTWRITEBYTECODE=1",
    "--env=PYTHONHASHSEED=0",
    "--env=TMPDIR=/tmp",
    "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=256m",
    `--mount=type=bind,source=${workspace},target=/workspace,readonly`,
    `--mount=type=bind,source=${hiddenTests},target=/opt/fpllm/tests,readonly`,
    `--mount=type=bind,source=${output},target=/output`,
    "--workdir=/workspace",
    input.image,
    ...input.command,
  ];
}

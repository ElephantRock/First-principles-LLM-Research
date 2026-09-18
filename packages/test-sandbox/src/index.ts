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

export interface PublicTestMounts {
  workspaceHostPath: string;
  publicTestsHostPath: string;
  outputHostPath: string;
}

export interface LearnerProbeMounts {
  workspaceHostPath: string;
  ipcHostPath: string;
}

export interface HiddenEvaluatorMounts {
  hiddenTestsHostPath: string;
  ipcHostPath: string;
  outputHostPath: string;
}

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function assertSafeRepositoryRelativePath(path: string): void {
  if (!path || path.length > 4096) throw new Error("REPOSITORY_PATH_INVALID");
  if (path.startsWith("/") || path.includes("\\") || CONTROL_CHARACTER.test(path)) {
    throw new Error("REPOSITORY_PATH_UNSAFE");
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.length > 255)) {
    throw new Error("REPOSITORY_PATH_UNSAFE");
  }
}

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

function validateContainerInput(input: { image: string; command: readonly string[]; containerName?: string }): void {
  if (!input.image || input.image.includes("\n") || input.image.includes("\r")) throw new Error("SANDBOX_IMAGE_INVALID");
  if (input.command.length === 0) throw new Error("SANDBOX_COMMAND_REQUIRED");
  if (input.containerName !== undefined && !CONTAINER_NAME.test(input.containerName)) {
    throw new Error("SANDBOX_CONTAINER_NAME_INVALID");
  }
}

function isolationArgs(job: SandboxJob, containerName?: string): string[] {
  assertSandboxJob(job);
  const limits = job.execution;
  return [
    "run",
    "--rm",
    ...(containerName ? [`--name=${containerName}`] : []),
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
  ];
}

/** Public test code may share a container with learner code because it contains no private fixtures. */
export function buildPublicTestSandboxArgs(input: {
  job: SandboxJob;
  mounts: PublicTestMounts;
  image: string;
  command: readonly string[];
  containerName?: string;
}): readonly string[] {
  validateContainerInput(input);
  const workspace = safeMountPath(input.mounts.workspaceHostPath);
  const publicTests = safeMountPath(input.mounts.publicTestsHostPath);
  const output = safeMountPath(input.mounts.outputHostPath);
  return [
    ...isolationArgs(input.job, input.containerName),
    `--mount=type=bind,source=${workspace},target=/workspace,readonly`,
    `--mount=type=bind,source=${publicTests},target=/opt/fpllm/tests,readonly`,
    `--mount=type=bind,source=${output},target=/output`,
    "--workdir=/workspace",
    input.image,
    ...input.command,
  ];
}

/**
 * Learner probe sandbox: learner code and a generic probe server only. Hidden
 * test code is structurally absent from this mount namespace.
 */
export function buildLearnerProbeSandboxArgs(input: {
  job: SandboxJob;
  mounts: LearnerProbeMounts;
  image: string;
  command: readonly string[];
  containerName: string;
  detach?: boolean;
}): readonly string[] {
  validateContainerInput(input);
  const workspace = safeMountPath(input.mounts.workspaceHostPath);
  const ipc = safeMountPath(input.mounts.ipcHostPath);
  const base = isolationArgs(input.job, input.containerName);
  if (input.detach) base.splice(2, 0, "-d");
  return [
    ...base,
    `--mount=type=bind,source=${workspace},target=/workspace,readonly`,
    `--mount=type=bind,source=${ipc},target=/run/fpllm-ipc`,
    "--workdir=/workspace",
    input.image,
    ...input.command,
  ];
}

/**
 * Trusted hidden evaluator sandbox: private tests and IPC only. Learner source
 * is structurally absent from this mount namespace; evaluation is black-box
 * over the Unix-socket probe protocol.
 */
export function buildHiddenEvaluatorSandboxArgs(input: {
  job: SandboxJob;
  mounts: HiddenEvaluatorMounts;
  image: string;
  command: readonly string[];
  containerName: string;
}): readonly string[] {
  validateContainerInput(input);
  const hiddenTests = safeMountPath(input.mounts.hiddenTestsHostPath);
  const ipc = safeMountPath(input.mounts.ipcHostPath);
  const output = safeMountPath(input.mounts.outputHostPath);
  return [
    ...isolationArgs(input.job, input.containerName),
    `--mount=type=bind,source=${hiddenTests},target=/opt/fpllm/tests,readonly`,
    `--mount=type=bind,source=${ipc},target=/run/fpllm-ipc`,
    `--mount=type=bind,source=${output},target=/output`,
    "--workdir=/opt/fpllm/tests",
    input.image,
    ...input.command,
  ];
}

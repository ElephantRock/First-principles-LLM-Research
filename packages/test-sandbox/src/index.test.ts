import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeRepositoryRelativePath,
  buildHiddenEvaluatorSandboxArgs,
  buildLearnerProbeSandboxArgs,
  buildPublicTestSandboxArgs,
  type SandboxJob,
} from "@fpllm/test-sandbox";

const job: SandboxJob = {
  schemaVersion: "1",
  submissionId: "01999999-1111-7111-8111-111111111111",
  testRunId: "01999999-2222-7222-8222-222222222222",
  source: {
    provider: "github",
    installationId: "1234",
    repositoryId: "5678",
    owner: "learner",
    name: "fpllm",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
  },
  testBundleId: "phase1-causal-attention@1.0",
  execution: {
    timeoutSeconds: 180,
    cpuLimit: 2,
    memoryMiB: 4096,
    pidsLimit: 256,
    networkEnabled: false,
  },
};

test("public sandbox enforces the minimum isolation contract", () => {
  const args = buildPublicTestSandboxArgs({
    job,
    mounts: {
      workspaceHostPath: "/srv/fpllm/workspace",
      publicTestsHostPath: "/srv/fpllm/public-tests",
      outputHostPath: "/srv/fpllm/output",
    },
    image: "fpllm/test-runtime:dev",
    command: ["python", "/opt/fpllm/tests/runner.py"],
    containerName: "fpllm-run-123",
  });

  assert.ok(args.includes("--name=fpllm-run-123"));
  assert.ok(args.includes("--network=none"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--cap-drop=ALL"));
  assert.ok(args.includes("--security-opt=no-new-privileges"));
  assert.ok(args.includes("--pids-limit=256"));
  assert.ok(args.includes("--cpus=2"));
  assert.ok(args.includes("--memory=4096m"));
  assert.ok(args.includes("--user=65532:65532"));
  assert.ok(args.includes("--mount=type=bind,source=/srv/fpllm/workspace,target=/workspace,readonly"));
  assert.ok(args.includes("--mount=type=bind,source=/srv/fpllm/public-tests,target=/opt/fpllm/tests,readonly"));
  assert.equal(args.some((arg) => arg.includes("DOCKER_HOST")), false);
});

test("hidden evaluation structurally separates learner source from private tests", () => {
  const probe = buildLearnerProbeSandboxArgs({
    job,
    mounts: { workspaceHostPath: "/srv/fpllm/workspace", ipcHostPath: "/srv/fpllm/ipc" },
    image: "fpllm/test-runtime:dev",
    command: ["python", "/opt/fpllm/probe/serve.py", "--socket", "/run/fpllm-ipc/probe.sock"],
    containerName: "fpllm-probe-123",
    detach: true,
  });
  const evaluator = buildHiddenEvaluatorSandboxArgs({
    job,
    mounts: {
      hiddenTestsHostPath: "/srv/fpllm/private-tests",
      ipcHostPath: "/srv/fpllm/ipc",
      outputHostPath: "/srv/fpllm/output",
    },
    image: "fpllm/evaluator:dev",
    command: ["python", "/opt/fpllm/tests/runner.py", "--socket", "/run/fpllm-ipc/probe.sock"],
    containerName: "fpllm-evaluator-123",
  });

  assert.ok(probe.includes("-d"));
  assert.ok(probe.some((arg) => arg.includes("target=/workspace,readonly")));
  assert.equal(probe.some((arg) => arg.includes("/opt/fpllm/tests")), false);
  assert.equal(probe.some((arg) => arg.includes("private-tests")), false);

  assert.ok(evaluator.some((arg) => arg.includes("source=/srv/fpllm/private-tests,target=/opt/fpllm/tests,readonly")));
  assert.equal(evaluator.some((arg) => arg.includes("target=/workspace")), false);
  assert.equal(evaluator.some((arg) => arg.includes("/srv/fpllm/workspace")), false);

  assert.ok(probe.some((arg) => arg.includes("target=/run/fpllm-ipc")));
  assert.ok(evaluator.some((arg) => arg.includes("target=/run/fpllm-ipc")));
  assert.ok(probe.includes("--network=none"));
  assert.ok(evaluator.includes("--network=none"));
});

test("sandbox contract rejects network-enabled jobs", () => {
  assert.throws(
    () => buildPublicTestSandboxArgs({
      job: { ...job, execution: { ...job.execution, networkEnabled: true as false } },
      mounts: {
        workspaceHostPath: "/srv/fpllm/workspace",
        publicTestsHostPath: "/srv/fpllm/public-tests",
        outputHostPath: "/srv/fpllm/output",
      },
      image: "fpllm/test-runtime:dev",
      command: ["python", "/opt/fpllm/tests/runner.py"],
    }),
    /SANDBOX_NETWORK_MUST_BE_DISABLED/,
  );
});

test("sandbox contract rejects unsafe container names", () => {
  assert.throws(
    () => buildPublicTestSandboxArgs({
      job,
      mounts: {
        workspaceHostPath: "/srv/fpllm/workspace",
        publicTestsHostPath: "/srv/fpllm/public-tests",
        outputHostPath: "/srv/fpllm/output",
      },
      image: "fpllm/test-runtime:dev",
      command: ["python", "/opt/fpllm/tests/runner.py"],
      containerName: "bad name;docker",
    }),
    /SANDBOX_CONTAINER_NAME_INVALID/,
  );
});

test("repository materialization accepts ordinary relative paths and rejects traversal/control paths", () => {
  assert.doesNotThrow(() => assertSafeRepositoryRelativePath("src/fpllm/model/attention.py"));
  assert.throws(() => assertSafeRepositoryRelativePath("../hidden-tests/test_attention.py"), /REPOSITORY_PATH_UNSAFE/);
  assert.throws(() => assertSafeRepositoryRelativePath("src/../../etc/passwd"), /REPOSITORY_PATH_UNSAFE/);
  assert.throws(() => assertSafeRepositoryRelativePath("/etc/passwd"), /REPOSITORY_PATH_UNSAFE/);
  assert.throws(() => assertSafeRepositoryRelativePath("src\\escape.py"), /REPOSITORY_PATH_UNSAFE/);
  assert.throws(() => assertSafeRepositoryRelativePath("src/evil\nname.py"), /REPOSITORY_PATH_UNSAFE/);
});

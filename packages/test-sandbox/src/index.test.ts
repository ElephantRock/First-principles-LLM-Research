import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeRepositoryRelativePath,
  buildDockerSandboxArgs,
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

test("Docker sandbox arguments enforce the minimum isolation contract", () => {
  const args = buildDockerSandboxArgs({
    job,
    mounts: {
      workspaceHostPath: "/srv/fpllm/workspace",
      hiddenTestsHostPath: "/srv/fpllm/hidden-tests",
      outputHostPath: "/srv/fpllm/output",
    },
    image: "fpllm/test-runtime:dev",
    command: ["python", "-m", "pytest", "/opt/fpllm/tests"],
  });

  assert.ok(args.includes("--network=none"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--cap-drop=ALL"));
  assert.ok(args.includes("--security-opt=no-new-privileges"));
  assert.ok(args.includes("--pids-limit=256"));
  assert.ok(args.includes("--cpus=2"));
  assert.ok(args.includes("--memory=4096m"));
  assert.ok(args.includes("--user=65532:65532"));
  assert.ok(args.includes("--mount=type=bind,source=/srv/fpllm/workspace,target=/workspace,readonly"));
  assert.ok(args.includes("--mount=type=bind,source=/srv/fpllm/hidden-tests,target=/opt/fpllm/tests,readonly"));
  assert.equal(args.some((arg) => arg.includes("DOCKER_HOST")), false);
});

test("sandbox contract rejects network-enabled jobs", () => {
  assert.throws(
    () => buildDockerSandboxArgs({
      job: { ...job, execution: { ...job.execution, networkEnabled: true as false } },
      mounts: {
        workspaceHostPath: "/srv/fpllm/workspace",
        hiddenTestsHostPath: "/srv/fpllm/hidden-tests",
        outputHostPath: "/srv/fpllm/output",
      },
      image: "fpllm/test-runtime:dev",
      command: ["python", "-m", "pytest"],
    }),
    /SANDBOX_NETWORK_MUST_BE_DISABLED/,
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

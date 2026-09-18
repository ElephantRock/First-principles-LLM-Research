import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SandboxJob } from "@fpllm/test-sandbox";
import {
  executeSubmissionTest,
  materializeExactCommit,
  resolvePrivateTestBundle,
  type WorkerSourceClient,
  type WorkerStage,
} from "./runtime";

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
    timeoutSeconds: 10,
    cpuLimit: 2,
    memoryMiB: 4096,
    pidsLimit: 256,
    networkEnabled: false,
  },
};

const sourceClient: WorkerSourceClient = {
  async repositoryTree() {
    return [
      { path: "src/fpllm/model/attention.py", mode: "100644", sha: "a".repeat(40), size: 14 },
      { path: "scripts/check.sh", mode: "100755", sha: "b".repeat(40), size: 18 },
    ];
  },
  async repositoryBlob(input) {
    if (input.blobSha === "a".repeat(40)) return new TextEncoder().encode("ATTENTION = 1\n");
    if (input.blobSha === "b".repeat(40)) return new TextEncoder().encode("#!/bin/sh\necho ok\n");
    throw new Error("unexpected blob");
  },
};

test("exact-commit materialization writes only bounded manifest files", async () => {
  const root = await mkdtemp(join(tmpdir(), "fpllm-worker-materialize-"));
  try {
    const result = await materializeExactCommit({ job, sourceClient, workspacePath: root });
    assert.deepEqual(result, { files: 2, bytes: 32 });
    assert.equal(await readFile(join(root, "src/fpllm/model/attention.py"), "utf8"), "ATTENTION = 1\n");
    assert.equal(await readFile(join(root, "scripts/check.sh"), "utf8"), "#!/bin/sh\necho ok\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private test bundle resolution rejects path escape attempts", () => {
  assert.equal(resolvePrivateTestBundle("/srv/fpllm/bundles", job.testBundleId), "/srv/fpllm/bundles/phase1-causal-attention@1.0");
  assert.throws(() => resolvePrivateTestBundle("/srv/fpllm/bundles", "../secrets"), /TEST_BUNDLE_ID_INVALID/);
});

test("worker executes public tests then split hidden evaluator without co-mounting secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "fpllm-worker-runtime-test-"));
  const publicBundleRoot = join(root, "public-bundles");
  const privateBundleRoot = join(root, "private-bundles");
  const publicBundlePath = join(publicBundleRoot, job.testBundleId);
  const privateBundlePath = join(privateBundleRoot, job.testBundleId);
  const scratch = join(root, "scratch");
  const fakeDocker = join(root, "fake-docker.mjs");
  const callsLog = join(root, "docker-calls.jsonl");
  await mkdir(publicBundlePath, { recursive: true });
  await mkdir(privateBundlePath, { recursive: true });
  await mkdir(scratch, { recursive: true });
  await writeFile(join(publicBundlePath, "runner.py"), "# public runner fixture\n");
  await writeFile(join(privateBundlePath, "runner.py"), "# private evaluator fixture\n");
  await writeFile(fakeDocker, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsLog)}, JSON.stringify(args) + "\\n");
if (args[0] === "kill" || args[0] === "rm") process.exit(0);
if (args.includes("-d")) {
  const ipcMount = args.find((value) => value.startsWith("--mount=type=bind,") && value.includes("target=/run/fpllm-ipc"));
  if (!ipcMount) process.exit(84);
  const match = ipcMount.match(/source=([^,]+),target=\\/run\\/fpllm-ipc/);
  if (!match) process.exit(85);
  fs.writeFileSync(path.join(match[1], "probe.ready"), "ready\\n");
  console.log("fixture-probe-container");
  process.exit(0);
}
const outputMount = args.find((value) => value.startsWith("--mount=type=bind,") && value.includes("target=/output"));
if (!outputMount) process.exit(81);
const match = outputMount.match(/source=([^,]+),target=\\/output/);
if (!match) process.exit(82);
const visibilityIndex = args.indexOf("--visibility");
const bundleIndex = args.indexOf("--bundle-id");
if (visibilityIndex < 0 || bundleIndex < 0) process.exit(83);
const visibility = args[visibilityIndex + 1];
const testBundleId = args[bundleIndex + 1];
if (visibility === "hidden" && args.some((value) => value.includes("target=/workspace"))) process.exit(86);
const ids = visibility === "public"
  ? ["attention.shape", "attention.causal", "attention.gqa_equivalence", "attention.gradients"]
  : ["attention.randomized_numerics", "attention.no_permanent_kv_repeat"];
const results = ids.map((invariantId) => ({ groupId: invariantId.split(".").at(-1), invariantId, passed: true, summary: "fixture passed" }));
fs.writeFileSync(path.join(match[1], visibility + ".json"), JSON.stringify({ schemaVersion: "1", testBundleId, results }));
console.log("completed:" + visibility);
`);
  await chmod(fakeDocker, 0o755);

  const stages: WorkerStage[] = [];
  try {
    const evidence = await executeSubmissionTest({
      payload: job,
      sourceClient,
      control: {
        async advance(stage) {
          stages.push(stage);
        },
      },
      config: {
        publicTestBundleRoot: publicBundleRoot,
        privateTestBundleRoot,
        dockerImage: "fpllm/test-runtime@sha256:" + "c".repeat(64),
        hiddenEvaluatorImage: "fpllm/hidden-evaluator@sha256:" + "d".repeat(64),
        dockerBinary: fakeDocker,
        tempRoot: scratch,
        probeReadyTimeoutMs: 2_000,
      },
    });

    assert.deepEqual(stages, ["preparing", "running_public", "running_hidden", "finalizing"]);
    assert.equal(evidence.testBundleId, job.testBundleId);
    assert.equal(evidence.results.length, 6);
    assert.equal(evidence.results.every((result) => result.passed), true);
    assert.match(evidence.stdoutSha256, /^[0-9a-f]{64}$/);
    assert.match(evidence.stderrSha256, /^[0-9a-f]{64}$/);

    const calls = (await readFile(callsLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    const probeCall = calls.find((args) => args.includes("-d"));
    const hiddenCall = calls.find((args) => args.includes("hidden") && args.includes("--visibility"));
    assert.ok(probeCall);
    assert.ok(hiddenCall);
    assert.equal(probeCall.some((arg) => arg.includes("/opt/fpllm/tests")), false);
    assert.equal(probeCall.some((arg) => arg.includes(privateBundlePath)), false);
    assert.equal(hiddenCall.some((arg) => arg.includes("target=/workspace")), false);
    assert.equal(hiddenCall.some((arg) => arg.includes("workspace")), false);
    assert.equal(hiddenCall.some((arg) => arg.includes(privateBundlePath)), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("materialization rejects a repository path traversal before writing", async () => {
  const root = await mkdtemp(join(tmpdir(), "fpllm-worker-traversal-"));
  const maliciousSource: WorkerSourceClient = {
    async repositoryTree() {
      return [{ path: "../escape.py", mode: "100644", sha: "d".repeat(40), size: 1 }];
    },
    async repositoryBlob() {
      return new Uint8Array([1]);
    },
  };
  try {
    await assert.rejects(
      materializeExactCommit({ job, sourceClient: maliciousSource, workspacePath: root }),
      /REPOSITORY_PATH_UNSAFE/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

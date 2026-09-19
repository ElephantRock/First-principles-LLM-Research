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
    provider: "github", installationId: "1234", repositoryId: "5678",
    owner: "learner", name: "fpllm", commitSha: "0123456789abcdef0123456789abcdef01234567",
  },
  testBundleId: "phase1-causal-attention@1.0",
  execution: { timeoutSeconds: 10, cpuLimit: 2, memoryMiB: 4096, pidsLimit: 256, networkEnabled: false },
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

test("exact-commit materialization is bounded and preserves executable mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "fpllm-worker-materialize-"));
  try {
    assert.deepEqual(await materializeExactCommit({ job, sourceClient, workspacePath: root }), { files: 2, bytes: 32 });
    assert.equal(await readFile(join(root, "src/fpllm/model/attention.py"), "utf8"), "ATTENTION = 1\n");
    assert.equal(await readFile(join(root, "scripts/check.sh"), "utf8"), "#!/bin/sh\necho ok\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundle resolution and repository materialization reject traversal", async () => {
  assert.equal(resolvePrivateTestBundle("/srv/fpllm/bundles", job.testBundleId), "/srv/fpllm/bundles/phase1-causal-attention@1.0");
  assert.throws(() => resolvePrivateTestBundle("/srv/fpllm/bundles", "../secrets"), /TEST_BUNDLE_ID_INVALID/);
  const root = await mkdtemp(join(tmpdir(), "fpllm-worker-traversal-"));
  const malicious: WorkerSourceClient = {
    async repositoryTree() { return [{ path: "../escape.py", mode: "100644", sha: "d".repeat(40), size: 1 }]; },
    async repositoryBlob() { return new Uint8Array([1]); },
  };
  try {
    await assert.rejects(materializeExactCommit({ job, sourceClient: malicious, workspacePath: root }), /REPOSITORY_PATH_UNSAFE/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker separates hidden evaluator mounts from learner source", async () => {
  const root = await mkdtemp(join(tmpdir(), "fpllm-worker-runtime-"));
  const publicBundleRoot = join(root, "public");
  const privateBundleRoot = join(root, "private");
  const scratch = join(root, "scratch");
  const fakeDocker = join(root, "fake-docker.mjs");
  const callsLog = join(root, "calls.jsonl");
  for (const bundleRoot of [publicBundleRoot, privateBundleRoot]) {
    await mkdir(join(bundleRoot, job.testBundleId), { recursive: true });
    await writeFile(join(bundleRoot, job.testBundleId, "runner.py"), "# fixture\n");
  }
  await mkdir(scratch, { recursive: true });
  await writeFile(fakeDocker, `#!/usr/bin/env node
import fs from "node:fs"; import path from "node:path";
const a=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(callsLog)},JSON.stringify(a)+"\\n");
if(a[0]==="kill"||a[0]==="rm")process.exit(0);
const src=(target)=>{const m=a.find(x=>x.startsWith("--mount=type=bind,")&&x.includes("target="+target));return m?.match(/source=([^,]+)/)?.[1]??null};
if(a.includes("-d")){const i=src("/run/fpllm-ipc");if(!i)process.exit(80);fs.writeFileSync(path.join(i,"probe.ready"),"ready");console.log("probe");process.exit(0)}
const o=src("/output");const vi=a.indexOf("--visibility"),bi=a.indexOf("--bundle-id");if(!o||vi<0||bi<0)process.exit(81);
const v=a[vi+1],b=a[bi+1];if(v==="hidden"&&src("/workspace"))process.exit(82);
const ids=v==="public"?["attention.shape","attention.causal","attention.gqa_equivalence","attention.gradients"]:["attention.randomized_numerics","attention.no_permanent_kv_repeat"];
fs.writeFileSync(path.join(o,v+".json"),JSON.stringify({schemaVersion:"1",testBundleId:b,results:ids.map(invariantId=>({groupId:invariantId.split(".").at(-1),invariantId,passed:true,summary:"passed"}))}));
console.log(v);
`);
  await chmod(fakeDocker, 0o755);

  const stages: WorkerStage[] = [];
  try {
    const evidence = await executeSubmissionTest({
      payload: job,
      sourceClient,
      control: { async advance(stage) { stages.push(stage); } },
      config: {
        publicTestBundleRoot: publicBundleRoot,
        privateTestBundleRoot: privateBundleRoot,
        dockerImage: "fpllm/test-runtime@sha256:" + "c".repeat(64),
        hiddenEvaluatorImage: "fpllm/hidden-evaluator@sha256:" + "d".repeat(64),
        dockerBinary: fakeDocker,
        tempRoot: scratch,
        probeReadyTimeoutMs: 2_000,
      },
    });
    assert.deepEqual(stages, ["preparing", "running_public", "running_hidden", "finalizing"]);
    assert.equal(evidence.results.length, 6);
    assert.equal(evidence.results.every((result) => result.passed), true);
    assert.match(evidence.stdoutSha256, /^[0-9a-f]{64}$/);

    const calls = (await readFile(callsLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    const probe = calls.find((args) => args.includes("-d"));
    const hidden = calls.find((args) => args.includes("hidden") && args.includes("--visibility"));
    assert.ok(probe && hidden);
    assert.equal(probe.some((arg) => arg.includes(privateBundleRoot) || arg.includes("/opt/fpllm/tests")), false);
    assert.equal(hidden.some((arg) => arg.includes("target=/workspace") || arg.includes(scratch + "/workspace")), false);
    assert.equal(hidden.some((arg) => arg.includes(privateBundleRoot)), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

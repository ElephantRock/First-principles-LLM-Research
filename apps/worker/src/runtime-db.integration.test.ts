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
import { executeSubmissionTest, type WorkerSourceClient } from "./runtime";

const BUNDLE = "phase1-causal-attention@1.0";

function source(failHidden: boolean): WorkerSourceClient {
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

async function fakeDocker(root: string) {
  const file = join(root, "docker.mjs");
  await writeFile(file, `#!/usr/bin/env node
import fs from "node:fs";import path from "node:path";
const a=process.argv.slice(2);if(a[0]==="kill"||a[0]==="rm")process.exit(0);
const src=(t)=>{const m=a.find(x=>x.startsWith("--mount=type=bind,")&&x.includes("target="+t));return m?.match(/source=([^,]+)/)?.[1]??null};
if(a.includes("-d")){const i=src("/run/fpllm-ipc"),w=src("/workspace");if(!i||!w)process.exit(80);fs.writeFileSync(path.join(i,"probe.ready"),"ready");if(fs.existsSync(path.join(w,"FAIL_HIDDEN")))fs.writeFileSync(path.join(i,"fail-hidden"),"1");process.exit(0)}
const o=src("/output"),vi=a.indexOf("--visibility"),bi=a.indexOf("--bundle-id");if(!o||vi<0||bi<0)process.exit(81);const v=a[vi+1],b=a[bi+1];
if(v==="hidden"&&src("/workspace"))process.exit(82);const i=src("/run/fpllm-ipc");const fail=v==="hidden"&&i&&fs.existsSync(path.join(i,"fail-hidden"));
const ids=v==="public"?["attention.shape","attention.causal","attention.gqa_equivalence","attention.gradients"]:["attention.randomized_numerics","attention.no_permanent_kv_repeat"];
fs.writeFileSync(path.join(o,v+".json"),JSON.stringify({schemaVersion:"1",testBundleId:b,results:ids.map(invariantId=>({groupId:invariantId.split(".").at(-1),invariantId,passed:!(fail&&invariantId==="attention.no_permanent_kv_repeat"),summary:fail&&invariantId==="attention.no_permanent_kv_repeat"?"fixture hidden failure":"fixture pass",evidence:{fixture:true}}))}));
`);
  await chmod(file, 0o755);
  return file;
}

async function fixture(commitSha: string, workerId: string) {
  const user = await getDemoUser();
  const [repository, courseVersion] = await Promise.all([
    prisma.repository.findFirstOrThrow({ where: { userId: user.id } }),
    prisma.courseVersion.findFirstOrThrow({ where: { courseId: "first-principles-llm-research", version: "1.0" } }),
  ]);
  const submission = await prisma.submission.create({ data: {
    userId: user.id, repositoryId: repository.id, courseVersionId: courseVersion.id,
    labId: "phase1-causal-attention-lab", labVersion: "1.0", branch: "worker-fixture", commitSha, state: "submitted",
  }});
  const testRun = await prisma.testRun.create({ data: { submissionId: submission.id, state: "queued" } });
  const payload: SandboxJob = {
    schemaVersion: "1", submissionId: submission.id, testRunId: testRun.id,
    source: { provider: "github", installationId: "fixture", repositoryId: null, owner: "fixture", name: "repo", commitSha },
    testBundleId: BUNDLE,
    execution: { timeoutSeconds: 10, cpuLimit: 2, memoryMiB: 4096, pidsLimit: 256, networkEnabled: false },
  };
  const job = await prisma.job.create({ data: {
    jobType: "submission_test", state: "leased", payloadJson: JSON.parse(JSON.stringify(payload)), testRunId: testRun.id,
    attemptCount: 1, leaseOwner: workerId, leaseExpiresAt: new Date(Date.now() + 300_000), startedAt: new Date(),
  }});
  return { user, submission, testRun, job, payload };
}

async function cleanup(f: { submissionId: string; testRunId: string; jobId: string; experimentId?: string }) {
  if (f.experimentId) await prisma.experiment.delete({ where: { id: f.experimentId } }).catch(() => undefined);
  await prisma.masteryEvidence.deleteMany({ where: { evidenceRef: { in: [f.submissionId, `${f.testRunId}:public`, `${f.testRunId}:hidden`] } } });
  await prisma.job.delete({ where: { id: f.jobId } }).catch(() => undefined);
  await prisma.testResult.deleteMany({ where: { testRunId: f.testRunId } });
  await prisma.testRun.delete({ where: { id: f.testRunId } }).catch(() => undefined);
  await prisma.submission.delete({ where: { id: f.submissionId } }).catch(() => undefined);
}

async function run(failHidden: boolean, commitSha: string, workerId: string) {
  const root = await mkdtemp(join(tmpdir(), "fpllm-worker-db-"));
  const publicBundleRoot = join(root, "public");
  const privateBundleRoot = join(root, "private");
  const scratch = join(root, "scratch");
  for (const bundleRoot of [publicBundleRoot, privateBundleRoot]) {
    await mkdir(join(bundleRoot, BUNDLE), { recursive: true });
    await writeFile(join(bundleRoot, BUNDLE, "runner.py"), "# fixture\n");
  }
  await mkdir(scratch, { recursive: true });
  const dockerBinary = await fakeDocker(root);
  const f = await fixture(commitSha, workerId);
  const evidence = await executeSubmissionTest({
    payload: f.payload,
    sourceClient: source(failHidden),
    control: { async advance(stage) { await advanceSubmissionTestJob({ jobId: f.job.id, workerId, stage, leaseSeconds: 300 }); } },
    config: {
      publicTestBundleRoot: publicBundleRoot,
      privateTestBundleRoot: privateBundleRoot,
      dockerImage: "fpllm/test-runtime@sha256:" + "c".repeat(64),
      hiddenEvaluatorImage: "fpllm/hidden-evaluator@sha256:" + "d".repeat(64),
      dockerBinary, tempRoot: scratch, probeReadyTimeoutMs: 2_000,
    },
  });
  return { root, f, evidence };
}

test("split worker runtime persists passing evidence and unlocks a verified experiment", async () => {
  const workerId = `worker-pass-${Date.now()}`;
  const r = await run(false, "3333333333333333333333333333333333333333", workerId);
  let experimentId: string | undefined;
  try {
    const finalized = await finalizeSubmissionTestJob({ jobId: r.f.job.id, workerId, evidence: r.evidence });
    assert.equal(finalized.state, "passed");
    const results = await prisma.testResult.findMany({ where: { testRunId: r.f.testRun.id } });
    assert.equal(results.length, 6);
    assert.equal(results.every((result) => result.passed), true);
    const evidenceJson = results[0]?.evidenceJson as { stdoutSha256?: string } | null;
    assert.equal(evidenceJson?.stdoutSha256, r.evidence.stdoutSha256);
    const experiment = await createVerifiedExperimentForDemo(r.f.submission.id);
    experimentId = experiment.id;
    assert.equal(experiment.commitSha, r.f.submission.commitSha);
  } finally {
    await cleanup({ submissionId: r.f.submission.id, testRunId: r.f.testRun.id, jobId: r.f.job.id, ...(experimentId ? { experimentId } : {}) });
    await rm(r.root, { recursive: true, force: true });
  }
});

test("split worker runtime persists hidden failure and blocks experiments", async () => {
  const workerId = `worker-fail-${Date.now()}`;
  const r = await run(true, "4444444444444444444444444444444444444444", workerId);
  try {
    const finalized = await finalizeSubmissionTestJob({ jobId: r.f.job.id, workerId, evidence: r.evidence });
    assert.equal(finalized.state, "failed");
    const failure = await prisma.testResult.findFirstOrThrow({ where: { testRunId: r.f.testRun.id, invariantId: "attention.no_permanent_kv_repeat" } });
    assert.equal(failure.passed, false);
    await assert.rejects(createVerifiedExperimentForDemo(r.f.submission.id), /SUBMISSION_NOT_VERIFIED/);
  } finally {
    await cleanup({ submissionId: r.f.submission.id, testRunId: r.f.testRun.id, jobId: r.f.job.id });
    await rm(r.root, { recursive: true, force: true });
  }
});

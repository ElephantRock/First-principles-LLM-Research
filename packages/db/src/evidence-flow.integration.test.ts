import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./client";
import { getDemoUser } from "./evidence";
import { finalizeSubmissionTestJob, type SubmissionExecutionEvidence } from "./test-results";
import { createVerifiedExperimentForDemo } from "./verified-experiments";

const TEST_BUNDLE = "phase1-causal-attention@1.0";
const WORKER = "evidence-fixture-worker";

function completeEvidence(overrides?: { failingInvariant?: string }): SubmissionExecutionEvidence {
  const definitions = [
    ["public", "shape", "attention.shape"],
    ["public", "causal", "attention.causal"],
    ["public", "gqa", "attention.gqa_equivalence"],
    ["public", "grad", "attention.gradients"],
    ["hidden", "numerics", "attention.randomized_numerics"],
    ["hidden", "memory", "attention.no_permanent_kv_repeat"],
  ] as const;
  return {
    executionId: `fixture-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    testBundleId: TEST_BUNDLE,
    startedAt: new Date(Date.now() - 250).toISOString(),
    completedAt: new Date().toISOString(),
    stdoutSha256: "a".repeat(64),
    stderrSha256: "b".repeat(64),
    results: definitions.map(([visibility, groupId, invariantId]) => ({
      visibility,
      groupId,
      invariantId,
      passed: invariantId !== overrides?.failingInvariant,
      summary: invariantId === overrides?.failingInvariant ? "Fixture failure." : "Fixture pass.",
      evidence: { fixture: true },
    })),
  };
}

async function createFinalizingFixture(commitSha: string) {
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
      branch: "fixture",
      commitSha,
      state: "submitted",
    },
  });
  const testRun = await prisma.testRun.create({
    data: { submissionId: submission.id, state: "finalizing", startedAt: new Date() },
  });
  const job = await prisma.job.create({
    data: {
      jobType: "submission_test",
      state: "finalizing",
      payloadJson: { testBundleId: TEST_BUNDLE },
      testRunId: testRun.id,
      attemptCount: 1,
      leaseOwner: WORKER,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      startedAt: new Date(),
    },
  });
  return { user, submission, testRun, job };
}

async function cleanupFixture(input: { submissionId: string; testRunId: string; jobId: string; experimentId?: string }) {
  if (input.experimentId) {
    await prisma.experiment.delete({ where: { id: input.experimentId } }).catch(() => undefined);
  }
  await prisma.masteryEvidence.deleteMany({
    where: {
      OR: [
        { evidenceRef: input.submissionId },
        { evidenceRef: `${input.testRunId}:public` },
        { evidenceRef: `${input.testRunId}:hidden` },
      ],
    },
  });
  await prisma.job.delete({ where: { id: input.jobId } }).catch(() => undefined);
  await prisma.testResult.deleteMany({ where: { testRunId: input.testRunId } });
  await prisma.testRun.delete({ where: { id: input.testRunId } }).catch(() => undefined);
  await prisma.submission.delete({ where: { id: input.submissionId } }).catch(() => undefined);
}

test("passing public and hidden invariant evidence unlocks an experiment", async () => {
  const fixture = await createFinalizingFixture("1111111111111111111111111111111111111111");
  let experimentId: string | undefined;
  try {
    const finalized = await finalizeSubmissionTestJob({
      jobId: fixture.job.id,
      workerId: WORKER,
      evidence: completeEvidence(),
    });
    assert.equal(finalized.state, "passed");

    const persisted = await prisma.submission.findUniqueOrThrow({ where: { id: fixture.submission.id } });
    assert.equal(persisted.state, "passed");
    const results = await prisma.testResult.findMany({ where: { testRunId: fixture.testRun.id } });
    assert.equal(results.length, 6);
    assert.equal(results.every((result) => result.passed), true);

    const experiment = await createVerifiedExperimentForDemo(fixture.submission.id);
    experimentId = experiment.id;
    assert.equal(experiment.commitSha, fixture.submission.commitSha);

    const mastery = await prisma.masteryEvidence.findMany({
      where: {
        userId: fixture.user.id,
        evidenceRef: { in: [fixture.submission.id, `${fixture.testRun.id}:public`, `${fixture.testRun.id}:hidden`] },
      },
    });
    assert.equal(mastery.length, 3);
  } finally {
    await cleanupFixture({
      submissionId: fixture.submission.id,
      testRunId: fixture.testRun.id,
      jobId: fixture.job.id,
      ...(experimentId ? { experimentId } : {}),
    });
  }
});

test("a deterministic hidden invariant failure remains evidence and blocks experiments", async () => {
  const fixture = await createFinalizingFixture("2222222222222222222222222222222222222222");
  try {
    const finalized = await finalizeSubmissionTestJob({
      jobId: fixture.job.id,
      workerId: WORKER,
      evidence: completeEvidence({ failingInvariant: "attention.no_permanent_kv_repeat" }),
    });
    assert.equal(finalized.state, "failed");

    const persisted = await prisma.submission.findUniqueOrThrow({ where: { id: fixture.submission.id } });
    assert.equal(persisted.state, "needs_revision");
    const failing = await prisma.testResult.findFirstOrThrow({
      where: { testRunId: fixture.testRun.id, invariantId: "attention.no_permanent_kv_repeat" },
    });
    assert.equal(failing.passed, false);

    await assert.rejects(
      createVerifiedExperimentForDemo(fixture.submission.id),
      /SUBMISSION_NOT_VERIFIED/,
    );

    const mastery = await prisma.masteryEvidence.findMany({
      where: {
        userId: fixture.user.id,
        evidenceRef: { in: [fixture.submission.id, `${fixture.testRun.id}:public`, `${fixture.testRun.id}:hidden`] },
      },
    });
    assert.equal(mastery.length, 0);
  } finally {
    await cleanupFixture({
      submissionId: fixture.submission.id,
      testRunId: fixture.testRun.id,
      jobId: fixture.job.id,
    });
  }
});

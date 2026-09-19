import assert from "node:assert/strict";
import test from "node:test";
import {
  addMasteryEvidence,
  createVerifiedExperimentForUser,
  finalizeInterpretationForUser,
  getBoundRepositoryIdentityForUser,
  getExperimentByDisplayIdForUser,
  getLearnerSnapshot,
  getSubmissionByIdForUser,
  importExperimentArtifactForUser,
  lockExperimentForUser,
} from "./index";
import { prisma } from "./client";

const REQUIRED = [
  "attention.shape",
  "attention.causal",
  "attention.gqa_equivalence",
  "attention.gradients",
  "attention.randomized_numerics",
  "attention.no_permanent_kv_repeat",
] as const;

async function buildFixture() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const [userA, userB, courseVersion] = await Promise.all([
    prisma.user.create({ data: { handle: `isolation-a-${suffix}` } }),
    prisma.user.create({ data: { handle: `isolation-b-${suffix}` } }),
    prisma.courseVersion.findFirstOrThrow({
      where: { courseId: "first-principles-llm-research", version: "1.0" },
    }),
  ]);

  const installation = await prisma.gitHubInstallation.create({
    data: {
      githubInstallationId: BigInt(`9${String(Date.now()).slice(-12)}`),
      accountLogin: "isolation-fixture",
      accountType: "Organization",
    },
  });
  const repositoryB = await prisma.repository.create({
    data: {
      userId: userB.id,
      githubInstallationDbId: installation.id,
      provider: "github",
      owner: "isolation-owner",
      name: `repo-${suffix}`,
      providerRepositoryId: BigInt(`8${String(Date.now()).slice(-12)}`),
      defaultBranch: "main",
    },
  });
  await prisma.repositoryBinding.create({
    data: { repositoryId: repositoryB.id, githubInstallationDbId: installation.id },
  });
  const submissionB = await prisma.submission.create({
    data: {
      userId: userB.id,
      repositoryId: repositoryB.id,
      courseVersionId: courseVersion.id,
      labId: "phase1-causal-attention-lab",
      labVersion: "1.0",
      branch: "main",
      commitSha: "b".repeat(40),
      state: "passed",
      finalizedAt: new Date(),
    },
  });
  const testRunB = await prisma.testRun.create({
    data: {
      submissionId: submissionB.id,
      state: "passed",
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
  await prisma.testResult.createMany({
    data: REQUIRED.map((invariantId, index) => ({
      testRunId: testRunB.id,
      visibility: index < 4 ? "public" : "hidden",
      groupId: invariantId,
      invariantId,
      passed: true,
      summary: "isolation fixture pass",
    })),
  });
  await prisma.computeProfile.create({
    data: {
      userId: userB.id,
      selectedProfile: "12gb",
      precision: "bf16",
      evidenceJson: { fixture: true },
    },
  });
  await addMasteryEvidence({
    userId: userB.id,
    dimension: "conceptual",
    evidenceType: "isolation-fixture",
    evidenceRef: `fixture-${suffix}`,
  });
  const experimentB = await createVerifiedExperimentForUser(userB.id, submissionB.id);

  return { userA, userB, installation, repositoryB, submissionB, testRunB, experimentB };
}

async function cleanup(f: Awaited<ReturnType<typeof buildFixture>>) {
  await prisma.journalEntry.deleteMany({ where: { userId: f.userB.id } });
  await prisma.experiment.deleteMany({ where: { userId: f.userB.id } });
  await prisma.testResult.deleteMany({ where: { testRunId: f.testRunB.id } });
  await prisma.testRun.deleteMany({ where: { id: f.testRunB.id } });
  await prisma.submission.deleteMany({ where: { id: f.submissionB.id } });
  await prisma.repositoryBinding.deleteMany({ where: { repositoryId: f.repositoryB.id } });
  await prisma.repository.deleteMany({ where: { id: f.repositoryB.id } });
  await prisma.gitHubInstallation.deleteMany({ where: { id: f.installation.id } });
  await prisma.computeProfile.deleteMany({ where: { userId: f.userB.id } });
  await prisma.masteryEvidence.deleteMany({ where: { userId: f.userB.id } });
  await prisma.user.deleteMany({ where: { id: { in: [f.userA.id, f.userB.id] } } });
}

test("learner-owned evidence is isolated by explicit userId", async () => {
  const f = await buildFixture();
  try {
    assert.equal(await getSubmissionByIdForUser(f.userA.id, f.submissionB.id), null);
    assert.equal(await getExperimentByDisplayIdForUser(f.userA.id, f.experimentB.displayId), null);
    await assert.rejects(
      getBoundRepositoryIdentityForUser(f.userA.id, f.repositoryB.id),
      /REPOSITORY_NOT_FOUND/,
    );
    await assert.rejects(
      createVerifiedExperimentForUser(f.userA.id, f.submissionB.id),
      /SUBMISSION_NOT_FOUND/,
    );
    await assert.rejects(
      lockExperimentForUser(f.userA.id, {
        id: f.experimentB.id,
        hypothesis: "cross-user mutation must fail",
        prediction: "not reachable",
      }),
      /EXPERIMENT_NOT_FOUND/,
    );
    await assert.rejects(
      importExperimentArtifactForUser(f.userA.id, {
        experimentDbId: f.experimentB.id,
        artifact: {
          schemaVersion: "1",
          experimentId: f.experimentB.id,
          experimentType: "attention_memory_scaling",
          submissionCommit: f.submissionB.commitSha,
          runs: [{ sequenceLength: 128, status: "complete" }],
        },
        sha256: "0".repeat(64),
        byteSize: 1,
      }),
      /EXPERIMENT_NOT_FOUND/,
    );
    await assert.rejects(
      finalizeInterpretationForUser(f.userA.id, {
        experimentId: f.experimentB.id,
        observation: "not reachable",
        interpretation: "not reachable",
        uncertainty: "not reachable",
        conclusion: "inconclusive",
      }),
      /EXPERIMENT_NOT_FOUND/,
    );

    const snapshotA = await getLearnerSnapshot(f.userA.id);
    assert.equal(snapshotA.repository, null);
    assert.equal(snapshotA.submission, null);
    assert.equal(snapshotA.experiment, null);
    assert.equal(snapshotA.journal, null);
    assert.equal(snapshotA.compute, null);
    assert.equal(snapshotA.mastery.evidence.length, 0);

    assert.ok(await getSubmissionByIdForUser(f.userB.id, f.submissionB.id));
    assert.ok(await getExperimentByDisplayIdForUser(f.userB.id, f.experimentB.displayId));
    assert.equal((await getBoundRepositoryIdentityForUser(f.userB.id, f.repositoryB.id)).repositoryDbId, f.repositoryB.id);
  } finally {
    await cleanup(f);
  }
});

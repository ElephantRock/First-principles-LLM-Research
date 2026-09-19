import { prisma } from "./client";
import { addMasteryEvidence, getCausalAttentionMastery, getDemoUser } from "./evidence";
import { getLatestEnvironmentQualificationForUser } from "./environment";

export async function getLearnerSnapshot(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("USER_NOT_FOUND");
  const [latestEnvironment, repository, submission, experiment, journal, mastery] = await Promise.all([
    getLatestEnvironmentQualificationForUser(userId),
    prisma.repository.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.submission.findFirst({
      where: { userId, labId: "phase1-causal-attention-lab" },
      orderBy: { createdAt: "desc" },
      include: { testRuns: { orderBy: { createdAt: "desc" }, take: 1, include: { results: true } } },
    }),
    prisma.experiment.findFirst({
      where: { userId, experimentType: "attention_memory_scaling" },
      orderBy: { createdAt: "desc" },
      include: { runs: { orderBy: { createdAt: "desc" }, include: { metrics: true } } },
    }),
    prisma.journalEntry.findFirst({
      where: { userId, experiment: { experimentType: "attention_memory_scaling" } },
      include: { versions: { orderBy: { version: "desc" }, take: 1 }, experiment: true },
    }),
    getCausalAttentionMastery(userId),
  ]);
  const compute = latestEnvironment
    ? latestEnvironment.computeProfile
    : await prisma.computeProfile.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  return { user, compute, repository, submission, experiment, journal, mastery };
}

/** Transitional deterministic fixture wrapper. Production request paths must use getLearnerSnapshot(userId). */
export async function getDemoSnapshot() {
  const user = await getDemoUser();
  return getLearnerSnapshot(user.id);
}

export async function lockExperimentForUser(
  userId: string,
  input: { id: string; hypothesis: string; prediction: string },
) {
  return prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findFirst({ where: { id: input.id, userId } });
    if (!experiment) throw new Error("EXPERIMENT_NOT_FOUND");
    if (experiment.state !== "draft" || experiment.lockedAt) throw new Error("EXPERIMENT_ALREADY_LOCKED");
    const locked = await tx.experiment.update({
      where: { id: experiment.id },
      data: {
        hypothesis: input.hypothesis,
        prediction: input.prediction,
        lockedAt: new Date(),
        state: "awaiting_run",
      },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "experiment.locked",
        objectType: "experiment",
        objectId: locked.id,
        dataJson: { displayId: locked.displayId, commitSha: locked.commitSha },
      },
    });
    return locked;
  });
}

export async function lockExperimentForDemo(input: { id: string; hypothesis: string; prediction: string }) {
  const user = await getDemoUser();
  return lockExperimentForUser(user.id, input);
}

export interface NormalizedExperimentArtifact {
  schemaVersion: "1";
  experimentId: string;
  experimentType: "attention_memory_scaling";
  submissionCommit: string;
  environmentReportId?: string;
  runs: Array<{
    sequenceLength: 128 | 256 | 512 | 1024;
    peakAllocatedBytes?: number;
    peakReservedBytes?: number;
    tokensPerSecond?: number;
    stepSeconds?: number;
    status: "complete" | "oom" | "failed";
    failureCode?: string;
  }>;
}

export async function importExperimentArtifactForUser(
  userId: string,
  input: {
    experimentDbId: string;
    artifact: NormalizedExperimentArtifact;
    sha256: string;
    byteSize: number;
  },
) {
  return prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findFirst({
      where: { id: input.experimentDbId, userId },
      include: { submission: true },
    });
    if (!experiment) throw new Error("EXPERIMENT_NOT_FOUND");
    if (!experiment.lockedAt || !["awaiting_run", "running", "failed"].includes(experiment.state)) throw new Error("EXPERIMENT_NOT_READY_FOR_ARTIFACT");
    if (input.artifact.experimentId !== experiment.id) throw new Error("ARTIFACT_EXPERIMENT_MISMATCH");
    if (input.artifact.submissionCommit !== experiment.commitSha) throw new Error("ARTIFACT_COMMIT_MISMATCH");
    if (input.artifact.experimentType !== experiment.experimentType) throw new Error("ARTIFACT_TYPE_MISMATCH");

    if (input.artifact.environmentReportId) {
      const environmentReport = await tx.environmentReport.findFirst({
        where: { id: input.artifact.environmentReportId, userId },
        select: { id: true },
      });
      if (!environmentReport) throw new Error("ENVIRONMENT_REPORT_NOT_FOUND");
    }

    const run = await tx.experimentRun.create({
      data: {
        experimentId: experiment.id,
        environmentReportId: input.artifact.environmentReportId ?? null,
        status: input.artifact.runs.some((r) => r.status === "failed") ? "partial" : "complete",
        completedAt: new Date(),
      },
    });

    for (const metric of input.artifact.runs) {
      await tx.experimentMetric.create({
        data: {
          experimentRunId: run.id,
          sequenceLength: metric.sequenceLength,
          status: metric.status,
          peakAllocatedBytes: metric.peakAllocatedBytes == null ? null : BigInt(metric.peakAllocatedBytes),
          peakReservedBytes: metric.peakReservedBytes == null ? null : BigInt(metric.peakReservedBytes),
          tokensPerSecond: metric.tokensPerSecond ?? null,
          stepSeconds: metric.stepSeconds ?? null,
          failureCode: metric.failureCode ?? null,
        },
      });
    }

    await tx.experimentArtifact.create({
      data: {
        experimentId: experiment.id,
        experimentRunId: run.id,
        submissionId: experiment.submissionId,
        sha256: input.sha256,
        byteSize: BigInt(input.byteSize),
        mediaType: "application/json",
        artifactType: "attention_memory_scaling_result",
        visibility: "private",
        metadataJson: JSON.parse(JSON.stringify(input.artifact)),
      },
    });

    await tx.experiment.update({ where: { id: experiment.id }, data: { state: "complete" } });
    await tx.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "experiment.artifact_imported",
        objectType: "experiment",
        objectId: experiment.id,
        dataJson: { sha256: input.sha256, runId: run.id },
      },
    });
    return { experimentId: experiment.id, runId: run.id };
  }).then(async (result) => {
    await addMasteryEvidence({
      userId,
      dimension: "experiment",
      evidenceType: "attention-memory-scaling",
      evidenceRef: result.runId,
    });
    return result;
  });
}

export async function importExperimentArtifactForDemo(input: {
  experimentDbId: string;
  artifact: NormalizedExperimentArtifact;
  sha256: string;
  byteSize: number;
}) {
  const user = await getDemoUser();
  return importExperimentArtifactForUser(user.id, input);
}

export interface FinalizeInterpretationInput {
  experimentId: string;
  observation: string;
  interpretation: string;
  uncertainty: string;
  nextExperiment?: string;
  conclusion: "supports" | "partially_supports" | "does_not_support" | "inconclusive";
}

export async function finalizeInterpretationForUser(userId: string, input: FinalizeInterpretationInput) {
  const result = await prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findFirst({ where: { id: input.experimentId, userId } });
    if (!experiment) throw new Error("EXPERIMENT_NOT_FOUND");
    if (experiment.state !== "complete") throw new Error("EXPERIMENT_NOT_READY_FOR_INTERPRETATION");
    let entry = await tx.journalEntry.findUnique({ where: { experimentId: experiment.id } });
    if (entry && entry.userId !== userId) throw new Error("JOURNAL_ENTRY_NOT_FOUND");
    if (!entry) {
      entry = await tx.journalEntry.create({
        data: { userId, experimentId: experiment.id, kind: "experiment", visibility: "private" },
      });
    }
    const latest = await tx.journalEntryVersion.findFirst({ where: { journalEntryId: entry.id }, orderBy: { version: "desc" } });
    const version = (latest?.version ?? 0) + 1;
    const journalVersion = await tx.journalEntryVersion.create({
      data: {
        journalEntryId: entry.id,
        version,
        observation: input.observation,
        interpretation: input.interpretation,
        uncertainty: input.uncertainty,
        nextExperiment: input.nextExperiment ?? null,
        conclusion: input.conclusion,
        finalizedAt: new Date(),
      },
    });
    await tx.experiment.update({
      where: { id: experiment.id },
      data: { state: "interpreted", conclusion: input.conclusion },
    });
    return { entryId: entry.id, versionId: journalVersion.id };
  });
  await addMasteryEvidence({
    userId,
    dimension: "interpretation",
    evidenceType: "versioned-journal-entry",
    evidenceRef: result.versionId,
  });
  return { ...result, mastery: await getCausalAttentionMastery(userId) };
}

export async function finalizeInterpretationForDemo(input: FinalizeInterpretationInput) {
  const user = await getDemoUser();
  return finalizeInterpretationForUser(user.id, input);
}

export async function getExperimentByDisplayIdForUser(userId: string, displayId: string) {
  return prisma.experiment.findFirst({
    where: { displayId, userId },
    include: {
      runs: { orderBy: { createdAt: "desc" }, include: { metrics: true } },
      artifacts: true,
      journalEntry: { include: { versions: { orderBy: { version: "desc" } } } },
      submission: true,
    },
  });
}

export async function getExperimentByDisplayIdForDemo(displayId: string) {
  const user = await getDemoUser();
  return getExperimentByDisplayIdForUser(user.id, displayId);
}

export async function getSubmissionByIdForUser(userId: string, id: string) {
  return prisma.submission.findFirst({
    where: { id, userId },
    include: {
      repository: true,
      courseVersion: true,
      testRuns: { orderBy: { createdAt: "desc" }, include: { results: true } },
    },
  });
}

export async function getSubmissionByIdForDemo(id: string) {
  const user = await getDemoUser();
  return getSubmissionByIdForUser(user.id, id);
}

export async function getTestRunByIdForUser(userId: string, id: string) {
  return prisma.testRun.findFirst({
    where: { id, submission: { userId } },
    include: { results: true, submission: { include: { repository: true } } },
  });
}

export async function getTestRunByIdForDemo(id: string) {
  const user = await getDemoUser();
  return getTestRunByIdForUser(user.id, id);
}

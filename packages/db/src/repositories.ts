import { prisma } from "./client";
import { addMasteryEvidence, getCausalAttentionMastery, getDemoUser } from "./evidence";

export async function getDemoSnapshot() {
  const user = await getDemoUser();
  const [compute, repository, submission, experiment, journal, mastery] = await Promise.all([
    prisma.computeProfile.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.repository.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.submission.findFirst({
      where: { userId: user.id, labId: "phase1-causal-attention-lab" },
      orderBy: { createdAt: "desc" },
      include: { testRuns: { orderBy: { createdAt: "desc" }, take: 1, include: { results: true } } },
    }),
    prisma.experiment.findFirst({
      where: { userId: user.id, experimentType: "attention_memory_scaling" },
      orderBy: { createdAt: "desc" },
      include: { runs: { orderBy: { createdAt: "desc" }, include: { metrics: true } } },
    }),
    prisma.journalEntry.findFirst({
      where: { userId: user.id, experiment: { experimentType: "attention_memory_scaling" } },
      include: { versions: { orderBy: { version: "desc" }, take: 1 }, experiment: true },
    }),
    getCausalAttentionMastery(user.id),
  ]);
  return { user, compute, repository, submission, experiment, journal, mastery };
}

export async function createSubmissionForDemo(input: {
  repositoryId: string;
  branch: string;
  commitSha: string;
  labVersion: string;
}) {
  const user = await getDemoUser();
  const courseVersion = await prisma.courseVersion.findFirst({ where: { courseId: "first-principles-llm-research", version: "1.0" } });
  if (!courseVersion) throw new Error("Course version 1.0 is not seeded");
  return prisma.submission.create({
    data: {
      userId: user.id,
      repositoryId: input.repositoryId,
      courseVersionId: courseVersion.id,
      labId: "phase1-causal-attention-lab",
      labVersion: input.labVersion,
      branch: input.branch,
      commitSha: input.commitSha,
      state: "submitted",
    },
  });
}

export async function createExperimentForDemo(submissionId: string) {
  const user = await getDemoUser();
  const submission = await prisma.submission.findFirst({ where: { id: submissionId, userId: user.id } });
  if (!submission) throw new Error("Submission not found");
  const count = await prisma.experiment.count({ where: { userId: user.id } });
  const displayId = `E-${String(count + 14).padStart(3, "0")}`;
  return prisma.experiment.create({
    data: {
      displayId,
      userId: user.id,
      submissionId: submission.id,
      experimentType: "attention_memory_scaling",
      state: "draft",
      commitSha: submission.commitSha,
    },
  });
}

export async function lockExperimentForDemo(input: { id: string; hypothesis: string; prediction: string }) {
  const user = await getDemoUser();
  return prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findFirst({ where: { id: input.id, userId: user.id } });
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
        actorUserId: user.id,
        eventType: "experiment.locked",
        objectType: "experiment",
        objectId: locked.id,
        dataJson: { displayId: locked.displayId, commitSha: locked.commitSha },
      },
    });
    return locked;
  });
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

export async function importExperimentArtifactForDemo(input: {
  experimentDbId: string;
  artifact: NormalizedExperimentArtifact;
  sha256: string;
  byteSize: number;
}) {
  const user = await getDemoUser();
  return prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findFirst({
      where: { id: input.experimentDbId, userId: user.id },
      include: { submission: true },
    });
    if (!experiment) throw new Error("EXPERIMENT_NOT_FOUND");
    if (!experiment.lockedAt || !["awaiting_run", "running", "failed"].includes(experiment.state)) throw new Error("EXPERIMENT_NOT_READY_FOR_ARTIFACT");
    if (input.artifact.experimentId !== experiment.id) throw new Error("ARTIFACT_EXPERIMENT_MISMATCH");
    if (input.artifact.submissionCommit !== experiment.commitSha) throw new Error("ARTIFACT_COMMIT_MISMATCH");
    if (input.artifact.experimentType !== experiment.experimentType) throw new Error("ARTIFACT_TYPE_MISMATCH");

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
        actorUserId: user.id,
        eventType: "experiment.artifact_imported",
        objectType: "experiment",
        objectId: experiment.id,
        dataJson: { sha256: input.sha256, runId: run.id },
      },
    });
    return { experimentId: experiment.id, runId: run.id };
  }).then(async (result) => {
    await addMasteryEvidence({
      userId: user.id,
      dimension: "experiment",
      evidenceType: "attention-memory-scaling",
      evidenceRef: result.runId,
    });
    return result;
  });
}

export async function finalizeInterpretationForDemo(input: {
  experimentId: string;
  observation: string;
  interpretation: string;
  uncertainty: string;
  nextExperiment?: string;
  conclusion: "supports" | "partially_supports" | "does_not_support" | "inconclusive";
}) {
  const user = await getDemoUser();
  const result = await prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.findFirst({ where: { id: input.experimentId, userId: user.id } });
    if (!experiment) throw new Error("EXPERIMENT_NOT_FOUND");
    if (experiment.state !== "complete") throw new Error("EXPERIMENT_NOT_READY_FOR_INTERPRETATION");
    let entry = await tx.journalEntry.findUnique({ where: { experimentId: experiment.id } });
    if (!entry) {
      entry = await tx.journalEntry.create({
        data: { userId: user.id, experimentId: experiment.id, kind: "experiment", visibility: "private" },
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
    userId: user.id,
    dimension: "interpretation",
    evidenceType: "versioned-journal-entry",
    evidenceRef: result.versionId,
  });
  return { ...result, mastery: await getCausalAttentionMastery(user.id) };
}

export async function getExperimentByDisplayIdForDemo(displayId: string) {
  const user = await getDemoUser();
  return prisma.experiment.findFirst({
    where: { displayId, userId: user.id },
    include: {
      runs: { orderBy: { createdAt: "desc" }, include: { metrics: true } },
      artifacts: true,
      journalEntry: { include: { versions: { orderBy: { version: "desc" } } } },
      submission: true,
    },
  });
}

export async function getSubmissionByIdForDemo(id: string) {
  const user = await getDemoUser();
  return prisma.submission.findFirst({
    where: { id, userId: user.id },
    include: {
      repository: true,
      courseVersion: true,
      testRuns: { orderBy: { createdAt: "desc" }, include: { results: true } },
    },
  });
}

export async function getTestRunByIdForDemo(id: string) {
  const user = await getDemoUser();
  return prisma.testRun.findFirst({
    where: { id, submission: { userId: user.id } },
    include: { results: true, submission: { include: { repository: true } } },
  });
}

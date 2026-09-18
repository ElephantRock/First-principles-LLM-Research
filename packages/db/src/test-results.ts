import { prisma } from "./client";
import { CAUSAL_ATTENTION_UNIT_ID, CAUSAL_ATTENTION_UNIT_VERSION } from "./evidence";

export interface SubmissionInvariantResult {
  visibility: "public" | "hidden";
  groupId: string;
  invariantId: string;
  passed: boolean;
  summary: string;
  evidence?: unknown;
}

export interface SubmissionExecutionEvidence {
  executionId: string;
  testBundleId: string;
  startedAt: string;
  completedAt: string;
  stdoutSha256?: string;
  stderrSha256?: string;
  results: readonly SubmissionInvariantResult[];
}

const requiredInvariants = new Map<string, "public" | "hidden">([
  ["attention.shape", "public"],
  ["attention.causal", "public"],
  ["attention.gqa_equivalence", "public"],
  ["attention.gradients", "public"],
  ["attention.randomized_numerics", "hidden"],
  ["attention.no_permanent_kv_repeat", "hidden"],
]);

function validateExecutionEvidence(evidence: SubmissionExecutionEvidence) {
  if (!evidence.executionId || !evidence.testBundleId) throw new Error("EXECUTION_IDENTITY_INCOMPLETE");
  const startedAt = new Date(evidence.startedAt);
  const completedAt = new Date(evidence.completedAt);
  if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(completedAt.getTime()) || completedAt < startedAt) {
    throw new Error("EXECUTION_TIMESTAMPS_INVALID");
  }

  const byInvariant = new Map<string, SubmissionInvariantResult>();
  for (const result of evidence.results) {
    if (byInvariant.has(result.invariantId)) throw new Error("DUPLICATE_INVARIANT_RESULT");
    byInvariant.set(result.invariantId, result);
  }

  for (const [invariantId, visibility] of requiredInvariants) {
    const result = byInvariant.get(invariantId);
    if (!result) throw new Error(`MISSING_INVARIANT:${invariantId}`);
    if (result.visibility !== visibility) throw new Error(`INVARIANT_VISIBILITY_MISMATCH:${invariantId}`);
  }

  return {
    startedAt,
    completedAt,
    allPassed: [...requiredInvariants.keys()].every((id) => byInvariant.get(id)?.passed === true),
  };
}

/**
 * Persist a deterministic learner-code outcome. This is deliberately separate
 * from infrastructure retry: failed invariants are evidence, not retryable
 * infrastructure errors.
 */
export async function finalizeSubmissionTestJob(input: {
  jobId: string;
  workerId: string;
  evidence: SubmissionExecutionEvidence;
}): Promise<{ state: "passed" | "failed"; testRunId: string; submissionId: string }> {
  const validated = validateExecutionEvidence(input.evidence);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({
      where: {
        id: input.jobId,
        jobType: "submission_test",
        state: "finalizing",
        leaseOwner: input.workerId,
        leaseExpiresAt: { gt: now },
      },
      include: {
        testRun: { include: { submission: true } },
      },
    });
    if (!job || !job.testRun) throw new Error("JOB_LEASE_LOST_OR_TEST_RUN_MISSING");

    const existing = await tx.testResult.count({ where: { testRunId: job.testRun.id } });
    if (existing !== 0) throw new Error("TEST_RUN_ALREADY_FINALIZED");

    const payload = job.payloadJson as { testBundleId?: unknown };
    if (payload.testBundleId !== input.evidence.testBundleId) throw new Error("TEST_BUNDLE_IDENTITY_MISMATCH");

    for (const result of input.evidence.results) {
      const evidenceJson = JSON.parse(JSON.stringify({
        executionId: input.evidence.executionId,
        testBundleId: input.evidence.testBundleId,
        workerId: input.workerId,
        startedAt: validated.startedAt.toISOString(),
        completedAt: validated.completedAt.toISOString(),
        stdoutSha256: input.evidence.stdoutSha256 ?? null,
        stderrSha256: input.evidence.stderrSha256 ?? null,
        detail: result.evidence ?? null,
      }));
      await tx.testResult.create({
        data: {
          testRunId: job.testRun.id,
          visibility: result.visibility,
          groupId: result.groupId,
          invariantId: result.invariantId,
          passed: result.passed,
          summary: result.summary,
          evidenceJson,
        },
      });
    }

    const state = validated.allPassed ? "passed" : "failed";
    await tx.testRun.update({
      where: { id: job.testRun.id },
      data: {
        state,
        startedAt: validated.startedAt,
        completedAt: validated.completedAt,
      },
    });
    await tx.submission.update({
      where: { id: job.testRun.submission.id },
      data: {
        state: validated.allPassed ? "passed" : "needs_revision",
        finalizedAt: validated.completedAt,
      },
    });
    await tx.job.update({
      where: { id: job.id },
      data: {
        state,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        completedAt: validated.completedAt,
      },
    });
    await tx.jobEvent.create({
      data: {
        jobId: job.id,
        eventType: validated.allPassed ? "job.passed" : "job.failed",
        dataJson: {
          workerId: input.workerId,
          executionId: input.evidence.executionId,
          testBundleId: input.evidence.testBundleId,
          passed: validated.allPassed,
        },
      },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: job.testRun.submission.userId,
        eventType: "submission.test_completed",
        objectType: "submission",
        objectId: job.testRun.submission.id,
        correlationId: job.id,
        dataJson: {
          testRunId: job.testRun.id,
          executionId: input.evidence.executionId,
          testBundleId: input.evidence.testBundleId,
          state,
          commitSha: job.testRun.submission.commitSha,
        },
      },
    });

    if (validated.allPassed) {
      const masteryRows = [
        {
          dimension: "implementation",
          evidenceType: "immutable-submission",
          evidenceRef: job.testRun.submission.id,
        },
        {
          dimension: "publicTests",
          evidenceType: "test-run",
          evidenceRef: `${job.testRun.id}:public`,
        },
        {
          dimension: "hiddenTests",
          evidenceType: "invariant-oriented-hidden-test-run",
          evidenceRef: `${job.testRun.id}:hidden`,
        },
      ] as const;

      for (const mastery of masteryRows) {
        await tx.masteryEvidence.upsert({
          where: {
            userId_unitId_unitVersion_dimension_evidenceRef: {
              userId: job.testRun.submission.userId,
              unitId: CAUSAL_ATTENTION_UNIT_ID,
              unitVersion: CAUSAL_ATTENTION_UNIT_VERSION,
              dimension: mastery.dimension,
              evidenceRef: mastery.evidenceRef,
            },
          },
          update: { status: "passed", evidenceType: mastery.evidenceType },
          create: {
            userId: job.testRun.submission.userId,
            unitId: CAUSAL_ATTENTION_UNIT_ID,
            unitVersion: CAUSAL_ATTENTION_UNIT_VERSION,
            dimension: mastery.dimension,
            evidenceType: mastery.evidenceType,
            evidenceRef: mastery.evidenceRef,
            status: "passed",
          },
        });
      }
    }

    return {
      state,
      testRunId: job.testRun.id,
      submissionId: job.testRun.submission.id,
    };
  });
}

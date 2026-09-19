import { prisma } from "./client";

export type SubmissionTestJobStage =
  | "leased"
  | "preparing"
  | "running_public"
  | "running_hidden"
  | "finalizing";

export interface LeasedSubmissionTestJob {
  id: string;
  testRunId: string | null;
  payloadJson: unknown;
  attemptCount: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
  startedAt: Date;
}

const stagePredecessor: Record<Exclude<SubmissionTestJobStage, "leased">, SubmissionTestJobStage> = {
  preparing: "leased",
  running_public: "preparing",
  running_hidden: "running_public",
  finalizing: "running_hidden",
};

/**
 * Lease one due submission-test job without allowing two workers to claim the
 * same row. The CTE row lock and UPDATE execute as one PostgreSQL statement.
 * Expired in-flight leases are recoverable and count as a new attempt.
 */
export async function leaseNextSubmissionTestJob(input: {
  workerId: string;
  leaseSeconds?: number;
}): Promise<LeasedSubmissionTestJob | null> {
  const workerId = input.workerId.trim();
  const leaseSeconds = input.leaseSeconds ?? 120;
  if (!workerId || workerId.length > 160) throw new Error("WORKER_ID_INVALID");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 900) {
    throw new Error("LEASE_SECONDS_INVALID");
  }

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{
      id: string;
      testRunId: string | null;
      payloadJson: unknown;
      attemptCount: number;
      leaseOwner: string;
      leaseExpiresAt: Date;
      startedAt: Date;
    }>>(
      `
      WITH candidate AS (
        SELECT "id"
        FROM "Job"
        WHERE "jobType" = 'submission_test'
          AND (
            (
              "state" = 'queued'
              AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= CURRENT_TIMESTAMP)
            )
            OR (
              "state" IN ('leased', 'preparing', 'running_public', 'running_hidden', 'finalizing')
              AND "leaseExpiresAt" IS NOT NULL
              AND "leaseExpiresAt" < CURRENT_TIMESTAMP
            )
          )
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "Job" AS job
      SET
        "state" = 'leased',
        "leaseOwner" = $1,
        "leaseExpiresAt" = CURRENT_TIMESTAMP + ($2::integer * INTERVAL '1 second'),
        "attemptCount" = job."attemptCount" + 1,
        "startedAt" = COALESCE(job."startedAt", CURRENT_TIMESTAMP),
        "completedAt" = NULL
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING
        job."id"::text AS "id",
        job."testRunId"::text AS "testRunId",
        job."payloadJson" AS "payloadJson",
        job."attemptCount" AS "attemptCount",
        job."leaseOwner" AS "leaseOwner",
        job."leaseExpiresAt" AS "leaseExpiresAt",
        job."startedAt" AS "startedAt"
      `,
      workerId,
      leaseSeconds,
    );

    const leased = rows[0];
    if (!leased) return null;

    await tx.jobEvent.create({
      data: {
        jobId: leased.id,
        eventType: "job.leased",
        dataJson: {
          workerId,
          attemptCount: leased.attemptCount,
          leaseExpiresAt: leased.leaseExpiresAt.toISOString(),
        },
      },
    });

    if (leased.testRunId) {
      await tx.testRun.updateMany({
        where: { id: leased.testRunId, state: "queued" },
        data: { state: "preparing", startedAt: new Date() },
      });
    }

    return leased;
  });
}

/** Advance a leased job by exactly one execution stage while renewing its lease. */
export async function advanceSubmissionTestJob(input: {
  jobId: string;
  workerId: string;
  stage: Exclude<SubmissionTestJobStage, "leased">;
  leaseSeconds?: number;
}): Promise<void> {
  const leaseSeconds = input.leaseSeconds ?? 120;
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 900) {
    throw new Error("LEASE_SECONDS_INVALID");
  }

  const previous = stagePredecessor[input.stage];
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.job.updateMany({
      where: {
        id: input.jobId,
        jobType: "submission_test",
        state: previous,
        leaseOwner: input.workerId,
        leaseExpiresAt: { gt: now },
      },
      data: {
        state: input.stage,
        leaseExpiresAt,
      },
    });

    if (updated.count !== 1) throw new Error("JOB_LEASE_LOST_OR_STAGE_INVALID");

    await tx.jobEvent.create({
      data: {
        jobId: input.jobId,
        eventType: `job.${input.stage}`,
        dataJson: { workerId: input.workerId, leaseExpiresAt: leaseExpiresAt.toISOString() },
      },
    });

    const job = await tx.job.findUnique({ where: { id: input.jobId }, select: { testRunId: true } });
    if (job?.testRunId) {
      await tx.testRun.update({
        where: { id: job.testRunId },
        data: { state: input.stage },
      });
    }
  });
}

/**
 * Release an infrastructure-failed job for bounded retry. Learner-code test
 * failures must be finalized as evidence instead of calling this function.
 */
export async function retrySubmissionTestJobAfterInfrastructureFailure(input: {
  jobId: string;
  workerId: string;
  failureCode: string;
  delaySeconds?: number;
  maxAttempts?: number;
}): Promise<"queued" | "infrastructure_error"> {
  const delaySeconds = input.delaySeconds ?? 30;
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 3600) throw new Error("RETRY_DELAY_INVALID");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error("MAX_ATTEMPTS_INVALID");

  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({
      where: {
        id: input.jobId,
        jobType: "submission_test",
        leaseOwner: input.workerId,
        state: { in: ["leased", "preparing", "running_public", "running_hidden", "finalizing"] },
      },
    });
    if (!job) throw new Error("JOB_LEASE_LOST");

    const terminal = job.attemptCount >= maxAttempts;
    const nextState = terminal ? "infrastructure_error" : "queued";
    const nextAttemptAt = terminal ? null : new Date(Date.now() + delaySeconds * 1000);

    await tx.job.update({
      where: { id: job.id },
      data: {
        state: nextState,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt,
        completedAt: terminal ? new Date() : null,
      },
    });

    await tx.jobEvent.create({
      data: {
        jobId: job.id,
        eventType: terminal ? "job.infrastructure_error" : "job.retry_scheduled",
        dataJson: {
          workerId: input.workerId,
          failureCode: input.failureCode,
          attemptCount: job.attemptCount,
          nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
        },
      },
    });

    if (job.testRunId) {
      await tx.testRun.update({
        where: { id: job.testRunId },
        data: terminal
          ? { state: "infrastructure_error", completedAt: new Date() }
          : { state: "queued" },
      });
    }

    return nextState;
  });
}

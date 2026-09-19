import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./client";
import {
  advanceSubmissionTestJob,
  leaseNextSubmissionTestJob,
  retrySubmissionTestJobAfterInfrastructureFailure,
} from "./jobs";

async function createQueuedJob() {
  return prisma.job.create({
    data: {
      jobType: "submission_test",
      state: "queued",
      payloadJson: {
        schemaVersion: "1",
        submissionId: "fixture",
        testRunId: "fixture",
        source: {
          provider: "github",
          installationId: "1",
          repositoryId: "1",
          owner: "fixture",
          name: "fixture",
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
      },
      nextAttemptAt: new Date(Date.now() - 1000),
    },
  });
}

test("FOR UPDATE SKIP LOCKED leases one queued job to at most one worker", async () => {
  const job = await createQueuedJob();
  try {
    const [a, b] = await Promise.all([
      leaseNextSubmissionTestJob({ workerId: "worker-a", leaseSeconds: 60 }),
      leaseNextSubmissionTestJob({ workerId: "worker-b", leaseSeconds: 60 }),
    ]);

    const winners = [a, b].filter((value) => value?.id === job.id);
    assert.equal(winners.length, 1);

    const persisted = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(persisted.state, "leased");
    assert.equal(persisted.attemptCount, 1);
    assert.ok(["worker-a", "worker-b"].includes(persisted.leaseOwner ?? ""));

    const events = await prisma.jobEvent.findMany({ where: { jobId: job.id } });
    assert.equal(events.filter((event) => event.eventType === "job.leased").length, 1);
  } finally {
    await prisma.job.delete({ where: { id: job.id } }).catch(() => undefined);
  }
});

test("a worker can advance only its live lease and schedule bounded infrastructure retry", async () => {
  const job = await createQueuedJob();
  try {
    const leased = await leaseNextSubmissionTestJob({ workerId: "worker-owner", leaseSeconds: 60 });
    assert.equal(leased?.id, job.id);

    await assert.rejects(
      advanceSubmissionTestJob({ jobId: job.id, workerId: "worker-other", stage: "preparing" }),
      /JOB_LEASE_LOST_OR_STAGE_INVALID/,
    );

    await advanceSubmissionTestJob({ jobId: job.id, workerId: "worker-owner", stage: "preparing" });
    const retryState = await retrySubmissionTestJobAfterInfrastructureFailure({
      jobId: job.id,
      workerId: "worker-owner",
      failureCode: "FIXTURE_INFRA_FAILURE",
      delaySeconds: 1,
      maxAttempts: 3,
    });
    assert.equal(retryState, "queued");

    const persisted = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(persisted.state, "queued");
    assert.equal(persisted.leaseOwner, null);
    assert.equal(persisted.leaseExpiresAt, null);
    assert.ok(persisted.nextAttemptAt instanceof Date);
  } finally {
    await prisma.job.delete({ where: { id: job.id } }).catch(() => undefined);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});

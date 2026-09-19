import { randomUUID } from "node:crypto";
import {
  createVerifiedSubmissionAndQueueForUser,
  prisma,
} from "@fpllm/db";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

const PASSING_RESULTS = [
  ["public", "attention.shape"],
  ["public", "attention.causal"],
  ["public", "attention.gqa_equivalence"],
  ["public", "attention.gradients"],
  ["hidden", "attention.randomized_numerics"],
  ["hidden", "attention.no_permanent_kv_repeat"],
] as const;

function enabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.FPLLM_E2E_AUTH === "1";
}

function unavailable() {
  return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}

function providerId(): bigint {
  const hex = randomUUID().replaceAll("-", "").slice(0, 15);
  return BigInt(`0x${hex}`);
}

async function ownSubmission(userId: string, submissionId: string) {
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, userId },
  });
  if (!submission) throw new Error("SUBMISSION_NOT_FOUND");

  const run = await prisma.testRun.findFirst({
    where: { submissionId: submission.id },
    orderBy: { createdAt: "desc" },
    include: { jobs: { orderBy: { createdAt: "desc" } } },
  });
  if (!run) throw new Error("TEST_RUN_NOT_FOUND");

  return { submission, run, job: run.jobs[0] ?? null };
}

export async function POST(request: NextRequest) {
  if (!enabled()) return unavailable();

  const current = await getCurrentLearner();
  if (!current) {
    return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_BODY");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  try {
    if (body.action === "bind_repository") {
      const suffix = randomUUID().slice(0, 8);
      const installation = await prisma.gitHubInstallation.create({
        data: {
          githubInstallationId: providerId(),
          accountLogin: `playwright-${suffix}`,
          accountType: "User",
        },
      });
      const repository = await prisma.repository.create({
        data: {
          userId: current.user.id,
          githubInstallationDbId: installation.id,
          provider: "github",
          owner: "playwright-fixture",
          name: `learner-${suffix}`,
          providerRepositoryId: providerId(),
          defaultBranch: "main",
        },
      });
      await prisma.repositoryBinding.create({
        data: {
          repositoryId: repository.id,
          githubInstallationDbId: installation.id,
        },
      });
      return NextResponse.json({
        ok: true,
        repository: {
          id: repository.id,
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
        },
      }, { status: 201 });
    }

    if (body.action === "queue_submission") {
      if (typeof body.repositoryId !== "string") throw new Error("REPOSITORY_ID_REQUIRED");
      const commitSha = typeof body.commitSha === "string" ? body.commitSha.toLowerCase() : "a".repeat(40);
      if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error("COMMIT_SHA_INVALID");

      const queued = await createVerifiedSubmissionAndQueueForUser(current.user.id, {
        repositoryId: body.repositoryId,
        branch: "main",
        commitSha,
        labVersion: "1.0",
      });
      return NextResponse.json({ ok: true, ...queued }, { status: 201 });
    }

    if (body.action === "set_running") {
      if (typeof body.submissionId !== "string") throw new Error("SUBMISSION_ID_REQUIRED");
      const { run, job } = await ownSubmission(current.user.id, body.submissionId);
      await prisma.$transaction([
        prisma.submission.update({ where: { id: body.submissionId }, data: { state: "testing" } }),
        prisma.testRun.update({
          where: { id: run.id },
          data: { state: "running_public", startedAt: run.startedAt ?? new Date() },
        }),
        ...(job ? [prisma.job.update({ where: { id: job.id }, data: { state: "running_public" } })] : []),
      ]);
      return NextResponse.json({ ok: true, submissionId: body.submissionId, testRunId: run.id });
    }

    if (body.action === "complete_pass") {
      if (typeof body.submissionId !== "string") throw new Error("SUBMISSION_ID_REQUIRED");
      const { run, job } = await ownSubmission(current.user.id, body.submissionId);
      const existing = await prisma.testResult.count({ where: { testRunId: run.id } });
      if (existing !== 0) throw new Error("TEST_RUN_ALREADY_FINALIZED");
      const completedAt = new Date();

      await prisma.$transaction([
        prisma.testResult.createMany({
          data: PASSING_RESULTS.map(([visibility, invariantId]) => ({
            testRunId: run.id,
            visibility,
            groupId: invariantId,
            invariantId,
            passed: true,
            summary: "Playwright release-gate fixture pass",
            evidenceJson: { source: "playwright-no-seed-ux" },
          })),
        }),
        prisma.testRun.update({
          where: { id: run.id },
          data: {
            state: "passed",
            startedAt: run.startedAt ?? completedAt,
            completedAt,
          },
        }),
        prisma.submission.update({
          where: { id: body.submissionId },
          data: { state: "passed", finalizedAt: completedAt },
        }),
        ...(job ? [prisma.job.update({
          where: { id: job.id },
          data: { state: "passed", completedAt, nextAttemptAt: null },
        })] : []),
      ]);
      return NextResponse.json({ ok: true, submissionId: body.submissionId, testRunId: run.id });
    }

    return NextResponse.json({ error: "ACTION_INVALID" }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "FIXTURE_FAILED";
    const status = code.endsWith("_NOT_FOUND") ? 404 : 409;
    return NextResponse.json({ ok: false, error: code }, { status });
  }
}

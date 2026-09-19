import { submissionCreateSchema } from "@fpllm/api-contracts";
import {
  createVerifiedSubmissionAndQueueForUser,
  getBoundRepositoryIdentityForUser,
} from "@fpllm/db";
import { GitHubAppClient } from "@fpllm/github";
import { NextResponse } from "next/server";
import { getCurrentLearner } from "@/lib/auth";

function githubClient() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n");
  if (!appId || !privateKey) throw new Error("GITHUB_APP_NOT_CONFIGURED");
  return new GitHubAppClient({ appId, privateKey });
}

export async function POST(request: Request) {
  const current = await getCurrentLearner();
  if (!current) return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const parsed = submissionCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "REQUEST_INVALID", errors: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const requestedCommit = parsed.data.commit.toLowerCase();
    const repository = await getBoundRepositoryIdentityForUser(current.user.id, parsed.data.repositoryId);
    const resolved = await githubClient().resolveRepository({
      installationId: repository.installationId,
      owner: repository.owner,
      repo: repository.name,
      ref: requestedCommit,
    });

    if (resolved.commitSha.toLowerCase() !== requestedCommit) {
      throw new Error("COMMIT_IDENTITY_MISMATCH");
    }
    if (
      repository.providerRepositoryId !== null &&
      String(resolved.repositoryId) !== repository.providerRepositoryId
    ) {
      throw new Error("REPOSITORY_IDENTITY_MISMATCH");
    }

    const queued = await createVerifiedSubmissionAndQueueForUser(current.user.id, {
      repositoryId: repository.repositoryDbId,
      branch: parsed.data.branch,
      commitSha: resolved.commitSha.toLowerCase(),
      labVersion: parsed.data.labVersion,
    });

    return NextResponse.json(
      {
        ok: true,
        submission: queued.submission,
        testRun: queued.testRun,
        job: queued.job,
      },
      { status: 202 },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "SUBMISSION_CREATE_FAILED";
    const status = code === "GITHUB_APP_NOT_CONFIGURED" ? 503 : code === "REPOSITORY_NOT_FOUND" ? 404 : 409;
    return NextResponse.json({ ok: false, code }, { status });
  }
}

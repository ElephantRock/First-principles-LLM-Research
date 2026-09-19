import { repositoryBindSchema } from "@fpllm/api-contracts";
import { prisma } from "@fpllm/db";
import { GitHubAppClient } from "@fpllm/github";
import { NextResponse } from "next/server";
import {
  getCurrentLearner,
  REPOSITORY_AUTHORIZATION_COOKIE_NAME,
  repositoryAuthorizationSecret,
  verifyRepositoryAuthorization,
} from "@/lib/auth";

function client() {
  const appId = process.env.GITHUB_APP_ID;
  const key = process.env.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n");
  if (!appId || !key) throw new Error("GITHUB_APP_NOT_CONFIGURED");
  return new GitHubAppClient({ appId, privateKey: key });
}

function isFormRequest(request: Request) {
  return request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") === true ||
    request.headers.get("content-type")?.includes("multipart/form-data") === true;
}

function responseForError(request: Request, code: string, status: number) {
  if (isFormRequest(request)) {
    const url = new URL("/setup/repository", request.url);
    url.searchParams.set("error", code);
    return NextResponse.redirect(url, { status: 303 });
  }
  return NextResponse.json({ ok: false, code }, { status });
}

export async function POST(request: Request) {
  const current = await getCurrentLearner();
  if (!current) return responseForError(request, "AUTHENTICATION_REQUIRED", 401);
  if (current.mode !== "session" || !current.session) {
    return responseForError(request, "REAL_SESSION_REQUIRED", 409);
  }

  const raw = isFormRequest(request)
    ? Object.fromEntries((await request.formData()).entries())
    : await request.json();
  const parsed = repositoryBindSchema.safeParse(raw);
  if (!parsed.success) return responseForError(request, "REQUEST_INVALID", 400);

  let authorization;
  try {
    authorization = verifyRepositoryAuthorization({
      token: parsed.data.authorization,
      secret: repositoryAuthorizationSecret(),
      userId: current.user.id,
      sessionId: current.session.id,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "REPOSITORY_AUTHORIZATION_INVALID";
    return responseForError(request, code, 503);
  }
  if (!authorization) return responseForError(request, "REPOSITORY_AUTHORIZATION_INVALID", 403);

  try {
    const resolved = await client().resolveRepository({
      installationId: authorization.installationId,
      owner: authorization.owner,
      repo: authorization.repo,
      ref: parsed.data.ref,
    });
    if (String(resolved.repositoryId) !== authorization.repositoryId) {
      throw new Error("REPOSITORY_IDENTITY_MISMATCH");
    }

    const result = await prisma.$transaction(async (tx) => {
      const installation = await tx.gitHubInstallation.upsert({
        where: { githubInstallationId: BigInt(authorization.installationId) },
        update: { accountLogin: resolved.owner, suspendedAt: null },
        create: {
          githubInstallationId: BigInt(authorization.installationId),
          accountLogin: resolved.owner,
          accountType: "VerifiedUserAccess",
        },
      });
      const repository = await tx.repository.upsert({
        where: {
          userId_provider_owner_name: {
            userId: current.user.id,
            provider: "github",
            owner: resolved.owner,
            name: resolved.name,
          },
        },
        update: {
          githubInstallationDbId: installation.id,
          providerRepositoryId: BigInt(resolved.repositoryId),
          defaultBranch: resolved.defaultBranch,
        },
        create: {
          userId: current.user.id,
          provider: "github",
          owner: resolved.owner,
          name: resolved.name,
          githubInstallationDbId: installation.id,
          providerRepositoryId: BigInt(resolved.repositoryId),
          defaultBranch: resolved.defaultBranch,
        },
      });
      await tx.repositoryBinding.upsert({
        where: {
          repositoryId_githubInstallationDbId: {
            repositoryId: repository.id,
            githubInstallationDbId: installation.id,
          },
        },
        update: { boundAt: new Date() },
        create: { repositoryId: repository.id, githubInstallationDbId: installation.id },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: current.user.id,
          eventType: "repository.bound",
          objectType: "repository",
          objectId: repository.id,
          dataJson: {
            providerRepositoryId: String(resolved.repositoryId),
            commitSha: resolved.commitSha,
            installationId: authorization.installationId,
          },
        },
      });
      return repository;
    });

    if (isFormRequest(request)) {
      const response = NextResponse.redirect(new URL("/setup/repository?bound=1", request.url), { status: 303 });
      response.cookies.delete(REPOSITORY_AUTHORIZATION_COOKIE_NAME);
      return response;
    }
    const response = NextResponse.json({
      ok: true,
      repository: {
        id: result.id,
        owner: result.owner,
        name: result.name,
        defaultBranch: result.defaultBranch,
      },
      resolvedCommit: resolved.commitSha,
    });
    response.cookies.delete(REPOSITORY_AUTHORIZATION_COOKIE_NAME);
    return response;
  } catch (error) {
    const code = error instanceof Error ? error.message : "REPOSITORY_BIND_FAILED";
    const status = code.includes("NOT_CONFIGURED") ? 503 : 409;
    return responseForError(request, code, status);
  }
}

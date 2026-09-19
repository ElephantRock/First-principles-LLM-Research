import { repositoryDiscoverySchema } from "@fpllm/api-contracts";
import { prisma } from "@fpllm/db";
import {
  exchangeGitHubAppUserCode,
  findGitHubUserAccessibleRepository,
  getGitHubUserProfile,
} from "@fpllm/github";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  constantTimeEqual,
  getCurrentLearner,
  githubAppUserOAuthConfig,
  REPOSITORY_AUTHORIZATION_COOKIE_NAME,
  REPOSITORY_AUTHORIZATION_TTL_MS,
  REPOSITORY_OAUTH_PKCE_COOKIE_NAME,
  REPOSITORY_OAUTH_REQUEST_COOKIE_NAME,
  REPOSITORY_OAUTH_STATE_COOKIE_NAME,
  repositoryAuthorizationSecret,
  secureCookie,
  signRepositoryAuthorization,
  webOrigin,
} from "@/lib/auth";

function clearFlowCookies(response: NextResponse) {
  response.cookies.delete(REPOSITORY_OAUTH_STATE_COOKIE_NAME);
  response.cookies.delete(REPOSITORY_OAUTH_PKCE_COOKIE_NAME);
  response.cookies.delete(REPOSITORY_OAUTH_REQUEST_COOKIE_NAME);
}

function errorResponse(code: string, status: number) {
  return NextResponse.json({ ok: false, code }, { status });
}

export async function GET(request: Request) {
  const current = await getCurrentLearner();
  if (!current) return errorResponse("AUTHENTICATION_REQUIRED", 401);
  if (current.mode !== "session" || !current.session) return errorResponse("REAL_SESSION_REQUIRED", 409);

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  if (!code || !state) return errorResponse("GITHUB_APP_USER_CALLBACK_INVALID", 400);

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(REPOSITORY_OAUTH_STATE_COOKIE_NAME)?.value;
  const verifier = cookieStore.get(REPOSITORY_OAUTH_PKCE_COOKIE_NAME)?.value;
  const encodedRequest = cookieStore.get(REPOSITORY_OAUTH_REQUEST_COOKIE_NAME)?.value;
  if (!expectedState || !verifier || !encodedRequest || !constantTimeEqual(state, expectedState)) {
    return errorResponse("GITHUB_APP_USER_STATE_INVALID", 400);
  }

  let requested: unknown;
  try {
    requested = JSON.parse(Buffer.from(encodedRequest, "base64url").toString("utf8"));
  } catch {
    return errorResponse("GITHUB_APP_USER_REQUEST_INVALID", 400);
  }
  const parsedRequest = repositoryDiscoverySchema.safeParse(requested);
  if (!parsedRequest.success) return errorResponse("GITHUB_APP_USER_REQUEST_INVALID", 400);

  try {
    const config = githubAppUserOAuthConfig();
    const origin = webOrigin(requestUrl);
    const redirectUri = `${origin}/auth/github-app/callback`;
    const token = await exchangeGitHubAppUserCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri,
      codeVerifier: verifier,
    });

    const [profile, identity] = await Promise.all([
      getGitHubUserProfile(token),
      prisma.identity.findFirst({
        where: { userId: current.user.id, provider: "github" },
        select: { providerUserId: true },
      }),
    ]);
    if (!identity || identity.providerUserId !== String(profile.id)) {
      return errorResponse("GITHUB_APP_USER_IDENTITY_MISMATCH", 403);
    }

    const authorized = await findGitHubUserAccessibleRepository({
      token,
      owner: parsedRequest.data.owner,
      repo: parsedRequest.data.repo,
    });

    const now = Date.now();
    const authorization = signRepositoryAuthorization(
      {
        version: 1,
        userId: current.user.id,
        sessionId: current.session.id,
        installationId: String(authorized.installationId),
        repositoryId: String(authorized.repositoryId),
        owner: authorized.owner,
        repo: authorized.name,
        defaultBranch: authorized.defaultBranch,
        expiresAt: now + REPOSITORY_AUTHORIZATION_TTL_MS,
      },
      repositoryAuthorizationSecret(),
    );

    const response = NextResponse.redirect(
      new URL(`/setup/repository?authorized=1&ref=${encodeURIComponent(parsedRequest.data.ref)}`, origin),
      { status: 303 },
    );
    clearFlowCookies(response);
    response.cookies.set(REPOSITORY_AUTHORIZATION_COOKIE_NAME, authorization, {
      httpOnly: true,
      secure: secureCookie(),
      sameSite: "lax",
      path: "/",
      maxAge: REPOSITORY_AUTHORIZATION_TTL_MS / 1000,
    });
    return response;
  } catch (error) {
    const codeValue = error instanceof Error ? error.message : "GITHUB_APP_USER_AUTHORIZATION_FAILED";
    const origin = webOrigin(requestUrl);
    const response = NextResponse.redirect(
      new URL(`/setup/repository?error=${encodeURIComponent(codeValue)}`, origin),
      { status: 303 },
    );
    clearFlowCookies(response);
    response.cookies.delete(REPOSITORY_AUTHORIZATION_COOKIE_NAME);
    return response;
  }
}

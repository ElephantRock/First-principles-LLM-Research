import { createSessionForUser, provisionGitHubIdentity } from "@fpllm/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  constantTimeEqual,
  githubOAuthConfig,
  OAUTH_RETURN_TO_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  sanitizeReturnTo,
  secureCookie,
  SESSION_COOKIE_NAME,
  webOrigin,
} from "@/lib/auth";

type GitHubTokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GitHubUserResponse = {
  id?: number;
  login?: string;
  name?: string | null;
};

function errorResponse(code: string, status: number) {
  return NextResponse.json({ ok: false, code }, { status });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  if (!code || !state) return errorResponse("GITHUB_OAUTH_CALLBACK_INVALID", 400);

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value;
  if (!expectedState || !constantTimeEqual(state, expectedState)) {
    return errorResponse("GITHUB_OAUTH_STATE_INVALID", 400);
  }

  let config: ReturnType<typeof githubOAuthConfig>;
  try {
    config = githubOAuthConfig();
  } catch {
    return errorResponse("GITHUB_OAUTH_NOT_CONFIGURED", 503);
  }

  const origin = webOrigin(requestUrl);
  const redirectUri = `${origin}/auth/github/callback`;
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "First-Principles-LLM-Research",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) return errorResponse("GITHUB_OAUTH_TOKEN_EXCHANGE_FAILED", 502);

  const tokenPayload = (await tokenResponse.json()) as GitHubTokenResponse;
  if (!tokenPayload.access_token || tokenPayload.error) {
    return errorResponse("GITHUB_OAUTH_TOKEN_EXCHANGE_REJECTED", 401);
  }

  const profileResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokenPayload.access_token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "First-Principles-LLM-Research",
    },
    cache: "no-store",
  });
  if (!profileResponse.ok) return errorResponse("GITHUB_PROFILE_FETCH_FAILED", 502);

  const profile = (await profileResponse.json()) as GitHubUserResponse;
  if (!Number.isSafeInteger(profile.id) || !profile.login) {
    return errorResponse("GITHUB_PROFILE_INVALID", 502);
  }

  const user = await provisionGitHubIdentity({
    providerUserId: String(profile.id),
    login: profile.login,
    displayName: profile.name ?? profile.login,
  });
  const { token, session } = await createSessionForUser(user.id);
  const returnTo = sanitizeReturnTo(cookieStore.get(OAUTH_RETURN_TO_COOKIE_NAME)?.value);

  const response = NextResponse.redirect(new URL(returnTo, origin));
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  response.cookies.delete(OAUTH_STATE_COOKIE_NAME);
  response.cookies.delete(OAUTH_RETURN_TO_COOKIE_NAME);
  return response;
}

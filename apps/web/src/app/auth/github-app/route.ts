import { randomBytes } from "node:crypto";
import { repositoryDiscoverySchema } from "@fpllm/api-contracts";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getCurrentLearner,
  githubAppUserOAuthConfig,
  pkceChallenge,
  REPOSITORY_OAUTH_PKCE_COOKIE_NAME,
  REPOSITORY_OAUTH_REQUEST_COOKIE_NAME,
  REPOSITORY_OAUTH_STATE_COOKIE_NAME,
  secureCookie,
  webOrigin,
} from "@/lib/auth";

export async function GET(request: Request) {
  const current = await getCurrentLearner();
  if (!current) return NextResponse.json({ ok: false, code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  if (current.mode !== "session" || !current.session) {
    return NextResponse.json({ ok: false, code: "REAL_SESSION_REQUIRED" }, { status: 409 });
  }

  const requestUrl = new URL(request.url);
  const parsed = repositoryDiscoverySchema.safeParse({
    owner: requestUrl.searchParams.get("owner"),
    repo: requestUrl.searchParams.get("repo"),
    ref: requestUrl.searchParams.get("ref") || "main",
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "REQUEST_INVALID", errors: parsed.error.flatten() }, { status: 400 });
  }

  let config: ReturnType<typeof githubAppUserOAuthConfig>;
  try {
    config = githubAppUserOAuthConfig();
  } catch {
    return NextResponse.json({ ok: false, code: "GITHUB_APP_USER_OAUTH_NOT_CONFIGURED" }, { status: 503 });
  }

  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const origin = webOrigin(requestUrl);
  const redirectUri = `${origin}/auth/github-app/callback`;
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", pkceChallenge(verifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizeUrl);
  const options = {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 10 * 60,
  };
  response.cookies.set(REPOSITORY_OAUTH_STATE_COOKIE_NAME, state, options);
  response.cookies.set(REPOSITORY_OAUTH_PKCE_COOKIE_NAME, verifier, options);
  response.cookies.set(
    REPOSITORY_OAUTH_REQUEST_COOKIE_NAME,
    Buffer.from(JSON.stringify(parsed.data), "utf8").toString("base64url"),
    options,
  );
  return response;
}

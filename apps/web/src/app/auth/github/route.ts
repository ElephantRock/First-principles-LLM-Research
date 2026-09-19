import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  githubOAuthConfig,
  OAUTH_RETURN_TO_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  sanitizeReturnTo,
  secureCookie,
  webOrigin,
} from "@/lib/auth";

export async function GET(request: Request) {
  let config: ReturnType<typeof githubOAuthConfig>;
  try {
    config = githubOAuthConfig();
  } catch {
    return NextResponse.json(
      { ok: false, code: "GITHUB_OAUTH_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const requestUrl = new URL(request.url);
  const origin = webOrigin(requestUrl);
  const redirectUri = `${origin}/auth/github/callback`;
  const returnTo = sanitizeReturnTo(requestUrl.searchParams.get("returnTo"));
  const state = randomBytes(24).toString("base64url");

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "read:user");
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl);
  const sharedCookieOptions = {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 10 * 60,
  };
  response.cookies.set(OAUTH_STATE_COOKIE_NAME, state, sharedCookieOptions);
  response.cookies.set(OAUTH_RETURN_TO_COOKIE_NAME, returnTo, sharedCookieOptions);
  return response;
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getDemoUser, resolveSessionToken } from "@fpllm/db";
import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "fpllm_session";
export const OAUTH_STATE_COOKIE_NAME = "fpllm_oauth_state";
export const OAUTH_RETURN_TO_COOKIE_NAME = "fpllm_oauth_return_to";
export const REPOSITORY_OAUTH_STATE_COOKIE_NAME = "fpllm_repo_oauth_state";
export const REPOSITORY_OAUTH_PKCE_COOKIE_NAME = "fpllm_repo_oauth_pkce";
export const REPOSITORY_OAUTH_REQUEST_COOKIE_NAME = "fpllm_repo_oauth_request";
export const REPOSITORY_AUTHORIZATION_COOKIE_NAME = "fpllm_repo_authorization";
export const REPOSITORY_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

export interface RepositoryAuthorizationPayload {
  version: 1;
  userId: string;
  sessionId: string;
  installationId: string;
  repositoryId: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  expiresAt: number;
}

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("AUTHENTICATION_REQUIRED");
    this.name = "AuthenticationRequiredError";
  }
}

export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/home";
  if (value.startsWith("/auth/")) return "/home";
  return value;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function githubOAuthConfig() {
  const clientId = process.env.FPLLM_GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.FPLLM_GITHUB_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("GITHUB_OAUTH_NOT_CONFIGURED");
  return { clientId, clientSecret };
}

export function githubAppUserOAuthConfig() {
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("GITHUB_APP_USER_OAUTH_NOT_CONFIGURED");
  return { clientId, clientSecret };
}

export function repositoryAuthorizationSecret() {
  const secret = process.env.FPLLM_REPOSITORY_AUTH_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("FPLLM_REPOSITORY_AUTH_SECRET_INVALID");
  }
  return secret;
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

function repositoryAuthorizationSignature(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(`fpllm-repository-authorization-v1:${encodedPayload}`).digest("base64url");
}

export function signRepositoryAuthorization(payload: RepositoryAuthorizationPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${repositoryAuthorizationSignature(encoded, secret)}`;
}

export function verifyRepositoryAuthorization(input: {
  token: string;
  secret: string;
  userId: string;
  sessionId: string;
  now?: number;
}): RepositoryAuthorizationPayload | null {
  const [encoded, signature, extra] = input.token.split(".");
  if (!encoded || !signature || extra !== undefined) return null;
  const expected = repositoryAuthorizationSignature(encoded, input.secret);
  if (!constantTimeEqual(signature, expected)) return null;

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const now = input.now ?? Date.now();
  if (
    payload.version !== 1 ||
    payload.userId !== input.userId ||
    payload.sessionId !== input.sessionId ||
    typeof payload.installationId !== "string" || !/^\d+$/.test(payload.installationId) ||
    typeof payload.repositoryId !== "string" || !/^\d+$/.test(payload.repositoryId) ||
    typeof payload.owner !== "string" || payload.owner.length < 1 || payload.owner.length > 100 ||
    typeof payload.repo !== "string" || payload.repo.length < 1 || payload.repo.length > 100 ||
    typeof payload.defaultBranch !== "string" || payload.defaultBranch.length < 1 || payload.defaultBranch.length > 255 ||
    typeof payload.expiresAt !== "number" || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= now
  ) return null;

  return payload as unknown as RepositoryAuthorizationPayload;
}

export function webOrigin(requestUrl: URL): string {
  const configured = process.env.FPLLM_WEB_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return requestUrl.origin;
}

export function secureCookie(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function getCurrentLearner() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const resolved = await resolveSessionToken(token);
    if (resolved) return { mode: "session" as const, ...resolved };
  }

  // Explicit migration/test escape hatch only. Production defaults to disabled.
  if (process.env.FPLLM_DEMO_AUTH === "1") {
    const user = await getDemoUser();
    return { mode: "demo" as const, user, session: null };
  }
  return null;
}

export async function requireCurrentLearner() {
  const current = await getCurrentLearner();
  if (!current) throw new AuthenticationRequiredError();
  return current;
}

export function authenticationErrorResponse(error: unknown): { code: string; status: number } | null {
  if (error instanceof AuthenticationRequiredError || (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED")) {
    return { code: "AUTHENTICATION_REQUIRED", status: 401 };
  }
  return null;
}

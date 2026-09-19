import { timingSafeEqual } from "node:crypto";
import { resolveSessionToken } from "@fpllm/db";
import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "fpllm_session";
export const OAUTH_STATE_COOKIE_NAME = "fpllm_oauth_state";
export const OAUTH_RETURN_TO_COOKIE_NAME = "fpllm_oauth_return_to";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("AUTHENTICATION_REQUIRED");
    this.name = "AuthenticationRequiredError";
  }
}

export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/home";
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
  if (!token) return null;
  return resolveSessionToken(token);
}

export async function requireCurrentLearner() {
  const current = await getCurrentLearner();
  if (!current) throw new AuthenticationRequiredError();
  return current;
}

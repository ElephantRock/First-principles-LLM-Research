import { randomUUID } from "node:crypto";
import {
  createSessionForUser,
  getDemoUser,
  provisionGitHubIdentity,
  revokeSessionToken,
} from "@fpllm/db";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, secureCookie } from "../../../../../lib/auth";

function enabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.FPLLM_E2E_AUTH === "1";
}

function unavailable() {
  return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}

export async function POST(request: NextRequest) {
  if (!enabled()) return unavailable();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const mode = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).mode
    : undefined;

  let user;
  if (mode === "demo") {
    user = await getDemoUser();
  } else if (mode === "fresh") {
    const suffix = randomUUID();
    user = await provisionGitHubIdentity({
      providerUserId: `playwright-${suffix}`,
      login: `playwright-${suffix}`,
      displayName: "Playwright Fresh Learner",
    });
  } else {
    return NextResponse.json({ error: "INVALID_MODE" }, { status: 400 });
  }

  const { token, session } = await createSessionForUser(user.id, { ttlMs: 10 * 60 * 1000 });
  const response = NextResponse.json(
    {
      ok: true,
      mode,
      user: { id: user.id, handle: user.handle, displayName: user.displayName },
      session: { id: session.id, expiresAt: session.expiresAt.toISOString() },
    },
    { status: 201 },
  );
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!enabled()) return unavailable();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) await revokeSessionToken(token);

  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: 0,
  });
  return response;
}

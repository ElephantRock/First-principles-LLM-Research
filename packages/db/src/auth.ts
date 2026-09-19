import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./client";

export const GITHUB_IDENTITY_PROVIDER = "github";
export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ProvisionGitHubIdentityInput {
  providerUserId: string;
  login: string;
  displayName?: string | null;
}

export interface CreateSessionOptions {
  ttlMs?: number;
  now?: Date;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeHandle(login: string): string {
  const normalized = login
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "github-user";
}

/**
 * Resolve a GitHub identity to one internal learner without ever linking accounts
 * by mutable profile fields such as login or display name.
 */
export async function provisionGitHubIdentity(input: ProvisionGitHubIdentityInput) {
  if (!input.providerUserId.trim()) throw new Error("GITHUB_PROVIDER_USER_ID_REQUIRED");
  if (!input.login.trim()) throw new Error("GITHUB_LOGIN_REQUIRED");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.identity.findUnique({
      where: {
        provider_providerUserId: {
          provider: GITHUB_IDENTITY_PROVIDER,
          providerUserId: input.providerUserId,
        },
      },
      include: { user: true },
    });

    if (existing) {
      if (input.displayName !== undefined && input.displayName !== existing.user.displayName) {
        return tx.user.update({
          where: { id: existing.userId },
          data: { displayName: input.displayName },
        });
      }
      return existing.user;
    }

    const baseHandle = normalizeHandle(input.login);
    const collision = await tx.user.findUnique({ where: { handle: baseHandle } });
    const handle = collision ? `${baseHandle}-${input.providerUserId}` : baseHandle;

    const user = await tx.user.create({
      data: {
        handle,
        displayName: input.displayName ?? input.login,
      },
    });

    await tx.identity.create({
      data: {
        userId: user.id,
        provider: GITHUB_IDENTITY_PROVIDER,
        providerUserId: input.providerUserId,
      },
    });

    return user;
  });
}

/** Create an opaque bearer session. Only its SHA-256 digest is persisted. */
export async function createSessionForUser(userId: string, options: CreateSessionOptions = {}) {
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("SESSION_TTL_INVALID");

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(now.getTime() + ttlMs);
  const session = await prisma.session.create({
    data: { userId, tokenHash, expiresAt },
  });

  return { token, session };
}

export async function resolveSessionToken(token: string, now = new Date()) {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= now.getTime()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  return { session, user: session.user };
}

export async function revokeSessionToken(token: string) {
  if (!token) return { count: 0 };
  return prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

export async function revokeAllUserSessions(userId: string) {
  return prisma.session.deleteMany({ where: { userId } });
}

export async function deleteExpiredSessions(now = new Date()) {
  return prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
}

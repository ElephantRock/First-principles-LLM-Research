import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./client";
import {
  createSessionForUser,
  hashSessionToken,
  provisionGitHubIdentity,
  resolveSessionToken,
  revokeSessionToken,
} from "./auth";

const PROVIDER_USER_ID = "999000111";

async function cleanup() {
  const identity = await prisma.identity.findUnique({
    where: {
      provider_providerUserId: {
        provider: "github",
        providerUserId: PROVIDER_USER_ID,
      },
    },
  });
  if (identity) await prisma.user.delete({ where: { id: identity.userId } });
}

test("GitHub identity is stable and sessions store only token digests", async () => {
  await cleanup();
  try {
    const user = await provisionGitHubIdentity({
      providerUserId: PROVIDER_USER_ID,
      login: "auth-integration-user",
      displayName: "Auth Integration User",
    });
    assert.equal(user.handle, "auth-integration-user");

    const sameUser = await provisionGitHubIdentity({
      providerUserId: PROVIDER_USER_ID,
      login: "renamed-login",
      displayName: "Renamed Display Name",
    });
    assert.equal(sameUser.id, user.id);
    assert.equal(sameUser.handle, "auth-integration-user");
    assert.equal(sameUser.displayName, "Renamed Display Name");

    const { token, session } = await createSessionForUser(user.id, { ttlMs: 60_000 });
    assert.ok(token.length >= 40);
    assert.notEqual(session.tokenHash, token);
    assert.equal(session.tokenHash, hashSessionToken(token));

    const resolved = await resolveSessionToken(token);
    assert.equal(resolved?.user.id, user.id);
    assert.equal(resolved?.session.id, session.id);

    const revoked = await revokeSessionToken(token);
    assert.equal(revoked.count, 1);
    assert.equal(await resolveSessionToken(token), null);
  } finally {
    await cleanup();
  }
});

test("expired sessions fail closed and are removed", async () => {
  await cleanup();
  try {
    const user = await provisionGitHubIdentity({
      providerUserId: PROVIDER_USER_ID,
      login: "auth-expiry-user",
    });
    const { token, session } = await createSessionForUser(user.id, {
      ttlMs: 1_000,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const resolved = await resolveSessionToken(token, new Date("2026-01-01T00:00:02.000Z"));
    assert.equal(resolved, null);
    assert.equal(await prisma.session.findUnique({ where: { id: session.id } }), null);
  } finally {
    await cleanup();
  }
});

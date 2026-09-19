import { describe, expect, it } from "vitest";
import {
  pkceChallenge,
  signRepositoryAuthorization,
  verifyRepositoryAuthorization,
  type RepositoryAuthorizationPayload,
} from "./auth";

const SECRET = "repository-authorization-test-secret-with-more-than-32-bytes";
const PAYLOAD: RepositoryAuthorizationPayload = {
  version: 1,
  userId: "00000000-0000-0000-0000-000000000001",
  sessionId: "00000000-0000-0000-0000-000000000002",
  installationId: "12345",
  repositoryId: "67890",
  owner: "learner",
  repo: "course-work",
  defaultBranch: "main",
  expiresAt: 2_000_000,
};

describe("repository authorization", () => {
  it("round-trips a session-bound signed authorization", () => {
    const token = signRepositoryAuthorization(PAYLOAD, SECRET);
    expect(verifyRepositoryAuthorization({
      token,
      secret: SECRET,
      userId: PAYLOAD.userId,
      sessionId: PAYLOAD.sessionId,
      now: 1_000_000,
    })).toEqual(PAYLOAD);
  });

  it("fails closed for tampering, another session, or expiry", () => {
    const token = signRepositoryAuthorization(PAYLOAD, SECRET);
    expect(verifyRepositoryAuthorization({
      token: token.replace(/.$/, token.endsWith("a") ? "b" : "a"),
      secret: SECRET,
      userId: PAYLOAD.userId,
      sessionId: PAYLOAD.sessionId,
      now: 1_000_000,
    })).toBeNull();
    expect(verifyRepositoryAuthorization({
      token,
      secret: SECRET,
      userId: PAYLOAD.userId,
      sessionId: "00000000-0000-0000-0000-000000000003",
      now: 1_000_000,
    })).toBeNull();
    expect(verifyRepositoryAuthorization({
      token,
      secret: SECRET,
      userId: PAYLOAD.userId,
      sessionId: PAYLOAD.sessionId,
      now: PAYLOAD.expiresAt,
    })).toBeNull();
  });

  it("derives the RFC 7636 S256 challenge", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

# Platform v0.4 — Real Learner Identity & Onboarding

Status: IN PROGRESS

Baseline: `19e9edd1bd44276967979916cf33d9390ddc4d8c` (verified Platform v0.3)

## Objective

Move the web platform from a seeded single-learner prototype to a request-scoped learner identity without weakening the v0.3 evidence or execution boundaries.

The v0.4 critical path is:

```text
GitHub OAuth identity
    -> internal User + immutable provider identity
    -> opaque server-side session
    -> request-scoped learner authorization
    -> repository onboarding
    -> environment qualification
    -> real submission/status workflow
```

Authentication and repository authorization remain deliberately separate:

```text
human authentication = GitHub OAuth
repository execution = least-privilege GitHub App installation
```

An OAuth access token is used only to resolve the learner's GitHub profile during sign-in. It is not persisted and is not used by the worker.

## Identity invariants

1. A GitHub account is linked by immutable GitHub numeric user ID, never by mutable login, display name, or email.
2. Session bearer tokens are never stored in plaintext. PostgreSQL stores only SHA-256 token digests.
3. Expired or revoked sessions fail closed.
4. Every learner-owned read/write must ultimately include the authenticated internal `userId` in its authorization predicate.
5. A learner session never grants repository access by itself. Repository access must still resolve through a bound GitHub App installation.
6. The v0.3 sandbox boundary remains unchanged: web/control plane != learner-code execution process.

## Increment plan

### V4.1 — identity/session foundation

- GitHub OAuth start/callback routes;
- `Identity(provider=github, providerUserId=<numeric id>)` provisioning;
- opaque session creation/resolution/revocation;
- `/api/v1/me`;
- sign-in and sign-out surfaces;
- integration tests for identity stability, token hashing, expiry and revocation.

### V4.2 — remove demo actor from application services

Replace `*ForDemo` and `getDemoSnapshot()` application calls with explicit `userId`-scoped operations. The seed learner remains only as deterministic test fixture data.

Release gate: no production API or page may obtain authority by looking up `handle=demo`.

### V4.3 — repository onboarding

Authenticated learner -> GitHub App installation -> permitted repository -> immutable repository binding. Repository binding must remain independent from OAuth identity tokens.

### V4.4 — environment qualification

Persist the learner's real environment report and selected 8/12/16 GB execution profile. Setup diagnostics remain evidence-producing rather than a binary compatibility screen.

### V4.5 — real submission/status UX

```text
Repository -> Branch -> Commit -> Submit -> Queued -> Running -> Evidence
```

Submission creation must bind authenticated learner ID, repository binding, exact 40-character SHA, lab/test versions and durable worker evidence.

## v0.4 completion gate

v0.4 is complete when a newly authenticated learner with no seed data can:

1. sign in with GitHub;
2. receive an internal learner identity and revocable session;
3. enroll/select the course track;
4. bind an authorized GitHub App repository;
5. submit an immutable commit;
6. observe durable queued/running/completed state;
7. receive public/hidden evidence from the v0.3 isolated worker path;
8. create an experiment only from their own passing submission evidence;
9. sign out and lose access to learner-owned resources;
10. pass a two-user isolation test proving one learner cannot read or mutate another learner's submissions, experiments, journal, mastery, compute profile or repository bindings.

## Deferred

This milestone does not add social features, billing, certificates, generic managed GPU orchestration, or broad course-content expansion. It productionizes the learner/evidence boundary first.

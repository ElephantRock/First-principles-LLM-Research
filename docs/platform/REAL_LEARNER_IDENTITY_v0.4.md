# Platform v0.4 — Real Learner Identity & Onboarding

Status: VERIFIED / MERGED

Baseline: `19e9edd1bd44276967979916cf33d9390ddc4d8c` (verified Platform v0.3)

Frozen release candidate: `675411a4708ab56d2572c9e7feff9a489cd01159`  
Green CI: `35458491960` (#159), quality job `105938251115`  
Merged to `main`: `fd3f04bf37627f4ef71179aa36985e0dbf5329a0`

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

## Implemented increments

### V4.1 — identity/session foundation — VERIFIED

- GitHub OAuth start/callback routes;
- `Identity(provider=github, providerUserId=<numeric id>)` provisioning;
- opaque session creation/resolution/revocation;
- `/api/v1/me`;
- sign-in and sign-out surfaces;
- integration tests for identity stability, token hashing, expiry and revocation.

### V4.2 — request-scoped learner services — VERIFIED

Production APIs and pages use explicit authenticated `userId` scopes. The seed learner remains only behind the explicit `FPLLM_DEMO_AUTH=1` migration/test escape hatch.

The two-user isolation gate covers repositories, submissions, experiments, artifact import, interpretation, compute state and mastery evidence.

### V4.3 — repository onboarding — VERIFIED

The onboarding authorization chain is:

```text
authenticated learner session
    -> GitHub App user OAuth + PKCE
    -> transient GitHub App user access token
    -> verify immutable GitHub numeric user ID matches learner identity
    -> prove user token can reach requested repository through an App installation
    -> discard user access token
    -> mint 10-minute server-signed, session-bound repository authorization
    -> resolve repository again with GitHub App installation token
    -> compare immutable repository ID
    -> persist learner-owned Repository + RepositoryBinding
```

The repository-binding API does **not** accept a caller-supplied installation ID as authority. Installation identity alone is insufficient. The platform requires a GitHub App **user access token** to prove that the authenticated learner can access the requested repository, then discards that token rather than persisting it.

The signed repository authorization is bound to the internal `userId` and current session ID, has a ten-minute expiry, and is authenticated with a server-only HMAC secret. The final bind independently resolves the repository through the installation token and compares the immutable GitHub repository ID before writing evidence state.

Required deployment configuration for this flow:

- GitHub App client ID and client secret;
- GitHub App callback URL: `<FPLLM_WEB_ORIGIN>/auth/github-app/callback`;
- GitHub App slug for the install/configure link;
- `FPLLM_REPOSITORY_AUTH_SECRET` containing at least 32 random bytes.

### V4.4 — environment qualification — VERIFIED

The learner's real environment report and selected 8/12/16 GB execution profile are persisted as learner-owned state/evidence. Setup diagnostics remain evidence-producing rather than a binary compatibility screen.

CPU/no-CUDA environments receive the diagnostic state required for later CUDA work rather than being rejected from compatible work.

### V4.5 — real submission/status UX — VERIFIED

```text
Repository -> Branch -> Commit -> Submit -> Queued -> Running -> Evidence
```

Submission creation binds authenticated learner ID, repository binding, exact 40-character SHA, lab/test versions and durable worker evidence.

The learner-facing status path distinguishes:

- queued;
- running/active qualification;
- passed/needs-revision terminal evidence;
- terminal infrastructure error.

Terminal evidence links into the public/hidden evidence screen and passing evidence hands off to the experiment flow.

## Browser release-gate hardening

The release candidate removed the browser dependency on seeded demo authority:

- Playwright web-server process forces `FPLLM_DEMO_AUTH=0`;
- test-only fixture APIs fail closed unless `NODE_ENV != production` and `FPLLM_E2E_AUTH=1`;
- the session fixture creates normal opaque DB-backed sessions and the normal HttpOnly `fpllm_session` cookie;
- Playwright interacts with fixtures over HTTP and does not import Prisma/DB implementation into the Playwright runner;
- routable `/api/v1/e2e/*` wrappers expose fixture handlers only through the same production-disabled authorization gate;
- the no-seed browser gate provisions a fresh identity, records environment evidence, binds a fixture repository, verifies immutable-commit UI, queues a learner-owned submission, observes queued -> running through live polling, persists six passing invariant results, opens the evidence screen, and verifies the experiment handoff;
- the complete gate runs on desktop Chrome and iPhone 14 projects;
- fixture routes cannot be enabled in a production build.

These fixture transitions exist only to exercise browser state transitions. They do **not** replace the v0.3 real GitHub App / isolated-worker staging proof.

## Release evidence

The frozen release candidate is:

`675411a4708ab56d2572c9e7feff9a489cd01159`

Release CI:

- workflow run `35458491960` (#159);
- green quality job `105938251115`;
- runtime validation: green;
- typecheck: green;
- tests: green;
- production build: green;
- desktop/mobile no-seed Playwright: green.

Runtime release-evidence artifact:

- name: `runtime-release-evidence-35458491960`;
- artifact ID: `10589106988`;
- artifact SHA-256: `31ac007b58c06a262fb93ede2d6a7ef779c23a700cc1bdd0b65aca0f0f884e84`.

The first attempt of CI #159 hit a transient Docker cleanup race after runtime assertions had already passed (`removal of container ... is already in progress`). The same job was re-run without code changes and the complete chain passed.

PR #7 was moved out of draft and squash-merged because the repository disallows merge commits. The resulting `main` commit is:

`fd3f04bf37627f4ef71179aa36985e0dbf5329a0`

## v0.4 completion gate — SATISFIED

The verified v0.4 baseline proves the no-seed learner identity/onboarding and submission lifecycle while preserving the v0.3 execution/evidence boundary.

The next milestone is Platform v0.5: production beta and real learner validation.

## Deferred

This milestone does not add social features, billing, certificates, generic managed GPU orchestration, or broad course-content expansion. It productionizes the learner/evidence boundary first.

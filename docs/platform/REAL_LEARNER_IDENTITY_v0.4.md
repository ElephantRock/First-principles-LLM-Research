# Platform v0.4 — Real Learner Identity & Onboarding

Status: MERGED HISTORICAL BASELINE / POST-RELEASE EVIDENCE QUALIFICATION APPLIES

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
    -> repository onboarding implementation
    -> environment qualification
    -> real submission/status workflow
```

Authentication and repository authorization remain deliberately separate:

```text
human authentication = GitHub OAuth
repository execution = least-privilege GitHub App installation
```

An OAuth access token used for human sign-in resolves the learner's GitHub profile and is not persisted as a worker credential.

## Post-release review correction

A Codex review completed after the v0.4 candidate had already been merged identified two evidence-claim gaps in the release record:

1. the new GitHub App **user OAuth + PKCE repository-binding chain was implemented but was not exercised end to end by the recorded v0.4 release gate**; the no-seed browser test binds through a production-disabled learner fixture, while the v0.3 staging evidence predates this user-authorization chain;
2. the original v0.4 completion checklist required a new learner to enroll/select a course track, but the frozen v0.4 candidate did not provide a real fresh-learner enrollment/track-selection path.

Therefore this document no longer uses the frozen v0.4 CI run as evidence for those two claims. The merged release remains a historical implementation baseline, but its verification scope is narrowed to the evidence actually recorded.

The same post-release review also found three concrete implementation defects now tracked for remediation on top of the merged baseline:

- unsafe backslash-containing OAuth return paths;
- possible mismatch between a captured environment report and an independently selected compute profile when reports arrive out of capture order;
- no learner-visible control invoking the POST logout/session-revocation route.

Those defects do not alter the immutable v0.4 candidate record. Their fixes are post-v0.4 remediation evidence.

## Identity invariants

1. A GitHub account is linked by immutable GitHub numeric user ID, never by mutable login, display name, or email.
2. Session bearer tokens are never stored in plaintext. PostgreSQL stores only SHA-256 token digests.
3. Expired or revoked sessions fail closed.
4. Every learner-owned read/write must ultimately include the authenticated internal `userId` in its authorization predicate.
5. A learner session never grants repository access by itself. Repository access must still resolve through a bound GitHub App installation.
6. The v0.3 sandbox boundary remains unchanged: web/control plane != learner-code execution process.

## Implemented increments and evidence status

### V4.1 — identity/session foundation — VERIFIED WITH RECORDED TEST EVIDENCE

Implemented:

- GitHub OAuth start/callback routes;
- `Identity(provider=github, providerUserId=<numeric id>)` provisioning;
- opaque session creation/resolution/revocation;
- `/api/v1/me`;
- sign-in and sign-out route primitives;
- integration tests for identity stability, token hashing, expiry and revocation.

The frozen browser gate exercised normal DB-backed bearer sessions rather than demo-auth fallback.

### V4.2 — request-scoped learner services — VERIFIED WITH RECORDED TEST EVIDENCE

Production APIs/pages use explicit authenticated `userId` scopes. The seed learner remains only behind the explicit `FPLLM_DEMO_AUTH=1` migration/test escape hatch.

The two-user isolation gate covers repositories, submissions, experiments, artifact import, interpretation, compute state and mastery evidence.

### V4.3 — repository onboarding — IMPLEMENTED; REAL-FLOW RELEASE VERIFICATION DEFERRED

The implemented onboarding authorization chain is:

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

The repository-binding API does **not** accept a caller-supplied installation ID as authority. The short-lived repository authorization is bound to the internal `userId` and current session ID and authenticated with a server-only HMAC secret.

However, the frozen v0.4 browser release gate did **not** exercise this complete external authorization chain. It used a production-disabled learner fixture to create the repository binding so that browser state transitions could be tested deterministically. The v0.3 real staging run proves the GitHub App installation/worker execution boundary, but it predates the v0.4 user-OAuth/PKCE repository proof.

Accordingly, real end-to-end verification of this chain is a required v0.5 P2 production/staging gate, not a completed v0.4 claim.

Required deployment configuration for the implemented flow:

- GitHub App client ID and client secret;
- GitHub App callback URL: `<FPLLM_WEB_ORIGIN>/auth/github-app/callback`;
- GitHub App slug for the install/configure link;
- `FPLLM_REPOSITORY_AUTH_SECRET` containing at least 32 random bytes.

### V4.4 — environment qualification — IMPLEMENTED; CORE PERSISTENCE PATH VERIFIED

The learner's environment report and selected 8/12/16 GB execution profile are persisted as learner-owned state/evidence. Setup diagnostics remain evidence-producing rather than a binary compatibility screen.

CPU/no-CUDA environments receive the diagnostic state required for later CUDA work rather than being rejected from compatible work.

Post-release review found that the read path could pair the newest-by-capture environment report with a different newest-by-creation compute profile when reports were uploaded out of capture order. That edge case is not treated as verified by the frozen v0.4 run and is covered by post-v0.4 remediation.

### V4.5 — submission/status UX — VERIFIED FOR NO-SEED BROWSER STATE TRANSITIONS

```text
Repository -> Branch -> Commit -> Submit -> Queued -> Running -> Evidence
```

The frozen no-seed browser gate verifies request-scoped learner ownership and the queued/running/terminal/evidence UI lifecycle with production demo authority disabled.

The fixture repository/submission transitions exist only to exercise browser state transitions. They do **not** replace the separately recorded v0.3 real GitHub App -> worker -> Docker staging proof.

## Browser release-gate evidence

The frozen candidate removed the browser dependency on seeded demo authority:

- Playwright web-server process forces `FPLLM_DEMO_AUTH=0`;
- test-only fixture APIs fail closed unless `NODE_ENV != production` and `FPLLM_E2E_AUTH=1`;
- the session fixture creates normal opaque DB-backed sessions and the normal HttpOnly `fpllm_session` cookie;
- Playwright interacts with fixtures over HTTP and does not import Prisma/DB implementation into the Playwright runner;
- routable `/api/v1/e2e/*` wrappers expose fixture handlers only through the same production-disabled authorization gate;
- the no-seed browser gate provisions a fresh identity, records environment evidence, binds a fixture repository, verifies immutable-commit UI, queues a learner-owned submission, observes queued -> running through live polling, persists six passing invariant results, opens the evidence screen, and verifies experiment handoff;
- the complete gate runs on desktop Chrome and iPhone 14 projects;
- fixture routes cannot be enabled in a production build.

This evidence proves the browser/request-scoping lifecycle described above. It does not prove external GitHub App user authorization or real fresh-learner enrollment.

## Frozen release evidence

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

PR #7 was squash-merged because the repository disallows merge commits. The resulting `main` commit is:

`fd3f04bf37627f4ef71179aa36985e0dbf5329a0`

## v0.4 completion-gate qualification

The historical PR described the v0.4 completion gate as satisfied. Post-release review narrows that statement.

The frozen candidate did establish:

- request-scoped real learner identity/session machinery;
- learner-owned service isolation;
- persisted environment/profile evidence;
- no-seed browser onboarding/submission state transitions;
- handoff from passing implementation evidence into the experiment UI;
- preservation of the already verified v0.3 isolated execution boundary.

The frozen candidate did **not** establish, with the recorded release evidence:

1. end-to-end GitHub App user OAuth/PKCE repository authorization and final bind through the real external flow;
2. real fresh-learner enrollment/track selection.

Those are carried forward as explicit requirements of Platform v0.5 P2. Post-v0.4 code remediations may close implementation defects, but they do not retroactively change what CI #159 proved.

## Deferred

This milestone did not add social features, billing, certificates, generic managed GPU orchestration, or broad course-content expansion. Production real-flow validation and the missing learner enrollment/track-selection path are required before the production beta can satisfy P2.

# First Principles LLM Research
## Decision Register v1.2 — Platform v0.4 Baseline and Production-Beta Addendum

**Document version:** 1.2  
**Date:** 2026-09-19  
**Status:** AUTHORITATIVE DELTA OVER `PROJECT_DECISIONS.md` v1.1; POST-REVIEW EVIDENCE QUALIFICATION IN §8

---

# 0. Authority and supersession

This document records decisions made after Consolidated Decision Register v1.1.

Until the next full consolidation, the authoritative project record is:

```text
PROJECT_DECISIONS.md v1.1
+ this v1.2 addendum
```

Where this addendum conflicts with v1.1, **v1.2 supersedes v1.1**. All v1.1 decisions not revised here remain in force.

Section 8 records a post-merge review correction and supersedes any broader verification wording elsewhere in this document where they conflict. In particular, implementation presence must not be read as production or real-external-flow verification unless the cited gate actually exercised that flow.

The next full consolidated register should fold these decisions into the canonical `PROJECT_DECISIONS.md` rather than maintaining indefinite parallel deltas.

---

# 1. Decisions superseded from v1.1

## 1.1 Production web stack — CLOSED

v1.1 §69.5 said the production web technology stack was open. That statement is obsolete because v1.1 §73 already froze the implementation stack and the platform has now been implemented through v0.4.

The frozen baseline remains:

- Node.js 24 LTS;
- TypeScript 5.9+ strict;
- Next.js 16.x App Router;
- React 19.3-compatible;
- pnpm workspaces;
- Turborepo;
- Tailwind CSS 4.x;
- Radix Primitives;
- PostgreSQL 18.x;
- Prisma 7.x;
- PostgreSQL-backed durable jobs;
- GitHub App repository integration;
- separate worker/sandbox execution.

## 1.2 Human authentication — CLOSED FOR CURRENT BASELINE

v1.1 §73.5 said the production identity provider remained open. That statement is superseded.

Human authentication now uses GitHub OAuth to resolve an immutable GitHub numeric user ID into an internal `Identity`/`User` and opaque server-side session.

Repository authorization remains a separate security boundary and still uses the least-privilege GitHub App path.

## 1.3 Interaction/wireframe work — COMPLETED

The v1.0/v1.1 next-step items that called for the Causal Attention interaction/wireframe specification and initial web architecture are complete and are retained only as project history.

## 1.4 Current open items — REVISED

The active open items are now:

1. **Phase 1 physical 8/12/16 GB certification — OPEN EMPIRICAL TASK.**
2. **Final Phase 1 natural-language acceptance envelope — OPEN EMPIRICAL TASK.**
3. **Detailed Phase 2 curriculum/repository specification — OPEN.**
4. **Production infrastructure providers for v0.5 — OPEN, MUST CLOSE AT P0.**
5. **Payment/commerce — OPEN AND DEFERRED.**
6. **Reviewer/instructor tooling — PARTIALLY DEFINED AND NOT A v0.5 REQUIREMENT.**
7. **Hosted compute provider/integration — OPEN.**
8. **Real GitHub App user-OAuth/PKCE repository-binding gate — OPEN EMPIRICAL TASK, REQUIRED AT v0.5 P2.**
9. **Fresh-learner enrollment/track-selection path — OPEN IMPLEMENTATION TASK, REQUIRED AT v0.5 P2.**

---

# 2. Platform implementation baseline through v0.4 — FROZEN

The platform implementation sequence through v0.4 is part of the authoritative baseline. Verification language is limited by the evidence qualification in §8.

## 2.1 v0.1 — vertical-slice scaffold — VERIFIED

The Causal Attention learner loop was implemented first against fixture/mock state to validate the intended Course + Lab + Research + Evidence interaction model before costly infrastructure.

## 2.2 v0.2 — persistence-backed evidence — VERIFIED

PostgreSQL/Prisma persistence replaced fixture authority for durable learner/evidence state.

## 2.3 v0.3 — real submission execution — VERIFIED

Immutable Git commit submissions were connected to the separate worker/sandbox path with public/hidden evidence, durable job state, and runtime provenance.

The invariant remains:

\[
\boxed{
\text{web/control plane}
\neq
\text{learner-code execution process}
}
\]

## 2.4 v0.4 — real learner identity and onboarding — MERGED IMPLEMENTATION BASELINE / EVIDENCE QUALIFIED

Platform v0.4 replaced seeded learner authority in the web/control plane with request-scoped real learner identity while preserving the v0.3 execution/evidence boundary.

Implemented capabilities include:

- GitHub OAuth human identity mapped by immutable numeric GitHub user ID;
- opaque revocable server-side sessions with only token digests persisted;
- request-scoped learner authorization;
- two-user isolation across learner-owned evidence domains;
- GitHub App repository-onboarding code using a separate repository-authorization proof;
- persisted environment qualification and selected 8/12/16 GB profile;
- immutable 40-character commit submission;
- queued/running/terminal submission status;
- explicit terminal infrastructure-error behavior;
- no-seed browser lifecycle coverage with demo fallback disabled;
- desktop and mobile browser validation;
- handoff from passing implementation evidence into the experiment flow.

The frozen release evidence **does not establish** two claims that were stated too broadly in the initial v0.4 release record:

1. it does not exercise the new GitHub App user-OAuth/PKCE repository-binding chain end to end against the real external flow; the browser gate binds through a production-disabled fixture and the v0.3 real staging evidence predates that chain;
2. it does not implement or prove fresh-learner enrollment/track selection, despite that item appearing in the original v0.4 completion checklist.

Frozen v0.4 release identities:

- candidate head: `675411a4708ab56d2572c9e7feff9a489cd01159`;
- green CI: `35458491960` (#159);
- green quality job: `105938251115`;
- runtime evidence artifact: `10589106988`;
- artifact SHA-256: `31ac007b58c06a262fb93ede2d6a7ef779c23a700cc1bdd0b65aca0f0f884e84`;
- squash-merged `main`: `fd3f04bf37627f4ef71179aa36985e0dbf5329a0`.

---

# 3. Real learner identity and repository authorization — FROZEN DESIGN / IMPLEMENTATION CONTRACT

The platform distinguishes human identity from repository execution authority.

\[
\boxed{
\text{human authentication}
\neq
\text{repository authorization}
}
\]

Frozen chain:

```text
GitHub OAuth human identity
    -> internal User + immutable provider identity
    -> opaque server-side session
    -> request-scoped learner authorization

separately:

authenticated learner session
    -> GitHub App user OAuth + PKCE
    -> transient GitHub App user access token
    -> prove learner can reach requested repository through the App
    -> discard user access token
    -> mint short-lived session-bound repository authorization
    -> resolve repository with installation authority
    -> compare immutable repository ID
    -> persist learner-owned binding
```

Security requirements:

1. mutable login/display name/email are not learner identity keys;
2. OAuth user tokens used for identity/repository proof are not persisted as worker credentials;
3. session bearer tokens are not stored in plaintext;
4. expired/revoked sessions fail closed;
5. learner-owned operations are scoped by internal `userId`;
6. caller-supplied installation identity is not sufficient repository authority;
7. repository execution resolves through the least-privilege GitHub App installation path;
8. learner repository code never executes in the web process.

This chain is frozen as the intended production authorization contract. Its real external end-to-end verification remains required by v0.5 P2.

---

# 4. Platform v0.5 — Production Beta & Learner Validation — FROZEN OBJECTIVE

Platform v0.5 must prove the **learner experience**, not merely the platform machinery.

The governing acceptance test is:

> A previously unknown external learner can sign in, select/record their course track, qualify their environment, bind their own authorized GitHub repository through the real GitHub App flow, implement Causal Attention, submit an immutable commit, receive real public/hidden evaluation, run the memory experiment, interpret the evidence, earn mastery, and write the result into the research journal on the deployed platform without fixture authority or privileged operator intervention.

Governing progression:

\[
\boxed{
\text{v0.4 establishes the implementation baseline}
\rightarrow
\text{v0.5 proves the production learner experience}
\rightarrow
\text{expand the curriculum}
}
\]

v0.5 productionizes exactly **one complete Causal Attention vertical slice**.

Required scope:

- production deployment of web, PostgreSQL, worker, and sandbox path;
- explicit production provider decisions before infrastructure implementation;
- real GitHub OAuth and GitHub App configuration;
- fresh-learner enrollment/track selection;
- production secret-management and rotation procedure;
- migrations plus backup/restore procedure;
- artifact storage if required by the experiment flow;
- structured observability across web -> job -> worker -> sandbox -> evidence;
- bounded retries/idempotency;
- rate limits/abuse controls at public trust boundaries;
- deploy/rollback procedure;
- real external learner validation.

Non-goals:

- billing/payments;
- certificates;
- social features;
- generic instructor console;
- browser IDE;
- generic managed GPU fleet;
- broad content expansion;
- Phase 2 implementation;
- multi-cloud work beyond existing provider-neutral interfaces.

---

# 5. v0.5 beta cohort — PROVISIONAL

Initial target: **3–5 technically capable external learners** matching the frozen intended learner profile.

This cohort is a qualitative/operational validation sample, not a statistically representative efficacy study. Percentages from the cohort must not be presented as population-level course-completion estimates.

Before v0.5 can be called a verified beta baseline, at least **three external learners must independently complete the full Causal Attention evidence loop without fixture authority or privileged operator data mutation**.

Additional participants may be recruited after remediation until that evidence exists.

---

# 6. Platform v0.5 release gates — FROZEN

The detailed contract is `docs/platform/PLATFORM_PRODUCTION_BETA_v0.5.md`.

## P0 — production decisions

Explicitly record before production infrastructure implementation:

- hosting/runtime provider;
- PostgreSQL provider;
- S3-compatible artifact decision/provider;
- worker/sandbox provider/technology;
- observability destination;
- secret-management strategy;
- production origin/callback URLs;
- backup retention/restore target;
- deploy/rollback mechanism.

## P1 — production infrastructure

A clean production environment can be provisioned from committed configuration/runbooks, migrations apply without manual database mutation, and backup restore + rollback have each been exercised.

## P2 — real identity, enrollment, and repository authorization

With demo/E2E fixture authority disabled, a new learner must:

1. authenticate through GitHub OAuth and receive a normal revocable session;
2. select and persist a valid course track/enrollment;
3. complete the real GitHub App user-OAuth/PKCE authorization proof;
4. bind only a repository they are authorized to reach through the App;
5. finalize the bind through installation authority and immutable repository identity;
6. sign out and lose access to learner-owned resources.

Fixture-only simulation is not sufficient evidence for P2.

## P3 — real execution/evidence

A learner-owned immutable commit traverses:

```text
submission
-> durable queue
-> isolated worker
-> public tests
-> hidden tests
-> persisted evidence
```

with sufficient provenance/correlation for diagnosis without exposing hidden fixtures or secrets.

## P4 — complete scientific loop

A passing submission continues through:

```text
experiment definition
-> locked prediction
-> memory-scaling measurement
-> results
-> interpretation
-> mastery projection
-> journal entry
```

with immutable/versioned evidence linkage.

## P5 — failure/recovery

Production must demonstrate bounded, diagnosable handling of revoked sessions, lost repository authorization, invalid commits, worker retry/lease failure, sandbox failure/timeout, infrastructure error, duplicate callbacks/requests, rollback, and database restore.

No normal recovery path may require direct privileged editing of learner evidence.

## P6 — external learner validation

At least three external learners independently complete the full evidence loop.

For every blocker/abandonment, record stage, symptom, evidence IDs, diagnostic category, cause classification, assistance, remediation, and retest outcome.

No unresolved critical security/evidence-integrity defect may remain.

## P7 — release evidence freeze

Freeze:

- source SHA;
- production configuration/release identity;
- migration identity;
- worker/runtime image identities;
- evaluator versions;
- production smoke/E2E identities;
- backup/restore + rollback evidence;
- beta completion evidence;
- known limitations.

Only that frozen package may be called the verified v0.5 baseline.

---

# 7. Revised current next-step sequence — v1.2

1. Complete and merge the post-Codex remediation of outstanding v0.3/v0.4/v0.5 review findings, with green CI and review-thread disposition recorded.
2. Complete **P0 provider/operations decisions** before production infrastructure implementation.
3. Implement the missing fresh-learner enrollment/track-selection path before attempting P2 verification.
4. Provision one production Causal Attention vertical slice; do not broaden curriculum scope yet.
5. Prove P1–P5 with fixture/demo authority disabled in production, including the real GitHub App user-OAuth/PKCE repository-binding path at P2.
6. Run the external 3–5 learner beta and collect P6 evidence.
7. Freeze P7 before calling the v0.5 beta baseline verified.
8. Continue Phase 1 8/12/16 GB empirical certification and natural-language acceptance calibration in parallel.
9. Write the detailed Phase 2 — Optimize specification in parallel, but defer broad Phase 2 implementation until v0.5 learner evidence exists.
10. After v0.5 verification, expand the remaining Phase 1 units through the same evidence architecture.

---

# 8. Post-Codex review evidence qualification — AUTHORITATIVE CORRECTION

A review of merged PRs #2, #7, and #8 found actionable Codex comments that had not been dispositioned before merge.

The resulting project rule is:

\[
\boxed{
\text{green CI}
\neq
\text{all review findings addressed}
\neq
\text{real-flow production verification}
}
\]

The following corrections are authoritative:

- v0.3 staging hardening must exist in every active staging release path, including worker-host preflight against the exact digest-pinned runtime images and repository-root-safe worker launch;
- v0.4 release evidence is not evidence of the new GitHub App user-OAuth/PKCE repository-binding chain because the no-seed browser gate used a production-disabled repository fixture;
- v0.4 did not implement the original fresh-learner enrollment/track-selection criterion;
- post-v0.4 remediation must cover unsafe OAuth return-path parsing, environment-report/compute-profile pairing, and learner-visible session revocation;
- unresolved review comments must be explicitly dispositioned before future release PRs are merged.

Future release procedure therefore requires, before merge:

1. CI/release gates green for the exact candidate;
2. all automated and human review threads inspected;
3. each actionable finding fixed or explicitly rejected with evidence/rationale;
4. affected tests/gates rerun;
5. unresolved threads closed only after the disposition is recorded.

This section supersedes any broader wording in §2.4 or historical v0.4 documentation.

---

**End of Decision Register v1.2 Addendum**

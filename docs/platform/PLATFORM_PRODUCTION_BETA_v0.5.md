# Platform v0.5 — Production Beta & Learner Validation

**Status:** RELEASE CONTRACT / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-19  
**Authoritative dependencies:** `PROJECT_DECISIONS.md` v1.1 + `PROJECT_DECISIONS_v1.2.md`; `WEB_PLATFORM_TECHNICAL_ARCHITECTURE_v1.0.md`; verified Platform v0.4

---

## 0. Purpose

Platform v0.5 moves the Causal Attention vertical slice from a verified implementation candidate into a production beta that real external learners can complete without fixture authority or privileged operator intervention.

The milestone is not “deploy the website.” It is:

\[
\boxed{
\text{deployed system}
+
\text{real learner}
+
\text{real repository}
+
\text{real evidence}
+
\text{complete scientific loop}
}
\]

The governing acceptance test is:

> A previously unknown external learner can sign in, qualify their environment, bind their own authorized GitHub repository, implement Causal Attention, submit an immutable commit, receive real public/hidden evaluation, run the memory experiment, interpret the evidence, earn mastery, and write the result into the research journal on the deployed platform without fixture authority or privileged operator intervention.

---

## 1. Baseline inherited from v0.4

v0.5 starts from the verified Platform v0.4 mainline baseline.

Frozen inherited security/evidence boundaries:

```text
human OAuth identity != repository authorization
web/control plane != learner-code execution process
mutable branch name != immutable submission evidence identity
learner session != GitHub App installation authority
public diagnostics != hidden-test fixture disclosure
```

v0.5 must not weaken these boundaries in order to simplify deployment.

### 1.1 Human identity

Human sign-in uses GitHub OAuth only to resolve the learner's immutable GitHub numeric user ID into an internal identity/user and opaque server-side session.

The sign-in OAuth access token is transient. It is not persisted as a worker credential.

### 1.2 Repository authorization

Repository binding remains a separate GitHub App authorization flow. The platform must prove the authenticated learner can reach the requested repository through the App, then independently resolve immutable repository identity through installation authority before persisting a binding.

### 1.3 Execution

Learner code never executes in the Next.js/web process. Public/hidden qualification executes in a separate worker and ephemeral sandbox with the existing isolation contract.

### 1.4 Evidence

Submissions, test results, experiment definitions, locked predictions, artifacts/hashes, interpretations, and mastery evidence remain versioned/append-oriented. The browser cannot directly set mastery.

---

## 2. v0.5 scope

v0.5 productionizes **one** complete unit: Phase 1 Causal Attention.

Required learner path:

```text
Sign in
-> zero-state onboarding
-> environment qualification
-> repository authorization/binding
-> Learning Unit
-> local implementation
-> immutable commit submission
-> queued/running qualification
-> public + hidden evidence
-> experiment creation
-> locked prediction
-> sequence-length memory experiment
-> results/evidence import
-> interpretation
-> mastery computation
-> research journal entry
```

The milestone is complete only when the deployed system carries this path end to end.

---

## 3. Explicit non-goals

Do not add the following to satisfy v0.5:

- billing or payment processing;
- certificates;
- social/community features;
- a generic instructor console;
- a browser IDE;
- a generic managed GPU fleet;
- a generalized multi-course LMS abstraction;
- broad Phase 1 content expansion;
- Phase 2 implementation;
- Redis/OpenSearch merely for scale signaling;
- multi-cloud deployment for its own sake.

If a beta failure demonstrates that one of these is actually necessary for the Causal Attention learner loop, record the evidence and revise the decision register deliberately rather than adding it opportunistically.

---

## 4. Production topology contract

The production shape preserves the existing architecture:

```text
Browser
   |
   v
Web / Next.js
   |-----------------------> S3-compatible artifacts (if required)
   |
   v
PostgreSQL 18
   |
   v
Durable job lease
   |
   v
Worker service
   |
   v
Ephemeral isolated sandbox
   |
   +--> learner immutable Git SHA
   +--> public evaluator
   +--> read-only hidden evaluator
```

GitHub OAuth and the GitHub App integrate with the web/control plane, but learner source execution remains outside it.

Web and worker must remain independently deployable.

---

## 5. P0 — production decisions gate

No production infrastructure implementation starts until the following decisions are explicitly recorded in this document or a linked v0.5 decision record.

| Decision | Required record | Status at specification freeze |
|---|---|---|
| Web/runtime hosting | provider/product, region, deploy mechanism, rollback mechanism, service limits | OPEN |
| PostgreSQL | provider/product, version compatibility, region, backup/PITR policy, restore path | OPEN |
| Artifact storage | S3-compatible provider or explicit “not required for first beta” decision | OPEN |
| Worker/sandbox | provider/technology, isolation primitive, resource limits, image distribution | OPEN |
| Observability | destination for structured logs/traces/metrics or explicit self-hosted/local strategy | OPEN |
| Secrets | secret manager/storage, rotation procedure, least-privilege access model | OPEN |
| Production origin | canonical HTTPS origin plus OAuth/App callback URLs | OPEN |
| DNS/TLS | ownership and certificate lifecycle | OPEN |
| Backup/restore | retention, RPO/RTO target, restore drill procedure | OPEN |
| Release process | production promotion, migration order, smoke gate, rollback | OPEN |

### 5.1 Provider-selection rule

For every external provider, record:

- why it fits the frozen architecture;
- data/region implications relevant to the beta;
- hard service limits that can affect the learner loop;
- minimum viable cost envelope;
- operational failure modes;
- exit/migration path;
- which secrets/permissions it receives.

Provider choice is an architecture decision, not an incidental deployment command.

---

## 6. Production configuration fail-closed rules

The production environment must satisfy all of the following:

```text
NODE_ENV=production
FPLLM_DEMO_AUTH=0
FPLLM_E2E_AUTH=0
```

Test-only/session/learner fixture routes must remain impossible to enable in a production build, even if an environment variable is mis-set.

Production must use:

- real GitHub OAuth credentials;
- real GitHub App credentials/configuration;
- canonical production callback URLs;
- a production repository-authorization signing secret;
- production database credentials;
- production worker/sandbox credentials scoped only to required resources.

The web process must not receive hidden-evaluator material or sandbox credentials it does not require.

---

## 7. Database, migrations, and evidence integrity

### 7.1 Migration discipline

All database migrations remain committed and reviewed.

Production deploys must follow a compatible migration sequence:

```text
expand
-> deploy compatible application
-> backfill if necessary
-> verify
-> contract only in a later compatible release
```

No v0.5 release may depend on a manual production SQL edit that is absent from version control.

### 7.2 Backup/restore

Before inviting external beta learners:

- automated backups/PITR must be enabled according to the P0 decision;
- a restore into a clean non-production target must be exercised;
- restored learner/evidence relationships must be verified;
- the restore evidence must be retained in the v0.5 release record.

### 7.3 Evidence correction

Operational recovery must not rewrite historical learner evidence in place merely to make a failed workflow look successful.

If a result is invalid because of infrastructure failure, record a new attempt/run with provenance and leave the failed evidence attributable.

---

## 8. Artifact storage contract

The first beta may omit remote object storage only if the complete Causal Attention scientific loop does not require artifacts that exceed practical PostgreSQL/request limits.

If artifact storage is used:

- use an S3-compatible interface;
- prefer direct signed upload/download rather than proxying large objects through Next.js;
- store integrity metadata including SHA-256, size, media type, owner, and evidence linkage;
- default learner artifact visibility to private;
- do not execute learner-uploaded content;
- verify expected size/hash after upload where feasible.

The P0 record must make an explicit yes/no decision rather than leaving artifact behavior ambiguous.

---

## 9. Queue, worker, retry, and idempotency contract

### 9.1 Durable work identity

A submission is identified by immutable learner/repository/commit/lab/test-version evidence, not by mutable branch state.

### 9.2 Job leasing

The PostgreSQL-backed queue must provide bounded job leasing/attempt semantics so an abandoned worker does not leave a learner submission permanently “running.”

### 9.3 Retry classes

At minimum distinguish:

- learner-correctable failure;
- deterministic evaluator failure;
- transient external dependency failure;
- transient infrastructure failure;
- terminal infrastructure failure;
- internal invariant violation.

Retries must be bounded and visible in durable event history.

### 9.4 Idempotency

Externally repeated requests/webhooks/callbacks must not create duplicate authoritative evidence.

Idempotency/deduplication must cover at least:

- OAuth/App callback completion where replay is possible;
- repository-binding finalization;
- submission creation with the same client/idempotency identity where supported;
- job completion persistence;
- artifact-finalization callbacks if used.

---

## 10. Production observability contract

Every request and durable job receives a correlation ID that can be followed across the control plane and worker path.

Structured events should include, where applicable:

```text
timestamp
service
environment
correlation_id
request_id / job_id
user_id (internal opaque identifier)
submission_id
test_run_id
experiment_id
repository_id (internal/immutable identifier)
commit_sha
state_transition
attempt
latency_ms
error_class
runtime_image_identity
evaluator_version
```

Do not log:

- OAuth access tokens;
- session bearer tokens;
- GitHub App private keys;
- repository-authorization signing secrets;
- hidden test fixtures;
- unnecessary learner-authored private content.

### 10.1 Minimum beta dashboards/queries

The operator must be able to answer quickly:

- Is the web application healthy?
- Is PostgreSQL reachable and within resource limits?
- Are jobs accumulating faster than workers consume them?
- Which submissions are queued/running/stuck/failed?
- Which worker/sandbox/evaluator version produced a result?
- What fraction of failures are learner-correctable vs infrastructure?
- Can a learner-visible failure be traced without inspecting hidden tests?

---

## 11. Security hardening required before beta

At minimum:

- production/test fixture authority is impossible;
- OAuth state/PKCE/session protections remain active;
- cookies use production-appropriate Secure/HttpOnly/SameSite settings;
- repository authorization remains session-bound and short-lived;
- public API trust boundaries validate input with the existing schema layer;
- rate limits exist for authentication, repository-binding, submission creation, and artifact-initiation endpoints as applicable;
- worker credentials are least privilege and are not exposed to learner sandboxes;
- sandbox network remains disabled by default;
- sandbox execution is non-root with CPU/RAM/PID/time bounds;
- hidden evaluator inputs are read-only to learner execution;
- secrets have a documented rotation procedure;
- dependency/security updates are reviewed before the production candidate is frozen.

v0.5 does not claim formal penetration-test coverage unless one is actually performed and recorded.

---

## 12. Failure/recovery scenarios that must be exercised

Before external learner beta, exercise and retain evidence for:

1. expired/revoked learner session;
2. sign-out followed by attempted access to learner-owned state;
3. repository authorization no longer valid;
4. invalid/nonexistent commit SHA;
5. duplicate submission/callback request;
6. worker process termination while holding a job lease;
7. sandbox timeout;
8. sandbox resource-limit termination;
9. hidden/public evaluator process failure;
10. infrastructure error after a submission has been accepted;
11. production application rollback;
12. database backup restore.

A learner must receive a terminal, diagnosable state rather than indefinite polling.

No recovery procedure may require privileged direct mutation of learner evidence to continue a normal path.

---

## 13. Complete Causal Attention scientific loop

The production learner journey is not complete at “tests passed.”

A passing implementation must continue through the experiment/research stages.

### 13.1 Experiment contract

The canonical sequence-length experiment remains:

\[
S \in \{128,256,512,1024\}
\]

The platform must preserve the experiment definition/version and bind results to the exact passing implementation evidence used to create it.

### 13.2 Locked prediction

A learner records the required prediction/hypothesis before observing/importing the final experiment result set when the unit contract requires it.

Locked predictions are append/version-oriented evidence and cannot be silently rewritten after results are known.

### 13.3 Results and interpretation

The learner must be able to inspect exact values, not only charts, and submit an interpretation that distinguishes:

```text
observation != interpretation != claim
```

### 13.4 Mastery and journal

Mastery is computed server-side from the versioned mastery policy and accumulated evidence.

A successful beta completion ends with a learner-owned research journal entry linked to the evidence chain.

---

## 14. External beta protocol

### 14.1 Cohort

Initial target: **3–5 external technically capable learners** matching the frozen learner profile.

This is a qualitative/operational validation cohort, not a statistically representative efficacy sample.

### 14.2 Compute access

Beta learners may use local or self-provisioned temporary CUDA-capable hardware as required by the Causal Attention experiment. Local GPU ownership is not made a course prerequisite by this beta protocol.

The separate 8/12/16 GB hardware-certification program continues in parallel.

### 14.3 Independence rule

A completion counts toward the v0.5 validation gate only if:

- the learner uses their own normal production account/session;
- the learner binds their own authorized repository;
- no fixture/demo authority is used;
- no operator edits learner-owned database rows/evidence to advance the workflow;
- no hidden-test answer/fixture is disclosed;
- normal documentation/support may be provided, but platform state must advance only through supported product/API paths.

### 14.4 Required successful completions

At least **three external learners** must independently complete the full evidence loop before v0.5 can be called a verified beta baseline.

If fewer than three complete in the initial cohort, recruit additional learners after remediation rather than converting the target into a percentage claim.

### 14.5 Failure record

For every blocker or abandonment record:

```text
beta participant pseudonymous ID
stage
source commit / production release
learner-visible symptom
correlation/evidence IDs
failure category
platform vs curriculum vs local environment vs external dependency
operator assistance provided
remediation
retest outcome
```

Do not publish private learner information in release artifacts.

---

## 15. Release gates

| Gate | Requirement | Pass evidence |
|---|---|---|
| P0 | Production providers/operations explicitly selected | committed decision record |
| P1 | Clean production provision + migrations + backup/restore + rollback | runbooks and drill evidence |
| P2 | Real identity/repository onboarding with fixtures disabled | production smoke/E2E evidence |
| P3 | Immutable commit -> isolated public/hidden evaluation -> persisted evidence | production submission evidence |
| P4 | Experiment -> prediction -> results -> interpretation -> mastery -> journal | complete production evidence chain |
| P5 | Required failure/recovery scenarios terminate diagnostically | failure-injection/drill record |
| P6 | Three external learners independently complete full loop | pseudonymized beta evidence |
| P7 | Candidate and all provenance frozen | release record with hashes/versions |

A gate is not satisfied by intention, unit-test-only coverage, or fixture-only simulation when the gate explicitly requires production evidence.

---

## 16. P7 frozen release evidence package

The final v0.5 release record must include:

- source commit SHA;
- production web deployment/release ID;
- production worker deployment/release ID;
- database migration identity;
- PostgreSQL major/minor version;
- runtime/sandbox image identities and digests;
- public test bundle version;
- hidden evaluator version/commitment identity;
- course content/version hash;
- relevant GitHub App configuration identity without secrets;
- production smoke/E2E run identity;
- backup/restore drill date and evidence identity;
- rollback drill date and evidence identity;
- beta learner pseudonymous completion IDs;
- known limitations and accepted risks.

The release record must distinguish **verified production evidence** from design intentions or local/CI evidence.

---

## 17. Exit criteria

Platform v0.5 is verified only when P0–P7 are all satisfied.

After that point the project may:

1. treat the Causal Attention production learner loop as the platform baseline;
2. expand remaining Phase 1 units through the same evidence architecture;
3. use real beta failures to refine reusable platform components;
4. proceed from Phase 2 specification toward Phase 2 implementation.

Before P6/P7, broad curriculum expansion remains intentionally constrained.

---

## 18. Parallel work that does not broaden v0.5 scope

The following may proceed in parallel:

- Phase 1 8/12/16 GB empirical hardware certification;
- calibration of the final Phase 1 natural-language acceptance envelope;
- detailed Phase 2 — Optimize curriculum/repository specification;
- security/operations documentation required by P0–P5.

Parallel work must not change the v0.5 production candidate without re-running the affected release gates.

---

**End of Platform v0.5 Production Beta & Learner Validation Contract**

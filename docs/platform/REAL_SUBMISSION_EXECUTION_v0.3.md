# First Principles LLM Research
## Platform v0.3 — Real Submission & Execution

**Date:** 2026-09-18  
**Status:** IN PROGRESS  
**Baseline:** platform v0.2 merged at `6462dbc09e0b9c393f8139d4d161e829adc6035b`

## Objective

Remove the largest remaining fiction in the Causal Attention vertical slice: seeded submission and seeded test evidence.

The target evidence path is:

```text
Learn
  -> implement locally
  -> bind an authorized GitHub repository
  -> submit an immutable 40-character commit SHA
  -> create a durable test run and execution job
  -> execute learner code only in an isolated worker sandbox
  -> persist public and hidden invariant evidence
  -> unlock experiment work only from passing evidence
  -> interpret and preserve the result
```

The invariant is:

```text
web process != learner-code execution process
```

No learner-supplied code may execute in the Next.js web process.

## Scope

### 1. Real GitHub repository binding

The platform must:

- use a GitHub App installation rather than broad repository OAuth scope;
- persist installation identity separately from repository identity;
- resolve repository ownership and provider repository ID through GitHub;
- reject repositories the installation cannot access;
- resolve the learner-supplied commit to a full SHA;
- persist the full SHA as immutable submission evidence;
- treat branch names as mutable display metadata only.

### 2. Immutable submission creation

A submission is accepted only when all of the following are true:

- the repository belongs to the current learner's bound repository set;
- an active GitHub App installation is attached;
- the provider repository ID still matches GitHub;
- the submitted commit resolves in that repository;
- the resolved SHA exactly matches the submitted 40-character SHA;
- the lab and lab version are recognized.

Submission creation atomically creates:

```text
Submission(state=submitted)
TestRun(state=queued)
Job(jobType=hidden_test, state=queued)
AuditEvent(submission.queued)
```

The queued job payload contains only the identifiers and execution limits required by the worker. GitHub installation IDs are serialized as strings; private keys and installation tokens are never stored in job payloads.

## Execution evidence identity

Each test execution must ultimately identify at least:

```text
repository provider + provider repository id
full commit SHA
lab id + lab version
test bundle id + version
sandbox/runtime image identity
worker execution id
hardware/runtime class
start/end timestamps
exit status
public invariant results
hidden invariant results
stdout/stderr artifact identities
```

A test result without a commit SHA and test-bundle identity is not mastery evidence.

## Worker boundary

The worker consumes durable PostgreSQL jobs. Production execution must occur in a disposable unprivileged sandbox with the following minimum controls:

- network disabled by default;
- no platform secrets in the learner-code environment;
- no Docker/container runtime socket mounted into the sandbox;
- read-only root filesystem where supported;
- all Linux capabilities dropped;
- `no-new-privileges` enabled;
- explicit CPU, memory, PID and wall-clock limits;
- bounded writable temporary filesystem;
- learner checkout mounted only at the expected workspace path;
- hidden-test bundle mounted read-only;
- teardown after every run.

Containerization is an implementation boundary, not a claim of perfect isolation. The worker host must itself be treated as an untrusted-code execution tier and separated from the web/database control plane.

## Job state machine

```text
queued
  -> leased
  -> preparing
  -> running_public
  -> running_hidden
  -> finalizing
  -> passed | failed | infrastructure_error
```

Retry is permitted only for infrastructure failures. A deterministic learner-code failure does not become a retry loop.

## Public/hidden evidence contract

Public and hidden tests use the same evidence model:

```text
(commit, test_bundle, environment, invariant, result, artifact, timestamp)
```

For Causal Attention, the first required invariants are:

- output shape;
- causal non-leakage;
- grouped-query equivalence;
- gradient flow;
- randomized numerical equivalence;
- absence of permanent KV replication.

Hidden-test feedback exposes the documented invariant and diagnostic category, not fixtures or solution code.

## v0.3 release gates

### G1 — Verified submission identity

A repository bound through the GitHub App accepts a full commit SHA and persists the same resolved SHA. A commit from another repository or inaccessible installation is rejected.

### G2 — Durable queue creation

Submission, test run, job and audit event are created atomically. The browser does not control the resulting test state.

### G3 — Isolated execution

A worker executes a known fixture repository in the isolated sandbox boundary. The web application never imports or spawns learner code.

### G4 — Negative fixture

```text
known bad commit -> failed test evidence
```

### G5 — Positive fixture

```text
known good commit -> passing test evidence -> experiment becomes available
```

### G6 — Reproducibility

Re-running the same commit against the same test-bundle/runtime identity produces a new execution record linked to the same immutable source identity.

### G7 — CI

Node 24 CI remains green for install, Prisma generation, PostgreSQL migration/seed, content validation, typecheck, tests, production build and existing Playwright/accessibility coverage. New v0.3 integration tests exercise submission identity and queue semantics without executing untrusted code inside the CI web process.

## Deliberately deferred beyond the first v0.3 increment

- production authentication/authorization replacing the deterministic demo learner;
- managed GPU execution;
- autoscaling worker fleet;
- production object storage for large stdout/stderr/artifacts;
- arbitrary learner Dockerfiles;
- multi-language execution;
- broad Phase 1 course expansion.

The first implementation increment is intentionally narrower: verify GitHub commit identity, create a durable immutable submission, and enqueue a sandbox job with explicit security limits.
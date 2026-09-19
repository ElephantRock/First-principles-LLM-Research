# First Principles LLM Research
## Platform v0.3 — Real Submission & Execution

**Date:** 2026-09-18  
**Status:** IN PROGRESS — draft release boundary  
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
  -> materialize that exact commit in a worker-only temporary directory
  -> execute public tests in an untrusted learner sandbox
  -> execute private checks through a separate hidden evaluator
  -> persist public and hidden invariant evidence
  -> unlock experiment work only from passing evidence
  -> interpret and preserve the result
```

The control-plane invariant is:

```text
web process != learner-code execution process
```

The hidden-test confidentiality invariant is:

```text
learner mount namespace ∩ private-test mount namespace = ∅
```

No learner-supplied code may execute in the Next.js web process, and private hidden-test source must never be mounted into a container that executes learner code.

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
Job(jobType=submission_test, state=queued)
AuditEvent(submission.queued)
```

The queued job payload contains only identifiers and execution limits required by the worker. GitHub installation IDs are serialized as strings; private keys and short-lived installation tokens are never stored in job payloads.

## Execution evidence identity

Each test execution must ultimately identify at least:

```text
repository provider + provider repository id
full commit SHA
lab id + lab version
test bundle id + version
learner runtime image digest
hidden evaluator image digest
worker execution id
hardware/runtime class
start/end timestamps
exit status
public invariant results
hidden invariant results
stdout/stderr artifact identities
```

A test result without immutable source identity and test-bundle identity is not mastery evidence.

## Worker boundary

The worker consumes durable PostgreSQL jobs and runs only on a host designated for untrusted-code execution. The worker may hold short-lived GitHub installation credentials while materializing source, but those credentials are never injected into learner or evaluator containers.

Every disposable container has, at minimum:

- external network disabled;
- no platform secrets;
- no Docker/container runtime socket;
- read-only root filesystem;
- all Linux capabilities dropped;
- `no-new-privileges`;
- explicit CPU, memory, PID and wall-clock limits;
- bounded writable temporary filesystem;
- non-root execution;
- teardown after the phase completes.

Containerization is an implementation boundary, not a claim of perfect isolation. The worker host itself remains a dedicated untrusted-code tier and must not expose the web/database control plane to learner code.

## Public-test boundary

Public test source contains no private fixtures and may execute in the learner-code sandbox.

```text
public-test container
  mounts:
    learner workspace   -> /workspace                  read-only
    public test bundle  -> /opt/fpllm/tests           read-only
    result directory    -> /output                    writable
  network: none
```

A deterministic public-test failure is valid learner evidence and is not treated as an infrastructure retry.

## Hidden-evaluator boundary

Hidden tests must not coexist with learner source in one mount namespace. Hidden evaluation uses two disposable containers connected only through a worker-created Unix-domain-socket directory.

```text
                       shared IPC directory
                    /run/fpllm-ipc/probe.sock
                           ▲           ▲
                           │           │
              ┌────────────┘           └────────────┐
              │                                     │
┌──────────────────────────────┐     ┌──────────────────────────────┐
│ learner probe container      │     │ hidden evaluator container   │
│                              │     │                              │
│ /workspace        RO         │     │ /opt/fpllm/tests      RO     │
│ /run/fpllm-ipc    RW         │     │ /run/fpllm-ipc        RW     │
│                              │     │ /output                RW     │
│ NO private tests             │     │ NO learner workspace         │
│ network = none               │     │ network = none               │
└──────────────────────────────┘     └──────────────────────────────┘
```

The learner-side process is a generic, versioned probe supplied by the digest-pinned runtime image. The hidden evaluator owns private fixtures/seeds and drives the probe over the Unix socket. Hidden fixture code, seed-generation logic and expected-answer logic never enter the learner container filesystem.

The IPC protocol may reveal individual black-box inputs to the learner process because those inputs must be evaluated. It must not transmit fixture-generation code, private seeds, expected results or evaluator internals. The evaluator treats malformed replies, protocol violations and probe termination according to the versioned test-bundle contract.

This split is a confidentiality boundary, not a cryptographic guarantee against all adaptive behavior. Hidden invariants should therefore rely on randomized/repeated probes, instrumentation supplied by the runtime where appropriate, and multiple seeds rather than one recognizable fixture.

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

PostgreSQL leasing is concurrency-safe. Lease ownership and expiry are checked on every stage transition. Expired in-flight work is recoverable. Retry is permitted only for infrastructure failures; deterministic learner-code failures remain evidence.

## Public/hidden evidence contract

Public and hidden results use the same persistence model:

```text
(commit, test_bundle, execution, invariant, result, artifact_identity, timestamp)
```

For Causal Attention, the required invariants are:

### Public

- `attention.shape`
- `attention.causal`
- `attention.gqa_equivalence`
- `attention.gradients`

### Hidden

- `attention.randomized_numerics`
- `attention.no_permanent_kv_repeat`

Hidden-test feedback exposes the documented invariant and diagnostic category, not private fixtures or solution code.

A test runner exits successfully after producing a complete schema-valid result document even when one or more learner invariants fail. Non-zero runner exit, missing output, invalid protocol output or sandbox failure is infrastructure failure rather than learner evidence.

## Current implementation status

Implemented on the v0.3 draft branch:

- GitHub App commit/repository verification before submission acceptance;
- atomic `Submission -> TestRun -> Job -> AuditEvent` creation;
- exact-commit bounded tree/blob materialization;
- short-lived installation-token reuse without persisting credentials;
- PostgreSQL `FOR UPDATE SKIP LOCKED` leasing and bounded infrastructure retry;
- stage-by-stage lease renewal;
- deterministic test-evidence finalization and mastery evidence;
- experiment unlock only from a complete passing invariant set;
- transaction-safe human-readable experiment-ID allocation;
- bounded worker process execution and cleanup;
- public sandbox contract;
- separate learner-probe / hidden-evaluator mount contracts;
- fake-runtime integration coverage for both pass and hidden-failure evidence paths.

Still required before v0.3 is merge-ready:

- a real digest-pinned learner runtime image containing the generic `causal-attention-v1` probe;
- the actual versioned public Causal Attention test bundle;
- a private hidden evaluator bundle implementing the two hidden invariants over the probe protocol;
- known-good and known-bad immutable GitHub fixture commits;
- staging proof using the real GitHub App, Docker runtime and private evaluator artifact;
- production worker-host isolation and operations hardening;
- durable storage for bounded raw stdout/stderr if retained beyond their hashes;
- cleanup of temporary monorepo-relative worker imports and lockfile plumbing.

## v0.3 release gates

### G1 — Verified submission identity

A repository bound through the GitHub App accepts a full commit SHA and persists the same resolved SHA. A commit from another repository or inaccessible installation is rejected.

### G2 — Durable queue creation

Submission, test run, job and audit event are created atomically. The browser does not control the resulting test state.

### G3 — Isolated execution

A worker executes a known fixture repository in the isolated sandbox tier. The web application never imports or spawns learner code.

### G3a — Hidden-test non-co-residency

Automated contract tests and a real Docker staging run demonstrate both of the following:

```text
learner probe container: learner workspace present, private bundle absent
hidden evaluator container: private bundle present, learner workspace absent
```

The only shared host path is the per-execution IPC directory. Neither container receives the Docker socket, GitHub credentials or database credentials.

### G4 — Negative fixture

```text
known bad commit -> failed invariant evidence -> experiment blocked
```

### G5 — Positive fixture

```text
known good commit -> passing invariant evidence -> experiment available
```

### G6 — Reproducibility

Re-running the same commit against the same test-bundle/runtime identities produces a new execution record linked to the same immutable source identity.

### G7 — CI

Node 24 CI remains green for frozen install, Prisma generation, PostgreSQL migration/seed, content validation, typecheck, tests, production build and existing Playwright/accessibility coverage. v0.3 integration tests exercise leasing, evidence finalization, experiment gating and the split hidden-evaluator orchestration without placing private test fixtures in the learner sandbox.

## Explicitly deferred

- production authentication/authorization replacing the deterministic demo learner;
- managed GPU execution;
- autoscaling worker fleet;
- arbitrary learner Dockerfiles;
- multi-language execution;
- broad Phase 1 course expansion.

PR #2 remains a draft until the real-runtime G3/G3a/G4/G5 staging evidence exists. Passing unit/integration tests alone is not sufficient to claim the worker execution tier production-safe.

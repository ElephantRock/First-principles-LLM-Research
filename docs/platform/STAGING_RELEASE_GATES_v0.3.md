# First Principles LLM Research
## Platform v0.3 Staging Release Gates

**Date:** 2026-09-19  
**Status:** STAGING CONTRACT / NOT YET SATISFIED  
**Applies to:** `phase1-causal-attention@1.0`

## 1. Purpose

CI now proves the public runtime, immutable fixture behavior, memory-trace v2 discrimination, and split-container structural topology. v0.3 still requires a real staging execution with GitHub App source retrieval, published digest-pinned images, the private evaluator bundle, PostgreSQL persistence, and the actual worker loop.

This document defines exactly what evidence closes that gap.

## 2. Required immutable identities

A staging run must bind all of the following before execution:

```text
learner repository provider + provider repository ID
full 40-character learner commit SHA
lab ID + version
test bundle ID
adapter interface
memory-trace schema
learner runtime registry digest
hidden evaluator registry digest
private evaluator bundle identity/hash
worker build/source revision
```

Mutable branch names and mutable image tags may be displayed for operator convenience but are not evidence identities.

Current frozen fixture commits:

```text
GOOD = c29f8a28cb56d2b50d5139bae1a7747ddf495c89
BAD_KV = 3ccf5ba08f37c5d35b56e66b9e78993eb117d93f
BAD_NO_ROPE = 636251fd92b7e81de63c40e767bef981ec9ca88a
```

## 3. Required staging configuration

The worker host must receive control-plane credentials only in the worker process, never in learner/evaluator containers:

```text
DATABASE_URL
GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY
FPLLM_TEST_RUNTIME_IMAGE=<registry>@sha256:<digest>
FPLLM_HIDDEN_EVALUATOR_IMAGE=<registry>@sha256:<digest>
FPLLM_PUBLIC_TEST_BUNDLE_ROOT
FPLLM_PRIVATE_TEST_BUNDLE_ROOT
```

The worker already rejects non-digest-pinned image configuration.

The private bundle root must be provisioned outside this public repository. Its bundle directory for this release is:

```text
phase1-causal-attention@1.0/
  runner.py
  ...private evaluator files...
```

## 4. Gate S1 — real GitHub App source identity

Using the staging GitHub App installation, submit the pinned GOOD SHA and verify that the stored submission contains the same SHA and provider repository identity returned by GitHub.

Negative checks:

- another repository's commit is rejected;
- a nonexistent SHA is rejected;
- installation/repository identity mismatch is rejected;
- a mutable branch name cannot substitute for the full commit SHA.

Required evidence:

```text
submission ID
provider repository ID
resolved full commit SHA
GitHub App installation ID (non-secret identifier only)
audit event identity
```

## 5. Gate S2 — good commit end to end

Execute:

```text
GOOD immutable commit
  -> submission accepted
  -> durable job queued
  -> worker lease
  -> exact tree/blob materialization
  -> public sandbox passes four invariants
  -> learner probe starts
  -> private evaluator passes randomized numerics
  -> private evaluator passes no-permanent-KV-repeat
  -> finalization persists six passing TestResult rows
  -> Submission = passed
  -> mastery evidence created
  -> verified experiment creation succeeds
```

The run is invalid if public/hidden evidence was injected through a test double or manually inserted into PostgreSQL.

## 6. Gate S3 — deterministic bad commits

### BAD_KV

Expected:

```text
public numerical behavior may pass
attention.no_permanent_kv_repeat = false
Submission = needs_revision
no passing hidden-test mastery evidence
verified experiment creation blocked
```

### BAD_NO_ROPE

Expected:

```text
attention.randomized_numerics = false
Submission = needs_revision
verified experiment creation blocked
```

At least one deterministic learner failure must be shown to remain persisted evidence rather than being converted into an infrastructure retry.

## 7. Gate S4 — mount/environment inspection

During a real hidden evaluation, capture host-side inspection evidence proving:

### learner probe

```text
/workspace present and read-only
/run/fpllm-ipc present
/opt/fpllm/tests absent
external network disabled
read-only root
capabilities dropped
no-new-privileges
bounded CPU/RAM/PIDs
unprivileged UID/GID
```

### hidden evaluator

```text
/opt/fpllm/tests present and read-only
/run/fpllm-ipc present
/output present
/workspace absent
external network disabled
read-only root
capabilities dropped
no-new-privileges
bounded CPU/RAM/PIDs
unprivileged UID/GID
```

For both containers, record environment **key names only** and assert absence of:

```text
DATABASE_URL
GITHUB_TOKEN
GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
worker control-plane credentials
```

Do not capture secret values in evidence artifacts.

## 8. Gate S5 — re-execution identity

Re-run the GOOD source using the same:

```text
commit SHA
test-bundle ID
learner runtime digest
hidden evaluator digest
private bundle identity
```

Expected:

```text
new execution ID
new durable job/test-run identity
same immutable source/runtime/test identities
same invariant verdicts within deterministic contract
```

A previous TestResult row must never be silently reused as if it were a new execution.

## 9. Gate S6 — image provenance

For both production candidate images, retain a provenance document conforming to `RUNTIME_IMAGE_PROVENANCE_v0.3.md` with:

```text
distribution.status = published
registryDigest = sha256:<64 hex>
```

The digest configured in the staging worker must exactly match the digest in the provenance document.

## 10. Evidence package

One staging release-candidate package should contain non-secret JSON/log evidence sufficient to reconstruct the argument:

```text
release-candidate.json
learner-runtime.provenance.json
hidden-evaluator.provenance.json
sandbox-topology.json
good/execution.json
good/test-results.json
good/experiment-gate.json
bad-kv/execution.json
bad-kv/test-results.json
bad-kv/experiment-gate.json
bad-no-rope/execution.json
bad-no-rope/test-results.json
reexecution/execution.json
```

Large raw stdout/stderr should remain in bounded artifact storage and be referenced by SHA-256 rather than copied into the release summary.

## 11. Pass condition

v0.3 may leave draft status only when all of the following are simultaneously true:

```text
S1 GitHub App identity PASS
S2 good commit full worker path PASS
S3 deterministic bad path PASS
S4 mount/environment isolation PASS
S5 re-execution PASS
S6 published-image provenance PASS
normal Node/PostgreSQL/web CI PASS
```

A green structural CI run alone does not satisfy this staging contract.

# Platform v0.5 — Maintainer Corrections Round 10 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `a68a482ae8982b808496a63e657bac84b6e35075`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and independent finding

The exhaustive maintainer re-review of the round-9 candidate found one remaining non-transactional release-control gap at the CodeBuild boundary:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR10-01 | HIGH | The broker freezes one active build per component and bounded start counts, but an AWS `StartBuild` call is external to DynamoDB. A broker failure after CodeBuild accepts a start but before the returned build ID is durably stored can leave an untracked running build. A later retry could start a second build, violating the one-active-build/start-count invariants and creating ambiguous result receipts. | Reserve a durable logical build-start intent before the API call, use CodeBuild's native idempotency token for immediate retries, pass a non-secret logical-attempt correlation value, and require broker recovery to discover/reconcile an accepted build before another logical start may be allocated. |

AWS CodeBuild documents a native `idempotencyToken` on `StartBuild`; the token is valid for five minutes. `BatchGetBuilds` returns build environment metadata, allowing the broker to verify a bounded non-secret release-attempt correlation value during recovery.

Official basis:

- https://docs.aws.amazon.com/codebuild/latest/APIReference/API_StartBuild.html
- https://docs.aws.amazon.com/codebuild/latest/APIReference/API_BatchGetBuilds.html

Precedence inside the P0 record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R10_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R9_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R8_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R7_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R6_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R5_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R4_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R3_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

Non-conflicting decisions remain in force.

---

# 1. Logical protected build attempt — RESERVED BEFORE START

For each protected component:

```text
worker
evaluator-base
hidden-evaluator
```

the execution broker must reserve a logical attempt in durable candidate state **before** calling CodeBuild.

The reservation transaction requires the candidate/component to be eligible and no prior logical attempt to be unresolved, then atomically records:

```text
component state = starting
buildStartCount = previous + 1
logicalAttemptOrdinal = buildStartCount
logicalAttemptId = server-generated bounded identity
logicalAttemptCreatedAt = server timestamp
activeBuildId = null
```

The existing maximum of three starts per `approvalId`/component remains authoritative. Reserving the logical attempt consumes one start-count slot exactly once; retrying the same logical attempt does not increment the count again.

A new ordinal may not be allocated while the previous component state is `starting` or `building`.

---

# 2. CodeBuild start uses deterministic idempotency and correlation

For the reserved logical attempt, the broker calls the exact protected CodeBuild project with:

```text
CodeBuild idempotencyToken = deterministic token derived from the logicalAttemptId
allowlisted non-secret release correlation values including:
  approvalId
  component
  logicalAttemptId
  logicalAttemptOrdinal
  platformSourceSha
```

The correlation values are not secrets and do not authorize alternative source/buildspec/image/service-role/cache/log/artifact/privileged-mode configuration. All prior fixed-project and caller-input restrictions remain in force.

The broker stores the returned CodeBuild build ID conditionally only if the component still references the same unresolved `logicalAttemptId`.

After the build ID is stored:

```text
component state = building
activeBuildId = returned CodeBuild build ID
```

Direct use of CodeBuild `RetryBuild` is not part of the v0.5 release protocol. A failed completed build consumes its reserved logical attempt; any permitted retry receives the next bounded logical attempt ordinal and a new native idempotency token.

---

# 3. Recovery when StartBuild outcome is ambiguous

If the broker resumes and sees:

```text
component state = starting
logicalAttemptId != null
activeBuildId = null
```

it must treat the `StartBuild` outcome as ambiguous and **must not allocate another logical attempt yet**.

Recovery order:

1. query the exact protected CodeBuild project for builds created at/after the logical-attempt reservation time, using bounded pagination appropriate to the low-volume release project;
2. obtain candidate build metadata with `BatchGetBuilds`;
3. match only a build whose project plus non-secret correlation values exactly equal the reserved `approvalId`/component/`logicalAttemptId`/ordinal/source SHA;
4. if exactly one accepted build matches, conditionally persist that build ID and continue ordinary reconciliation;
5. if no build matches and the native CodeBuild idempotency-token window is still valid, the broker may repeat the **same** `StartBuild` request with the same token/parameters;
6. after the native idempotency window expires, perform a final bounded discovery/reconciliation pass before classifying the reserved logical attempt as `no_start_observed`;
7. only after that terminal no-start disposition is durably recorded may the broker allocate a later logical attempt, subject to the existing three-start limit.

If more than one CodeBuild execution matches the same logical attempt identity, the component enters an internal release-invariant failure state and no additional build may start until protected operator investigation. The broker must not guess which execution is authoritative.

---

# 4. Result-receipt binding is extended to the logical attempt

Round 7's protected S3 result receipt schema is extended with:

```text
logicalAttemptId
logicalAttemptOrdinal
```

Before canonicalizing an output digest, the broker now verifies all previous receipt/CodeBuild/ECR requirements **plus**:

```text
receipt logicalAttemptId == candidate unresolved/current logical attempt identity
receipt logicalAttemptOrdinal == candidate logical attempt ordinal
BatchGetBuilds correlation metadata == candidate logical attempt identity
recorded activeBuildId == receipt CodeBuild build ID
```

A receipt from an orphaned, stale, superseded, differently correlated, or unrecorded build never becomes canonical release evidence merely because it pushed an image successfully.

---

# 5. Crash/concurrency invariants

P1 must prove at minimum:

- broker failure before `StartBuild` leaves a reserved attempt that can be deterministically classified without allocating a duplicate;
- broker failure after CodeBuild accepted the start but before build-ID persistence recovers the exact accepted build through the logical-attempt correlation path;
- immediate repeated `StartBuild` for one logical attempt uses the same native CodeBuild idempotency token and cannot create a second accepted request with changed parameters;
- a retry of the same logical attempt does not increment `buildStartCount` again;
- no fourth logical attempt can be reserved under one approval/component;
- `RetryBuild` is not used to evade the frozen start-count model;
- more than one discovered build for one logical attempt fails closed;
- stale/orphan result receipts cannot be canonicalized;
- the hidden-evaluator builder's private/no-Internet boundary is unchanged by the added non-secret correlation metadata.

---

# 6. Review-state boundary

Round 10 closes FPR10-01 at the decision/specification level. It does not claim build-intent transactions, native idempotency tokens, build discovery, correlation metadata, or crash recovery are implemented.

The resulting exact HEAD must:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> only then receive a fresh independent Codex review
-> disposition every actionable finding
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

# Platform v0.5 — Maintainer Corrections Round 20 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `c9935e8b9bba8f24ad6a8657a41adfd281567aee`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and maintainer finding

The exact-head review of R19 found one state-machine requirement implicit in the new one-slot CodeBuild quota envelope that must be explicit:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR20-01 | HIGH | R19 globally serialized the three protected CodeBuild projects to one running execution so an applied Linux/Large concurrency quota of one is sufficient, but the earlier broker state machine was component-local. A component can be in `starting` with an accepted-but-unrecorded `StartBuild` outcome while another component appears individually eligible. Without a candidate-wide fence, the broker could attempt the second component before the first ambiguous start is reconciled, defeating the one-slot admission assumption and potentially consuming/retrying release attempts under provider throttling. | Make any unresolved protected build attempt candidate-wide blocking work. At most one component may own the protected-build slot. The slot is claimed transactionally with logical-attempt reservation, remains owned through `starting`, dispatch lease, `building`, and provider reconciliation, and is released only after that component reaches a durable non-running terminal/retryable disposition. Definite quota/throttle rejection remains the same already-reserved logical attempt; it never allocates a second component or another ordinal merely to retry provider admission. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R20_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R19_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R18_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R17_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R16_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R15_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R14_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R13_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R12_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R11_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R10_v0.5.md
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

# 1. Candidate-wide protected-build slot — FROZEN

The active candidate contains one broker-owned global build-slot identity:

```text
activeProtectedBuildComponent:
  null | worker | evaluator-base | hidden-evaluator

activeProtectedLogicalAttemptId: string | null
```

These fields are part of protected release-control state. GitHub, approver, builders, worker, web, promotion operator, and stack administrator do not write them through the routine release path.

At most one protected component may own this slot for an approval at a time.

---

# 2. Slot claim is atomic with logical-attempt reservation

When the broker reserves a new logical attempt under R10, the same conditional transaction additionally requires:

```text
activeProtectedBuildComponent == null
activeProtectedLogicalAttemptId == null
```

and atomically writes:

```text
activeProtectedBuildComponent = selected broker-eligible component
activeProtectedLogicalAttemptId = newly generated logicalAttemptId
```

The selected component remains broker-derived from candidate state. Caller input still cannot choose it.

A component is not eligible to claim the slot unless all earlier dependency predicates hold. In particular, `hidden-evaluator` still requires canonical evaluator-base success under the same approval/source identity.

---

# 3. Slot remains owned across every uncertain/running state

The global slot remains occupied while its component is in any state where a CodeBuild execution may exist or provider admission/reconciliation is unresolved, including:

```text
logical attempt reserved / component starting
live or stale-but-not-yet-reconciled StartBuild dispatch lease
StartBuild accepted but build ID not yet durably recorded
component building with activeBuildId
completed provider execution not yet durably reconciled
same-logical-attempt provider retry/recovery
```

No other protected component may reserve a logical attempt or issue `StartBuild` while this slot is occupied.

This rule is stronger than simply checking recorded `activeBuildId != null`: a `starting` attempt with no known build ID is globally blocking until R10/R12 recovery proves its disposition.

---

# 4. Releasing the slot

The broker clears:

```text
activeProtectedBuildComponent = null
activeProtectedLogicalAttemptId = null
```

only in the same conditional/transactional state update that proves the owning component has reached a durable disposition from which no CodeBuild execution for that attempt can still become newly authoritative.

Examples include:

- successful build fully reconciled and canonical output digest recorded;
- failed CodeBuild execution fully reconciled and component moved to its retryable/failed state;
- a reserved attempt conclusively classified `no_start_observed` after all R10/R12 idempotency/discovery requirements complete;
- terminal `failed_locked` after the owning attempt is fully reconciled.

The slot is **not** cleared merely because:

- the broker invocation ended;
- a dispatch lease expired;
- no build ID was recorded yet;
- `StartBuild` returned/raised a transient quota or throttling error;
- a recovery invocation is delayed.

Candidate supersession remains subject to every earlier unresolved-attempt predicate and therefore cannot bypass an occupied global build slot.

---

# 5. Quota/throttle handling stays within one reserved attempt

A provider admission failure that is definitely non-accepting, such as a CodeBuild concurrency/quota throttle response, does not justify another component start or another logical-attempt ordinal.

The current logical attempt has already consumed exactly one `buildStartCount` slot when it was reserved under R10. Recovery/retry behavior is therefore:

1. retain the same component-wide slot and logical-attempt identity;
2. retain the same CodeBuild native idempotency token/parameters;
3. use the existing R10/R12 reconciliation path to prove whether an execution was accepted;
4. if no execution was accepted and retry is allowed, repeat the **same logical attempt** under a fresh dispatch epoch/lease;
5. allocate a later logical-attempt ordinal only after the current attempt reaches the already-frozen terminal disposition that permits a later attempt.

Thus quota pressure cannot burn extra attempt ordinals merely because the account has one protected build slot, and it cannot cause the broker to move on to a different component while the current attempt is unresolved.

---

# 6. Recovery and broker replay

Because the execution-release broker itself has reserved concurrency 1, only one broker invocation runs at once. The durable global slot is still required because CodeBuild executions outlive a broker invocation and an accepted start can become ambiguous across invocations.

On every broker invocation, before selecting any new component, the broker first inspects the candidate-wide slot:

- if null, ordinary deterministic eligibility selection may reserve one component attempt;
- if occupied, the broker reconciles **only that owning component/attempt** until it reaches a disposition that permits the slot to clear;
- caller `requestId` replay does not change slot ownership or component selection.

This makes R19's one-concurrent-build quota assumption an executable release-control invariant rather than a scheduling preference.

---

# 7. Required P1 evidence additions

P1 must prove, in addition to every earlier gate:

1. logical-attempt reservation and candidate-wide protected-build-slot claim are one atomic conditional operation;
2. no second component can reserve/start while the owning component is `starting` with no build ID;
3. an accepted-but-unrecorded CodeBuild start keeps every other protected component blocked until exact recovery;
4. a stale dispatch lease does not release the global build slot;
5. a CodeBuild concurrency/quota throttle retries the same logical attempt and native idempotency token rather than consuming another ordinal or starting another component;
6. successful/failed/no-start dispositions clear the slot only in the same protected state transition that makes the owning attempt durably non-running;
7. broker request replay and process restart preserve the same slot/component ownership;
8. observed protected CodeBuild concurrency never exceeds one across all three protected projects.

---

# 8. Review-state boundary

Round 20 closes FPR20-01 at the decision/specification level. It does not claim the candidate-wide build slot, atomic claim/release, quota-throttle retry behavior, concurrency evidence, or production AWS state are implemented.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

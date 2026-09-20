# Platform v0.5 — Maintainer Corrections Round 15 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `d8a6cfcea08521aad1ca3b85c40d73bdf2861833`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and maintainer findings

The final maintainer pass over the round-14 candidate found two operational state-machine details that must be explicit for the drain/replacement protocol to be executable rather than documentary:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR15-01 | HIGH | R14 required a "global worker drain" but did not freeze its durable epoch/ack semantics. A replacement worker or a worker that races one final lease against the drain request could otherwise begin/continue learner work before promotion terminalization. | Put worker leasing mode and drain epoch in protected durable control state. The current worker must acknowledge the exact epoch and expose zero active lease before a serving `PAIR` may be mutated. Any replacement starts fail-closed/drained while the mutation is active and cannot lease until the exact terminal transaction re-enables service. |
| FPR15-02 | HIGH | R12's "actual infrastructure still equals prior state" fence was correct before the first provider mutation, but if applied literally on every replay it would block legitimate R13/R14 journal recovery after ASG/LT state has already moved into an allowed intermediate state. | Scope the pristine-prior drift fence to the first mutation step only. Once a journal step is durably reserved/reconciled, subsequent invocations authorize progress only from the exact recorded allowed intermediate state for that journal step, generation, request, direction, and drain epoch. Unknown drift still fails closed. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R15_v0.5.md
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

# 1. Durable global worker-leasing control — FROZEN

The round-1 explicit worker-drain requirement and round-14 transition ordering are refined into one durable control protocol.

The protected deployment control state includes:

```text
workerLeasingMode: ENABLED | DRAIN_REQUESTED | DRAINED
workerDrainEpoch: non-negative integer
workerDrainPromotionRequestId: string | null
workerDrainRequestedAt: timestamp | null
```

The current worker reports a bounded acknowledgement record keyed separately from candidate/promotion state:

```text
workerInstanceId
observedDrainEpoch
leaseState: ACTIVE | IDLE
activeSubmissionJobId: id | null
acknowledgedAt
workerRuntimeIdentity
```

The production worker instance profile may read the leasing-control item and write only its narrowly scoped worker-drain acknowledgement/heartbeat record. It receives no write authority over candidate, promotion, deployment-generation, mutation-journal, or canonical digest state.

P1 may use a separate DynamoDB table/item namespace if required to make the IAM separation mechanically provable. The authority boundary, not a particular table layout, is frozen.

---

# 2. Drain request and acknowledgement

Before any transition whose currently serving source mode is `PAIR`, the promotion controller conditionally writes, under the same active promotion/generation lock:

```text
workerDrainEpoch = previous + 1
workerLeasingMode = DRAIN_REQUESTED
workerDrainPromotionRequestId = active promotionRequestId
workerDrainRequestedAt = server timestamp
```

The worker lease loop must refresh protected leasing control before each new lease cycle. On observing its exact current epoch in `DRAIN_REQUESTED` or `DRAINED`, it:

1. stops initiating new job leases;
2. allows an already-owned lease to reach the existing bounded terminal/lease-loss path;
3. publishes/updates the acknowledgement for that epoch;
4. reports `IDLE` only when no active submission job remains.

A worker may race at most a lease already in flight when the drain epoch changes. The controller therefore does **not** treat the drain write itself as proof that leasing stopped. It waits until the current source worker has acknowledged the exact epoch and the authoritative durable job state shows no active lease owned by that worker.

Only then may the controller advance to an ASG launch-template/capacity mutation that can terminate or replace the serving worker.

No healthy active learner job is killed merely to shorten a compatible planned deployment; the existing bounded drain deadline and ordinary lease-loss provenance remain in force.

---

# 3. Host loss and replacement while drain is active

The drain state is global to the protected worker service, not a transient flag in one process.

If the source worker disappears before acknowledging/finishing drain:

- ordinary durable lease expiry/retry semantics determine when its active work is no longer owned;
- any ASG-created replacement must read the current leasing-control state during bootstrap;
- while `workerLeasingMode != ENABLED`, a newly booted worker starts in non-leasing mode and may perform only readiness/preflight/diagnostic work required by the release protocol;
- failure to read/validate the protected leasing-control state is fail-closed for learner-job leasing;
- the controller does not proceed with destructive source mutation until the old lease is terminal/expired and the currently relevant worker state is reconciled.

Thus an unexpected prior-version replacement during drain cannot silently resume learner work, and a newly promoted target worker cannot lease learner jobs before promotion/rollback terminalization.

---

# 4. Re-enable leasing is bound to the terminal release transaction

For a successful target `PAIR` or verified rollback to prior `PAIR`, ordinary learner leasing may be re-enabled only after:

```text
actual ASG/LT/runtime identity == exact terminal bound PAIR
worker/gVisor/runtime preflight passed
required compatibility/smoke passed
candidate/promotion/deployment-generation terminal predicates still match
workerDrainPromotionRequestId == active promotionRequestId
workerDrainEpoch == the request's recorded drain epoch
```

The terminal release-control transaction writes the target/prior disposition and generation change **and** sets:

```text
workerLeasingMode = ENABLED
workerDrainPromotionRequestId = null
```

under those same conditional predicates.

A stale controller invocation or another promotion request cannot re-enable leasing for an epoch it does not own.

Rollback to bootstrap `ABSENT` instead commits:

```text
workerLeasingMode = DRAINED
workerDrainPromotionRequestId = null
```

with ASG `0/0/1` and no worker instance.

If a promotion remains partial, ambiguous, `FAILED_REQUIRES_OPERATOR`, or incident-reconciliation-required, leasing remains `DRAIN_REQUESTED`/`DRAINED`; it is never re-enabled merely because some worker is healthy.

---

# 5. First-mutation drift fence versus journal continuation

Round 12 §3.3 is narrowed as follows.

## 5.1 Before the first provider mutation

After promotion claim but before the first operational provider mutation, the controller must still prove:

```text
actual AWS deployment == exact recorded prior PAIR/ABSENT state
protected deployment generation == previousDeploymentGeneration
active mutation lock == promotionRequestId
no mutation journal step has yet taken operational effect
```

If that pristine-prior check fails, no first mutation is issued.

## 5.2 After a journaled mutation has begun

Once a round-13/14 mutation step is durably reserved and AWS state proves that the step has taken effect or is in an allowed in-progress state, later invocations do **not** require infrastructure to equal the original prior snapshot.

Instead, each continuation must prove all of:

```text
same promotionRequestId
same approvalId / canonical target snapshot
same previousDeploymentGeneration
same deployment singleton mutation lock
same recoveryDirection
same workerDrainEpoch when source mode required drain
same current mutationStepId / ordinal
actual AWS state == one of the exact allowed intermediate states for that recorded step
```

Only then may the step be reconciled or the next monotonic step be reserved.

Any state outside the journal's exact allowed transition set is drift/ambiguity and fails closed under the existing `FAILED_REQUIRES_OPERATOR`/incident path. The journal therefore permits legitimate recovery without weakening the generation fence.

---

# 6. Protected-stack administration and drain-control integrity

The round-14 stack-admin serialization rule additionally prohibits normal protected-stack administration from changing or clearing the worker drain epoch/mode as a shortcut around the promotion controller.

If a runtime-affecting protected-stack change occurs under the approved maintenance procedure, worker leasing remains disabled until the post-change protected-state reconciliation/preflight explicitly authorizes service. Emergency stack-admin use while a release is active retains the round-14 incident semantics and cannot manufacture a matching drain acknowledgement or terminal release transaction.

---

# 7. Required P1 evidence additions

P1 must prove, in addition to every earlier gate:

1. worker leasing control is durable/global rather than process-local;
2. the worker instance role can read leasing mode and write only its bounded acknowledgement/heartbeat identity, with negative tests against candidate/promotion/deployment state writes;
3. a drain request increments an epoch and is bound to the active promotion request;
4. a lease racing the drain write is observed and allowed to finish/expire before destructive ASG mutation proceeds;
5. no new lease begins after the worker acknowledges the current drain epoch;
6. a replacement worker booted while drain is active starts fail-closed/non-leasing and cannot process learner jobs before terminal authorization;
7. source host loss during drain preserves ordinary lease-expiry/retry provenance and does not let a replacement bypass drain;
8. successful target/prior-PAIR terminalization re-enables leasing only under the same request/generation/drain-epoch transaction predicates;
9. rollback to `ABSENT` leaves leasing disabled and no worker instance active;
10. a stale controller invocation cannot re-enable leasing for another promotion/drain epoch;
11. the pristine-prior drift fence is required before the first provider mutation;
12. after mutation starts, recovery accepts only exact journaled intermediate states for the same request/generation/direction/epoch and rejects unrelated drift;
13. stack-admin cannot use normal change procedure to clear drain state or create passing release evidence while active promotion locks remain.

---

# 8. Review-state boundary

Round 15 closes FPR15-01 and FPR15-02 at the decision/specification level. It does not claim drain-control persistence, worker acknowledgements, IAM restrictions, race tests, journal transition validation, or production AWS evidence are implemented.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

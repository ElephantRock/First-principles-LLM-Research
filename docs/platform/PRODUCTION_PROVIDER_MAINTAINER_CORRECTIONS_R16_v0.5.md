# Platform v0.5 — Maintainer Corrections Round 16 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `8fcf394fc23e0c20ea36b395c97801a41809a98e`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and maintainer finding

The exact-head maintainer pass over round 15 found one remaining contradiction in the worker-leasing state machine:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR16-01 | HIGH | R15 correctly requires a promoted worker to remain non-leasing until the terminal release transaction, but its drain ownership is created only when the currently serving source mode is `PAIR`. The first `ABSENT -> PAIR` promotion therefore has no promotion-bound drain/service epoch, while R15's terminal `PAIR` predicate requires `workerDrainPromotionRequestId == active promotionRequestId`. Without an explicit bootstrap rule, the first target worker could either see an undefined/enabled leasing state or become impossible to terminalize. | Freeze the bootstrap leasing state as `DRAINED`; make every promotion that can produce a serving `PAIR` claim one promotion-bound **service-control epoch**, even when the source is `ABSENT`; require worker acknowledgement only when a serving source `PAIR` actually exists; and use the same epoch ownership for terminal re-enable or rollback-to-`ABSENT`. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R16_v0.5.md
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

# 1. Bootstrap leasing state — FROZEN

The round-13 bootstrap `ABSENT` deployment state is extended with exact leasing-control values:

```text
PROTECTED_EXECUTION_DEPLOYMENT:
  generation = 0
  mode = ABSENT
  workerDigest = null
  hiddenEvaluatorDigest = null
  activeMutationPromotionRequestId = null

  workerLeasingMode = DRAINED
  workerDrainEpoch = 0
  workerDrainPromotionRequestId = null
  workerDrainRequestedAt = null
```

The corresponding worker ASG remains the round-13/14 bootstrap topology:

```text
min = 0
desired = 0
max = 1
no worker instance
no selected production candidate runtime
```

`DRAINED` is therefore the only valid bootstrap leasing mode. P1 must not default a newly provisioned production worker service to `ENABLED` before the first successful protected promotion.

---

# 2. Every promotion that may produce a serving PAIR owns one service-control epoch

Round 15's drain epoch is generalized as the release's **service-control epoch**. It still performs real drain acknowledgement when the source is a serving `PAIR`, but it also prevents an `ABSENT -> PAIR` target worker from leasing before terminal promotion.

For every fresh promotion request, before the first operational worker/ASG mutation, the promotion controller conditionally claims exactly one new epoch under the existing promotion/generation lock:

```text
requestServiceControlEpoch = workerDrainEpoch + 1
workerDrainEpoch = requestServiceControlEpoch
workerDrainPromotionRequestId = active promotionRequestId
workerDrainRequestedAt = server timestamp
```

The mode written at claim depends on the reconciled source state.

## 2.1 Source is serving `PAIR`

Write:

```text
workerLeasingMode = DRAIN_REQUESTED
```

Then all round-15 acknowledgement requirements remain mandatory:

```text
current source worker acknowledges exact epoch
+ authoritative durable job state shows no active lease owned by that worker
```

Only after both are true may destructive ASG/runtime mutation proceed.

## 2.2 Source is bootstrap `ABSENT`

Write:

```text
workerLeasingMode = DRAINED
```

There is no source worker and therefore no worker acknowledgement requirement. The epoch exists solely to bind service enablement/rollback authority to this promotion request.

The first target worker launched by `ABSENT -> PAIR` reads `DRAINED` during bootstrap and throughout its preflight/smoke period. It may perform only the already-allowed readiness/preflight/diagnostic operations and cannot lease learner jobs before terminal promotion.

---

# 3. One epoch per promotion request; replay cannot manufacture another

The request records its `requestServiceControlEpoch` in protected promotion state. Once claimed:

- repeated `APPLY_TARGET`, `RESTORE_PRIOR`, or `RECONCILE` calls for the same promotion request reuse that exact epoch;
- the controller may not increment `workerDrainEpoch` again merely because a provider response was lost or a recovery invocation occurs;
- another promotion request cannot claim service control while the deployment singleton/active promotion lock belongs to the current request;
- a stale invocation whose recorded epoch no longer equals the deployment-control epoch fails closed.

Thus the epoch is request-scoped release-control identity, not an invocation-scoped heartbeat.

---

# 4. Terminal leasing transitions by target mode

Round 15's terminal transaction is refined to distinguish whether source acknowledgement was required while preserving one common epoch-ownership rule.

## 4.1 Terminal target/prior `PAIR`

A terminal transaction may set:

```text
workerLeasingMode = ENABLED
workerDrainPromotionRequestId = null
```

only when all ordinary target/prior identity, preflight, smoke, candidate, promotion, and generation predicates pass **and**:

```text
workerDrainEpoch == promotion requestServiceControlEpoch
workerDrainPromotionRequestId == active promotionRequestId
```

Additionally:

- if the request's reconciled source at service-control claim was `PAIR`, the durable acknowledgement/zero-active-lease proof for that exact epoch must exist;
- if the source was bootstrap `ABSENT`, no source acknowledgement exists or is required, but the newly created target worker must still be non-leasing under `DRAINED` until this terminal transaction commits.

The worker lease loop observes `ENABLED` only after that transaction and may then begin ordinary learner leasing.

## 4.2 Terminal rollback to bootstrap `ABSENT`

A verified rollback to the exact bootstrap `ABSENT` state commits:

```text
workerLeasingMode = DRAINED
workerDrainPromotionRequestId = null
workerDrainEpoch = promotion requestServiceControlEpoch
ASG = exact bootstrap LT + 0/0/1
no worker instance
```

The epoch remains monotonic and is not reset to zero.

---

# 5. Partial/failed first promotion remains non-leasing

If an `ABSENT -> PAIR` attempt becomes partial, ambiguous, or `FAILED_REQUIRES_OPERATOR` after a worker has been created:

```text
workerLeasingMode = DRAINED
workerDrainPromotionRequestId = active promotionRequestId
workerDrainEpoch = promotion requestServiceControlEpoch
```

remain authoritative until the same request reaches exact target `PAIR` or exact bootstrap `ABSENT` terminal state.

A healthy partial target worker is not sufficient to enable leasing. Recovery continues through the same promotion controller, deployment generation, mutation journal, and service-control epoch.

---

# 6. Required P1 evidence additions

P1 must prove, in addition to all earlier gates:

1. fresh bootstrap initializes worker leasing as `DRAINED`, epoch `0`, with no promotion owner;
2. the first `ABSENT -> PAIR` promotion claims a new promotion-bound service-control epoch before ASG desired capacity is raised;
3. the first target worker boots and passes preflight/smoke while unable to lease learner jobs because leasing remains `DRAINED`;
4. source-worker acknowledgement is required for a source `PAIR` but is not fabricated or required for source `ABSENT`;
5. one promotion request cannot allocate multiple service-control epochs across retries/recovery;
6. a second promotion request cannot claim service control while the first owns the deployment/promotion lock;
7. successful first promotion enables leasing only in the same terminal transaction that verifies the exact target `PAIR` and the request-owned epoch;
8. failed first-promotion rollback restores exact bootstrap `ABSENT` and remains `DRAINED` with the monotonic epoch retained;
9. a partial first-promotion worker cannot lease even when healthy until target terminalization succeeds.

---

# 7. Review-state boundary

Round 16 closes FPR16-01 at the decision/specification level. It does not claim service-control initialization, epoch ownership, worker bootstrap enforcement, source-mode-specific acknowledgement, IAM restrictions, race tests, or production AWS evidence are implemented.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

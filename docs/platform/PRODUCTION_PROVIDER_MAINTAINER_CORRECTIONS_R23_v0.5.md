# Platform v0.5 — Maintainer Corrections Round 23 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Independent review baseline:** `105613485f0ec900bbbc667a4587fa32154b876a`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and exact-head Codex findings

The fresh independent review of exact HEAD `105613485f0ec900bbbc667a4587fa32154b876a` found two remaining authority/recovery races in R22:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR23-01 | HIGH | R22 made the PostgreSQL lease claim one bounded autocommit statement, but the long-lived worker could still reserve the DynamoDB acquisition slot, stall before issuing SQL, allow recovery to observe two no-row results and clear the slot, then finally issue the still-authorized SQL after drain began. | Remove direct queued-job lease-acquisition authority from the long-lived worker. Add one bounded protected lease-acquisition controller. A worker may reserve the protected acquisition slot and invoke the controller only with that acquisition ID. The controller must atomically claim a dispatch epoch/lease on the exact slot before any database call. Recovery cannot clear the slot while that dispatch lease can belong to a live controller invocation. The controller is the only production principal/database role allowed to perform the `QUEUED -> LEASED` claim, so a stale worker cannot issue the SQL after the slot is cleared. |
| FPR23-02 | HIGH | R22 allowed an incident path to clear the maintenance lock while leaving service explicitly drained and merely asserting that release admission remained blocked. The durable maintenance mode had only `IDLE | ACTIVE`; clearing the lock therefore restored `IDLE`, orphaned a `MAINTENANCE` service-control owner, and let normal release claims pass the maintenance fence. | Extend the maintenance singleton to `IDLE | ACTIVE | INCIDENT`. Failed/uncertain maintenance that cannot safely return to ordinary service transitions to owner-bound `INCIDENT`, preserving the exact maintenance operation/epoch/plan/provider identity. Every release-control authority grant and every new maintenance claim requires `IDLE`; `INCIDENT` is therefore a durable release fence. The controller may return `INCIDENT -> IDLE` only after exact incident recovery proves provider disposition, clears any maintenance-owned service control safely, and re-establishes all frozen invariants. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R23_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R22_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R21_v0.5.md
    > ...
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

Non-conflicting decisions remain in force.

---

# 1. Protected learner-lease acquisition controller — SELECTED

R21/R22's protected acquisition slot remains the serialization point against promotion- and maintenance-owned drain. R23 changes **who may turn that slot into PostgreSQL lease ownership**.

Add one bounded protected control-plane Lambda:

```text
name:                  fpllm-beta-lease-acquisition-controller
region:                eu-west-1
reserved concurrency:  1
timeout:                <= 15 seconds
caller:                 current authorized production worker role only
new-lease database authority: controller database principal only
```

The controller is not a general submission-job mutator. Its production request schema contains only:

```text
leaseAcquisitionId
```

The controller resolves the expected worker instance ID, service-control epoch, acquisition state, and current production worker identity from protected state. Caller-supplied worker IDs, job IDs, lease targets, service-control epochs, retry counters, or arbitrary SQL are not accepted as authority.

The long-lived worker may still:

- reserve the R21 protected acquisition slot under the already-frozen current-worker predicates;
- invoke the bounded acquisition controller for that exact acquisition ID;
- read the durable job it owns after a committed lease;
- perform already-authorized lifecycle/evidence updates on a job it demonstrably owns.

The long-lived worker may **not** directly perform the transition that creates new lease ownership from an unowned queued job.

---

# 2. Database authority split for new lease acquisition — FROZEN

Production database permissions must make the controller-only boundary enforceable rather than conventional.

At minimum P1 must establish two distinct database privilege domains:

```text
lease-acquisition controller DB principal
    -> may execute the exact bounded queued-job claim operation
    -> may read by exact leaseAcquisitionId for reconciliation
    -> no general administrative/schema authority

worker DB principal
    -> may read/update only already-owned job/evidence paths required by the worker protocol
    -> may not execute the queued-job claim operation
    -> may not create a QUEUED -> LEASED ownership transition
    -> may not impersonate the controller DB principal
```

The preferred realization is a narrowly permissioned stored procedure/function or equivalent single autocommit operation whose execution privilege is granted only to the controller principal. If direct table writes are used for other worker lifecycle operations, database grants/constraints must still make a fresh queued-job ownership transition impossible from the worker principal.

The controller's database credentials/identity are not present on the worker host, learner sandboxes, evaluator containers, GitHub Actions, or the web service.

P1 must retain negative authorization evidence proving the worker principal cannot acquire an unowned queued job even if it knows a valid acquisition ID.

---

# 3. Acquisition dispatch epoch/lease — FROZEN

Extend the protected acquisition state from R21 with:

```text
leaseAcquisitionDispatchEpoch: non-negative integer
leaseAcquisitionDispatchInvocationId: string | null
leaseAcquisitionDispatchLeaseExpiresAt: timestamp | null
leaseAcquisitionDispatchClaimedAt: timestamp | null
```

These fields live in the same protected service-control transaction boundary as the active acquisition slot, or in a transactionally coupled protected item.

## 3.1 Dispatch claim

Before the acquisition controller may issue the R22 PostgreSQL autocommit lease statement, it conditionally claims a fresh dispatch epoch/lease.

The granting transaction requires at minimum:

```text
workerLeasingMode == ENABLED
activeLeaseAcquisitionId == exact request acquisition ID
activeLeaseAcquisitionWorkerInstanceId == currently authorized production worker instance
activeLeaseAcquisitionEpoch == current workerDrainEpoch
no live acquisition dispatch lease exists
maintenance/release-control predicates do not prohibit new learner work
```

and atomically records:

```text
leaseAcquisitionDispatchEpoch = previous + 1
leaseAcquisitionDispatchInvocationId = exact controller invocation ID
leaseAcquisitionDispatchClaimedAt = server timestamp
leaseAcquisitionDispatchLeaseExpiresAt = server timestamp + 45 seconds
```

Timing contract:

```text
controller Lambda timeout     <= 15 seconds
PostgreSQL statement_timeout  <= 5 seconds
PostgreSQL lock_timeout       <= 2 seconds
dispatch lease lifetime        = 45 seconds
```

The dispatch lease therefore outlives the maximum authorized controller invocation and the maximum database operation it can start.

Immediately before the PostgreSQL operation, the controller revalidates the exact acquisition ID, dispatch epoch, invocation ID, worker identity, and service-control epoch and proves enough dispatch-lease lifetime remains for the full database statement bound plus safety margin. If not, it does not issue SQL.

## 3.2 No long-lived caller retains lease-creation authority

Only the bounded acquisition controller has the database privilege that can create a new learner-job lease.

Therefore these orderings are closed:

- if drain/recovery clears the acquisition slot first, a later stale worker invocation cannot obtain a controller dispatch lease and cannot issue the lease SQL itself;
- if the controller dispatch lease is claimed first, drain/recovery cannot clear the acquisition slot while that lease can belong to a live controller invocation;
- if the controller dies before SQL, recovery waits for the dispatch lease to become provably stale before classifying the acquisition;
- if SQL was accepted but the response was lost, recovery resolves the exact acquisition ID from the authoritative PostgreSQL primary before any slot clearing or redispatch.

A worker process lifetime is no longer part of the proof that no future lease statement can be issued.

---

# 4. Acquisition recovery and redispatch — REVISED

R22's two-primary-read `NO_LEASE_COMMITTED` proof remains, but “last possible server invocation” is now defined by the bounded controller dispatch protocol rather than by a worker timestamp.

Recovery for an exact acquisition ID proceeds as follows:

1. if a live acquisition dispatch lease exists, do not clear the acquisition slot and do not begin drain;
2. after that dispatch lease is provably stale, the bounded controller invocation that owned it is necessarily past its maximum lifetime;
3. query the authoritative PostgreSQL primary by exact acquisition ID;
4. if a lease exists, classify `LEASE_COMMITTED`, reconcile it, clear only the exact stale dispatch fields, and retain ordinary active-lease semantics until the job reaches terminal/lease-loss disposition;
5. if no lease exists, wait through the remaining PostgreSQL server-operation bound plus fixed safety interval and query the primary again;
6. only two authoritative no-row results after the dispatch invocation can no longer issue new SQL may classify `NO_LEASE_COMMITTED`;
7. clearing the acquisition slot conditions on the exact acquisition ID, worker instance ID, acquisition epoch, dispatch epoch, and absence of a live dispatch lease still matching.

If service remains `ENABLED` and the same acquisition is deliberately retried after a proven `NO_LEASE_COMMITTED` result, the controller may allocate a later dispatch epoch under the **same acquisition ID**. It must not allocate a second job or a second acquisition identity merely because the provider response was lost.

The PostgreSQL uniqueness/idempotency invariant on `leaseAcquisitionId` remains in force.

---

# 5. Worker loss, replacement, and drain interaction — REVISED

A worker that disappears while holding an acquisition slot does not transfer lease-creation authority to its replacement.

- the old slot remains owner-bound until controller dispatch/database reconciliation finishes;
- a replacement worker cannot steal the old acquisition ID or dispatch epoch;
- promotion/maintenance drain cannot pass the acquisition fence while the old slot or a live acquisition dispatch lease remains;
- after exact reconciliation clears the old slot, a currently authorized worker may reserve a new acquisition only if service control is still `ENABLED`;
- a terminated or stale worker host cannot create a queued-job lease because it lacks controller database credentials/privilege, and controller admission rejects acquisitions not present in current protected state.

P1 must exercise the race:

```text
worker reserves acquisition
-> pause before controller invocation
-> recovery/drain begins
-> acquisition slot is reconciled/cleared
-> stale worker resumes and invokes controller
-> controller must reject
-> no PostgreSQL lease may appear
```

and the complementary race:

```text
worker reserves acquisition
-> controller claims dispatch lease
-> recovery/drain races
-> recovery must wait
-> controller invocation dies or database outcome is reconciled
-> only then may the acquisition slot clear / drain advance
```

---

# 6. Durable maintenance incident mode — FROZEN

R21/R22's maintenance singleton is extended:

```text
protectedStackMaintenanceMode:
    IDLE
    | ACTIVE
    | INCIDENT

protectedStackMaintenanceIncidentReason: string | null
protectedStackMaintenanceIncidentEnteredAt: timestamp | null
protectedStackMaintenanceIncidentRecoveryEpoch: non-negative integer
```

`INCIDENT` is **not** equivalent to `IDLE` and is not a cleared maintenance lock. It is a durable fail-closed maintenance ownership state.

When mode is `INCIDENT`, the record retains at minimum:

```text
protectedStackMaintenanceEpoch
protectedStackMaintenanceOperationId
protectedStackMaintenanceActorIdentity
protectedStackMaintenancePlanHash
protectedStackMaintenanceChangeSetArn / exact provider-operation identity
protectedStackMaintenanceProviderState
maintenance dispatch/reconciliation history
pre-maintenance protected infrastructure identity
requiresWorkerDrain
any exact MAINTENANCE service-control owner/epoch still in force
```

The operation identity is not nulled merely because normal execution failed.

---

# 7. Release and maintenance admission require exact `IDLE` — FROZEN

Every R21/R22 authority-granting transaction that was previously described as rejecting maintenance `ACTIVE` is tightened to require:

```text
protectedStackMaintenanceMode == IDLE
```

This includes at minimum:

```text
candidate admission
candidate supersession
logical build-attempt reservation
candidate-wide protected-build-slot claim
StartBuild dispatch authorization
promotion first-use claim
promotion recovery/direction claim
protected deployment mutation-lock claim
release-owned service-control mutation
new normal maintenance claim
```

Therefore both `ACTIVE` and `INCIDENT` block new release-control work.

There is no separate boolean “release admission blocked” whose value can drift from the maintenance mode. The durable mode itself is part of every granting condition.

A new maintenance operation also cannot replace an incident owner. Normal maintenance admission requires exact `IDLE` and null prior maintenance ownership.

---

# 8. Entering maintenance `INCIDENT` — FROZEN

The maintenance controller may transition `ACTIVE -> INCIDENT` only when normal terminalization cannot safely restore the ordinary invariant set, for example:

- provider state is failed/uncertain and requires operator reconciliation;
- provider state and expected protected infrastructure identity disagree;
- a required maintenance-owned drain cannot be safely released;
- emergency break-glass activity has occurred and exact normal evidence must be reconstructed;
- an exact provider operation cannot yet be classified safely.

Before entering `INCIDENT`, any live maintenance provider-dispatch lease must be allowed to expire or be reconciled under the R22 protocol. The transition preserves the same operation ID/epoch/plan/provider identity and increments `protectedStackMaintenanceIncidentRecoveryEpoch` as the controller establishes incident ownership.

If a maintenance-owned service-control epoch is still needed for safety, it remains:

```text
workerLeasingMode = DRAINED
workerServiceControlOwnerType = MAINTENANCE
workerServiceControlOwnerId = exact incident maintenanceOperationId
workerServiceControlOwnerEpoch = exact maintenance epoch
```

That is not an orphan: the active durable incident record preserves the same owner through which the controller must recover it.

The R22 wording that allowed the maintenance lock to be “cleared” while an incident path merely retained `DRAINED` is superseded. Such a case now becomes `INCIDENT`, not `IDLE`.

---

# 9. Incident recovery authority and transition — FROZEN

Normal incident recovery remains mediated by `fpllm-beta-maintenance-controller` and is bound to the existing maintenance operation.

The operator may supply only the existing `maintenanceOperationId` plus a bounded recovery intent. It may not supply substitute stack ARNs, change-set ARNs, worker/evaluator digests, launch-template versions, service-control epochs, or arbitrary provider parameters.

The controller resolves all such identities from protected incident state and conditionally increments the incident recovery epoch before acting.

`INCIDENT -> IDLE` is allowed only when the controller independently proves all applicable predicates:

```text
same maintenance operation/epoch/plan still owns incident state
no live maintenance provider-dispatch lease
exact provider operation/change set has a terminal reconciled disposition
no unresolved provider mutation can later resume
actual protected infrastructure equals an explicitly accepted terminal identity
PROTECTED_EXECUTION_DEPLOYMENT and actual worker ASG/LT/runtime/capacity identity agree
no active release candidate/build/promotion/recovery/mutation authority exists
activeLeaseAcquisitionId == null
no live lease-acquisition dispatch lease exists
no authoritative active learner lease exists
post-recovery health/smoke checks pass
workerServiceControlOwnerType == NONE
workerServiceControlOwnerId == null
workerServiceControlOwnerEpoch == null
```

If the incident used a maintenance-owned drain, service control must first be safely re-enabled through the exact same incident maintenance owner under the R22 health/provider/identity predicates; only that atomic recovery transition may clear the maintenance service owner.

If those predicates cannot be proved, mode remains `INCIDENT`. The system may remain learner-paused/drained, but new release work stays fail-closed.

Emergency break-glass may repair provider infrastructure under incident procedure, but it does not write `IDLE`, clear service-control ownership, or manufacture normal release evidence. The bounded controller/incident reconciliation path must still prove the final state before ordinary release admission resumes.

---

# 10. Protected Lambda quota correction — REVISED AGAIN

R22's four protected control Lambdas are superseded by the addition of the lease-acquisition controller.

The production P1 admission report must prove capacity for **five** one-unit reserved-concurrency protected control Lambdas:

```text
fpllm-beta-candidate-admission            reserved concurrency 1
fpllm-beta-execution-release-broker      reserved concurrency 1
fpllm-beta-promotion-controller          reserved concurrency 1
fpllm-beta-maintenance-controller        reserved concurrency 1
fpllm-beta-lease-acquisition-controller  reserved concurrency 1
```

Required project reservation total:

```text
5 concurrent executions
```

P1 must verify applied regional Lambda concurrency permits these five reservations while preserving AWS's required unreserved concurrency pool and all already-frozen application Lambda needs. Failure is a hard provisioning stop; do not silently remove a reservation, broaden worker database authority, or merge controller roles.

The lease-acquisition controller requires private connectivity to the production PostgreSQL primary and protected release-control state. P1 must include any net-new subnet/security-group/VPC-endpoint consumption in the first no-create quota/topology admission report and must not add an Internet/NAT egress dependency merely to make this controller work.

No other provider selection is changed by this round.

---

# 11. IAM, database, and mutation-authority consequences — FROZEN

P1 effective-policy/database-privilege evidence must prove at minimum:

```text
production worker
    -> may reserve protected acquisition slot
    -> may invoke lease-acquisition controller
    -> may acknowledge promotion/maintenance service-control epochs
    -> cannot perform direct queued-job lease acquisition in PostgreSQL
    -> cannot assume/read controller DB credentials

lease-acquisition controller
    -> exact acquisition-slot/dispatch state read-write only
    -> exact bounded queued-job claim/reconciliation DB authority only
    -> no promotion/maintenance/provider mutation authority

maintenance controller
    -> remains sole normal maintenance provider executor/state writer
    -> incident recovery only for exact recorded maintenance operation

release/build/promotion principals
    -> require maintenance mode IDLE before authority grant
    -> cannot clear INCIDENT

GitHub OIDC/web/learner/evaluator principals
    -> no acquisition-controller DB credential/queued-job claim authority
    -> no maintenance incident write/recovery authority
```

The worker's existing ability to execute already-owned jobs does not imply authority to select or lease a new queued job.

---

# 12. Required P1 evidence additions

In addition to every earlier P1 gate, retain machine-readable evidence for:

1. lease-acquisition controller Lambda timeout, reserved concurrency, caller policy, VPC/database reachability, and absence of unnecessary Internet egress;
2. dedicated controller DB principal and negative proof that the worker DB principal cannot perform `QUEUED -> LEASED` acquisition;
3. acquisition dispatch epoch/lease values and server timestamps;
4. exact race where a worker stalls before controller invocation and cannot create a lease after acquisition-slot clearing/drain;
5. exact race where recovery waits while a live acquisition-controller dispatch lease exists;
6. accepted-but-unrecorded controller/DB result reconciliation by exact acquisition ID before redispatch or slot clearing;
7. five protected one-unit Lambda reservations fitting the applied regional quota while retaining required unreserved capacity;
8. maintenance singleton initialization with `IDLE | ACTIVE | INCIDENT` schema;
9. negative tests proving candidate/build/promotion/new-maintenance authority cannot be granted while mode is `INCIDENT`;
10. `ACTIVE -> INCIDENT` preservation of operation/epoch/plan/provider/service-control owner identity;
11. incident recovery proving that `INCIDENT -> IDLE` cannot occur while a maintenance service owner, live acquisition dispatch, active learner lease, unresolved provider mutation, or deployment drift remains;
12. break-glass recovery evidence proving emergency provider repair cannot directly clear incident/release-control state.

---

# 13. Review-state boundary

Round 23 closes FPR23-01 and FPR23-02 at the decision/specification level only.

It does **not** claim that the lease-acquisition controller, database role split, dispatch lease, five Lambda reservations, maintenance incident state, incident recovery transition, IAM denies, race tests, or production AWS/PostgreSQL evidence are implemented.

The resulting exact HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

# Platform v0.5 — Maintainer Corrections Round 21 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Independent review baseline:** `a049f509b205a347ceb87eec2b95bbfb705f0918`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and exact-head Codex findings

The fresh independent review of exact HEAD `a049f509b205a347ceb87eec2b95bbfb705f0918` found two remaining cross-operation races in the otherwise frozen P0 state machines:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR21-01 | HIGH | R15 waits for a drain acknowledgement and a point-in-time zero-active-lease observation, but a lease acquisition that already passed its pre-drain check can still commit in PostgreSQL after that observation. The controller could then replace the worker while a learner job has just become owned. | Add one durable lease-acquisition fence in protected service-control state. A worker must atomically reserve that fence while service mode is `ENABLED` before it may attempt the PostgreSQL lease transaction. The drain transition and fence reservation contend on the same protected item, so either the drain wins and no acquisition can start, or the acquisition wins and drain cannot advance until the exact acquisition is reconciled. Every PostgreSQL lease claim records the acquisition ID + service-control epoch atomically with the lease so accepted-but-unrecorded outcomes are recoverable before the fence can be cleared. |
| FPR21-02 | HIGH | R14/R18 require quiescent protected-stack maintenance but only as precondition reads. A release admission/build/promotion can start immediately after those reads while CloudFormation changes the broker/controller/IAM/private-build substrate. | Add one durable protected-stack maintenance epoch/lock. Normal maintenance claims it transactionally only from a fully quiescent release-control state. Candidate admission/supersession, logical-attempt reservation, build dispatch, promotion/recovery claim, and release-control service mutations all condition on maintenance being idle. Lock claim and release are owner/epoch-bound and fail closed on drift. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R21_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R20_v0.5.md
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

# 1. Durable learner-lease acquisition fence — FROZEN

R15's service-control state is extended with a single durable acquisition slot because v0.5 has exactly one trusted worker host and submission concurrency 1:

```text
workerLeasingMode: ENABLED | DRAIN_REQUESTED | DRAINED
workerDrainEpoch: non-negative integer
workerDrainPromotionRequestId: string | null

activeLeaseAcquisitionId: string | null
activeLeaseAcquisitionWorkerInstanceId: string | null
activeLeaseAcquisitionEpoch: integer | null
activeLeaseAcquisitionStartedAt: timestamp | null
```

The acquisition fields live in the same protected service-control item, or in a transactionally coupled item in the same DynamoDB transaction boundary. They are not process-local worker memory.

Only the production worker identity may request an acquisition slot, and it may not directly mutate the service mode, drain epoch, promotion owner, deployment generation, candidate state, build state, or promotion state.

## 1.1 Reserving a lease acquisition

Before any PostgreSQL operation that can create a new learner-job lease, the worker generates a cryptographically unique `leaseAcquisitionId` and conditionally claims the protected acquisition slot.

The atomic claim requires:

```text
workerLeasingMode == ENABLED
activeLeaseAcquisitionId == null
worker instance/runtime identity == currently authorized production worker identity
```

and atomically records:

```text
activeLeaseAcquisitionId = leaseAcquisitionId
activeLeaseAcquisitionWorkerInstanceId = workerInstanceId
activeLeaseAcquisitionEpoch = workerDrainEpoch
activeLeaseAcquisitionStartedAt = server timestamp
```

Failure to claim the slot means no PostgreSQL learner-lease transaction is attempted.

A stale worker invocation cannot reuse a prior acquisition ID or a prior service-control epoch.

## 1.2 PostgreSQL claim identity is atomically persisted with the lease

The PostgreSQL transaction that claims a queued submission job must write, atomically with the durable lease ownership transition:

```text
leaseAcquisitionId
leaseServiceControlEpoch
workerInstanceId
lease owner / expiry fields already required by the job protocol
```

The acquisition ID is unique for the production lease domain. Replaying the same acquisition ID is idempotent: it resolves to the already-committed lease outcome or proves that no lease was committed; it never leases a second job.

The worker may release the DynamoDB acquisition slot only after the PostgreSQL outcome for that exact acquisition ID is durably known.

If the lease committed, clearing the acquisition slot does **not** mean the worker is idle; ordinary authoritative job/lease state continues to show the active learner job until it reaches terminal/lease-loss disposition.

---

# 2. Drain and acquisition now contend on one atomic fence

The promotion-bound transition from `ENABLED` to `DRAIN_REQUESTED` is no longer a point-in-time mode write that can race a pre-authorized lease attempt.

The controller's conditional drain transaction requires:

```text
workerLeasingMode == ENABLED
activeLeaseAcquisitionId == null
active promotion/generation/service-control ownership predicates still match
```

and atomically writes the next drain epoch plus `DRAIN_REQUESTED` ownership as already frozen by R15/R16.

The worker acquisition-slot claim and the controller drain transition therefore serialize on the same protected state:

- **drain wins first:** mode becomes `DRAIN_REQUESTED`; any later acquisition claim fails and no PostgreSQL lease attempt begins;
- **acquisition wins first:** `activeLeaseAcquisitionId` becomes non-null; the drain transaction fails its condition and must reconcile that exact acquisition before retrying the drain transition.

There is no state in which the controller has successfully established `DRAIN_REQUESTED` while an unaccounted pre-drain acquisition is still authorized to commit.

## 2.1 Accepted-but-unrecorded acquisition recovery

A worker crash, connection reset, database timeout, or process loss after acquisition-slot reservation must not be resolved by time alone.

The protected recovery path first queries the authoritative PostgreSQL primary by the exact `leaseAcquisitionId`:

1. if a lease row/job transition exists for that ID, the acquisition is classified `LEASE_COMMITTED`; the fence is cleared only after that durable outcome is recorded/reconciled, and drain waits for the resulting lease to terminate/expire normally;
2. if no committed lease exists and the database transaction is provably no longer live, the acquisition is classified `NO_LEASE_COMMITTED`; the fence may then be cleared conditionally for that exact acquisition ID/epoch;
3. if the outcome is uncertain, the fence remains occupied and destructive worker mutation is prohibited.

A timeout/TTL may trigger reconciliation work but may not itself authorize fence clearing.

The existing bounded authoritative lease-state query required by R15 is extended to include lookup by acquisition ID; P1 may realize this through a narrowly scoped diagnostic/read path, but it must not grant the promotion controller general learner-database mutation authority.

## 2.2 Drain acknowledgement is now sufficient only after acquisition reconciliation

For a serving source `PAIR`, destructive ASG/LT mutation requires all of:

```text
workerLeasingMode == DRAIN_REQUESTED or DRAINED for the request-owned epoch
activeLeaseAcquisitionId == null
source worker acknowledged the exact drain epoch, or source-host-loss recovery has completed
no authoritative active learner lease owned by the source worker
no unresolved PostgreSQL lease acquisition for the source worker/epoch
promotion/generation/mutation predicates still match
```

The controller rechecks these predicates immediately before the first destructive source-worker mutation and on journal recovery steps whose allowed transition can terminate/replace the source.

---

# 3. Lease-fence behavior under host loss and retries

If the worker disappears while holding `activeLeaseAcquisitionId`:

- the slot remains occupied;
- a replacement worker starts non-leasing if service mode is not `ENABLED`, and cannot steal or clear the old acquisition ID;
- the recovery path reconciles the old acquisition against PostgreSQL before clearing it;
- any committed lease follows ordinary expiry/retry/evidence provenance;
- a new worker may reserve a new acquisition only after the old slot is conditionally cleared and service mode is still `ENABLED`.

If the worker loses the PostgreSQL response but the lease committed, replaying the same acquisition ID must rediscover that same lease rather than create another lease or classify the worker idle.

This fence is strictly about **new lease acquisition**. It does not replace the durable active-lease state, lease expiry, retry accounting, or the promotion-bound drain acknowledgement already frozen in earlier rounds.

---

# 4. Protected-stack maintenance epoch/lock — FROZEN

Normal protected-stack administration now has one durable singleton:

```text
protectedStackMaintenanceEpoch: non-negative integer
protectedStackMaintenanceMode: IDLE | ACTIVE
protectedStackMaintenanceOperationId: string | null
protectedStackMaintenanceActorIdentity: string | null
protectedStackMaintenanceClaimedAt: timestamp | null
```

The state belongs to protected release control. Routine GitHub release roles, web, worker, builders, learner sandboxes, and ordinary application code cannot write it.

Only the authorized non-GitHub protected-stack-admin path may request a normal maintenance claim, and the operation ID is generated/validated by the bounded protected maintenance-control path rather than treated as arbitrary authority to mutate release state.

## 4.1 Atomic maintenance claim from a fully quiescent state

A normal maintenance claim is one DynamoDB transactional state transition. It requires the existing P0 release-control state to be fully quiescent, including at minimum:

```text
protectedStackMaintenanceMode == IDLE
ACTIVE_CANDIDATE == null
activeProtectedBuildComponent == null
activeProtectedLogicalAttemptId == null
PROTECTED_EXECUTION_DEPLOYMENT.activeMutationPromotionRequestId == null
no failed_requires_operator / incident-reconciliation-required promotion
no protected build/promotion/recovery dispatch lease or unresolved mutation journal step
```

and atomically writes:

```text
protectedStackMaintenanceEpoch = previous + 1
protectedStackMaintenanceMode = ACTIVE
protectedStackMaintenanceOperationId = generated operation ID
protectedStackMaintenanceActorIdentity = authenticated stack-admin audit identity
protectedStackMaintenanceClaimedAt = server timestamp
```

If any release-control state becomes active first, the maintenance claim fails. The administrator does not proceed from stale precondition reads.

Requiring `ACTIVE_CANDIDATE == null` intentionally makes normal v0.5 maintenance conservative: a built/approved candidate must be promoted, deliberately superseded/closed through the existing protected path, or otherwise terminally disposed before routine protected-stack maintenance begins.

---

# 5. Every release-control entry point is maintenance-fenced

While `protectedStackMaintenanceMode == ACTIVE`, normal release-control work is rejected before it can acquire authority.

At minimum the following protected transactions/claims condition on maintenance being `IDLE`:

```text
candidate admission
supersede-and-admit
logical build-attempt reservation
candidate-wide protected-build-slot claim
StartBuild dispatch-lease claim / re-dispatch authorization
promotion request first-use claim
promotion recovery / direction claim
protected deployment mutation-lock claim
service-control release mutation owned by a release request
```

Where a release-control transition spans multiple protected items, the maintenance-idle condition is part of the same DynamoDB transaction/conditional write that grants the release authority.

This closes both orderings:

- if release work commits first, the maintenance claim fails its quiescence conditions;
- if maintenance claims first, release admission/reservation/promotion conditions fail while maintenance is active.

A process that merely read `IDLE` before the maintenance claim cannot later obtain release authority without revalidating the maintenance epoch in its granting transaction.

Existing R10/R12 dispatch fences remain authoritative for external provider calls. A maintenance claim is never allowed while an unresolved dispatch/provider operation exists.

---

# 6. Maintenance execution and release of the lock

After the maintenance lock is active, the stack administrator may execute only the already-frozen R18 class of normal post-promotion changes that leave the live worker deployment identity/release-control state unchanged. Initial P1 bootstrap remains governed by R18 §1.1 and must establish the maintenance singleton in `IDLE` before ordinary release admission is enabled.

If a permitted maintenance change is runtime-affecting without changing the frozen worker deployment identity, the already-authorized maintenance/drain mechanism may pause learner admission/leasing, but it must be bound to the current maintenance operation/epoch and must not mutate worker capacity, runtime digests, deployment generation, or release evidence.

The maintenance lock is cleared only after independent post-change verification proves:

```text
same maintenance operation ID/epoch still owns the lock
no release-control work became active
actual worker ASG/LT/runtime/capacity identity == pre-maintenance recorded identity
PROTECTED_EXECUTION_DEPLOYMENT still matches actual worker deployment
service-control state is in its expected authorized maintenance disposition
reviewed CloudFormation/IAM/controller change reached a terminal known state
```

The release transition conditionally writes:

```text
protectedStackMaintenanceMode = IDLE
protectedStackMaintenanceOperationId = null
protectedStackMaintenanceActorIdentity = null
protectedStackMaintenanceClaimedAt = null
```

while retaining the incremented epoch as monotonic history.

A stale administrator invocation cannot clear a newer maintenance operation.

If post-change verification cannot prove the frozen invariants, maintenance remains active or enters the existing incident/break-glass reconciliation path. Release admission does not resume merely because CloudFormation completed.

---

# 7. Emergency break-glass does not bypass the maintenance/release boundary

Emergency stack-admin action remains incident-only under R14/R18. If emergency authority is used without a normal maintenance claim or while release work is active:

- affected release work is non-promotable pending incident reconciliation;
- ordinary maintenance/release locks are not fabricated after the fact as proof of serialized execution;
- actual provider/release state is inventoried independently;
- any invariant that can no longer be proven requires the existing fail-closed/new-approval/P0-amendment path;
- break-glass cannot manufacture a normal maintenance success, promotion success, deployment generation, or service-control acknowledgement.

---

# 8. Required P1 evidence additions

P1 must prove, in addition to every earlier gate:

1. a worker cannot begin a PostgreSQL lease claim without first reserving the protected acquisition slot while service mode is `ENABLED`;
2. drain transition and acquisition reservation are mutually exclusive atomic outcomes on the same protected state;
3. every committed PostgreSQL learner lease records the exact acquisition ID and service-control epoch atomically with lease ownership;
4. an accepted-but-unrecorded database lease is rediscovered by acquisition ID before the fence can clear;
5. timeout/TTL alone cannot clear an acquisition fence;
6. a drain request that loses the race to an acquisition waits for that exact acquisition to reconcile and then observes any resulting active lease before destructive mutation;
7. a drain request that wins first prevents the worker from starting the PostgreSQL lease transaction;
8. host loss while an acquisition is unresolved cannot let a replacement worker bypass the fence;
9. destructive worker replacement requires null acquisition slot + no unresolved acquisition + exact drain acknowledgement/lease-state predicates;
10. normal protected-stack maintenance claim is one atomic transaction from fully quiescent release-control state;
11. admission, supersession, build-attempt/slot reservation, dispatch authorization, promotion/recovery claim, and deployment mutation claims all fail while maintenance is active;
12. the release/maintenance race is tested in both directions so exactly one side acquires authority;
13. stale maintenance operations cannot clear a newer maintenance epoch;
14. normal maintenance cannot change the frozen live worker deployment identity or release-control evidence and cannot resume releases until post-change invariants are independently proven;
15. emergency break-glass remains incident-only and cannot synthesize either the lease-acquisition fence evidence or the maintenance-lock evidence required by the normal path.

---

# 9. Review-state boundary

Round 21 closes FPR21-01 and FPR21-02 at the decision/specification level. It does not claim the acquisition fence, PostgreSQL acquisition correlation, maintenance lock, cross-operation race tests, IAM enforcement, AWS/DynamoDB/PostgreSQL configuration, or production evidence are implemented.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

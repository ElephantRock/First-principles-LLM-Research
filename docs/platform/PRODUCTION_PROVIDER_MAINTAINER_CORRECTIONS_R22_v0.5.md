# Platform v0.5 — Maintainer Corrections Round 22 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Independent review baseline:** `fbcd93fb9d9dafcb1fdb6f2df21a19737e4c6800`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and exact-head Codex findings

The fresh independent review of exact HEAD `fbcd93fb9d9dafcb1fdb6f2df21a19737e4c6800` found three remaining implementation-authority gaps in R21:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR22-01 | HIGH | R21 bounded individual PostgreSQL statements and lock waits, but a client-managed transaction could complete the lease-owning update and then remain idle before `COMMIT`, outliving both bounds. Recovery could observe two no-row reads, clear the acquisition fence, and later see the delayed transaction commit. | Production learner-lease acquisition is now one server-bounded **single autocommit database operation** with no client-visible open transaction interval. It must atomically select/claim the job and persist the acquisition ID/epoch/worker/lease fields in one SQL statement or one server-side function invoked as one statement. Explicit client `BEGIN ... COMMIT` around this claim is prohibited. Existing statement/lock bounds therefore bound the entire uncommitted lease-acquisition operation. |
| FPR22-02 | HIGH | A maintenance executor could record `EXECUTING`, pause before `ExecuteChangeSet`, while recovery concludes no provider operation began, clears the lock, and then the stale executor resumes. | Add a dedicated protected maintenance controller as the sole normal CloudFormation/change-set execution authority plus an R12-style provider-dispatch epoch/lease whose lifetime exceeds controller invocation lifetime. Recovery cannot classify/cancel/release while a dispatch may be live. After the lease is stale, recovery reconciles the exact provider identity; a verified no-start cancellation additionally invalidates/deletes the exact change set before maintenance can clear. |
| FPR22-03 | HIGH | R21 permits runtime-affecting maintenance to pause learner execution, but the existing service-control protocol is promotion-owned and gives no maintenance operation a bounded drain/ack/re-enable authority. | Generalize service-control ownership to a discriminated `PROMOTION | MAINTENANCE` owner. A maintenance operation whose approved plan requires drain claims its own service-control epoch atomically against the same acquisition fence, uses the existing worker acknowledgement/zero-active-lease proof, reaches `DRAINED` before provider mutation, and may re-enable only through the same maintenance controller after exact post-change verification. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R22_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R21_v0.5.md
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

# 1. Learner lease claim is one autocommit database operation — FROZEN

R21's acquisition-slot protocol remains authoritative, with one stronger database execution rule.

After the worker has successfully claimed the exact protected `leaseAcquisitionId`/service-control epoch, the production PostgreSQL lease acquisition must execute as **one autocommit server operation**. Acceptable realizations are:

```text
A. one SQL statement using CTE/row-lock/update primitives; or
B. one reviewed PostgreSQL function/procedure call that performs the complete claim internally
   and is invoked by one autocommit SQL statement.
```

The operation must atomically perform every database action necessary to establish authoritative learner-job ownership, including at minimum:

```text
select one eligible queued job under the existing lease-ordering rules
lock/conditionally claim that exact job
persist leaseAcquisitionId
persist leaseServiceControlEpoch
persist workerInstanceId / lease owner
persist lease expiry / attempt transition fields required by the frozen job protocol
return the exact committed lease identity or a deterministic no-job outcome
```

Production lease acquisition may **not** use a client-managed interval of the form:

```text
BEGIN
... statement(s) that create lease ownership ...
<return to client / await / arbitrary process interval>
COMMIT
```

and may not depend on an application process remaining alive to issue a later commit after the server has completed the lease-owning statement.

The acquisition-ID uniqueness constraint frozen by R21 remains mandatory.

## 1.1 Entire uncommitted acquisition is bounded

The autocommit lease-acquisition statement retains R21's server-side limits:

```text
statement_timeout <= 5 seconds
lock_timeout      <= 2 seconds
```

Because the entire lease claim is one autocommit statement, PostgreSQL either commits that statement's transaction as the statement succeeds or aborts it; there is no later client-held idle transaction that can publish ownership after the statement bound.

For defense in depth, the production worker database role/session must also set:

```text
idle_in_transaction_session_timeout <= 5 seconds
```

but this is not the primary correctness mechanism: the lease claim itself must still be one autocommit operation.

The application/client timeout must be configured so a timed-out caller enters acquisition reconciliation rather than issuing a second acquisition identity while the server operation may still be resolving.

## 1.2 Recovery proof for `NO_LEASE_COMMITTED`

R21's primary/read-after-commit-consistent lookup by exact acquisition ID remains required.

A no-row observation may classify `NO_LEASE_COMMITTED` only after:

1. the first lookup by exact acquisition ID returns no committed lease;
2. the maximum configured lease-acquisition statement bound plus a fixed safety interval has elapsed since the last possible server invocation for that acquisition;
3. the authoritative PostgreSQL primary is reachable and not reporting an indeterminate transaction state for the operation;
4. a second lookup by the same exact acquisition ID still returns no committed lease.

No client timeout, process death, DynamoDB timestamp, or absence of a response substitutes for this proof.

P1 must prove the single-operation/autocommit property at the database protocol boundary, not merely by application convention.

---

# 2. Protected maintenance controller — SELECTED

Add one bounded protected control-plane Lambda:

```text
name:                  fpllm-beta-maintenance-controller
region:                eu-west-1
reserved concurrency:  1
timeout:                <= 30 seconds
caller:                 fpllm-beta-protected-stack-admin only
normal CloudFormation/change-set execution authority: controller only
normal maintenance-state write authority:             controller only
```

The non-GitHub `fpllm-beta-protected-stack-admin` role becomes **invoke/read-diagnostic only for normal post-bootstrap maintenance**. It may prepare/review the exact maintenance plan through the bounded admission interface and invoke this controller, but it does not retain direct normal `cloudformation:ExecuteChangeSet`, protected release-control DynamoDB write, service-control write, ASG/LT mutation, or protected runtime-selection authority.

Initial P1 bootstrap remains the separately frozen R18 bootstrap case. After bootstrap establishes the maintenance controller, its role, protected release-control state, and ordinary stack resources, normal maintenance uses only this mediated path.

Emergency break-glass remains separate, incident-only authority and cannot manufacture normal maintenance evidence.

## 2.1 Maintenance controller is part of the v0.5 root control boundary

Normal v0.5 maintenance may not replace or mutate:

```text
fpllm-beta-maintenance-controller code/configuration
the maintenance controller execution role / permissions boundary
the protected maintenance singleton schema/ownership policy
the IAM rule that removes direct normal ExecuteChangeSet authority from stack-admin
```

Changing those root-control elements after bootstrap requires an explicit P0 amendment before planned use. Emergency break-glass may touch them only as incident response and leaves release/maintenance state non-normal until reconciled.

This prevents a maintenance operation from replacing the mediator that is supposed to constrain and recover that same operation.

---

# 3. Maintenance provider-dispatch epoch/lease — FROZEN

Extend the R21 maintenance singleton with:

```text
maintenanceProviderDispatchEpoch: integer
maintenanceProviderDispatchOwnerInvocationId: string | null
maintenanceProviderDispatchLeaseExpiresAt: timestamp | null
maintenanceProviderDispatchClaimedAt: timestamp | null
```

The exact change-set ARN, plan hash, maintenance operation ID/epoch, and provider state remain as frozen by R21.

Before **every** external provider call that can begin the recorded maintenance mutation, including `ExecuteChangeSet`, the maintenance controller conditionally claims a new dispatch epoch/lease.

The claim requires all of:

```text
protectedStackMaintenanceMode == ACTIVE
exact maintenance operation ID/epoch/plan hash/change-set ARN match
provider state permits this exact call
no live maintenance provider-dispatch owner exists
all required maintenance drain predicates are satisfied when plan.requiresWorkerDrain == true
```

and records a controller invocation ID plus lease expiry.

Frozen timing envelope:

```text
maintenance controller Lambda timeout:       <= 30 seconds
provider dispatch lease lifetime:             90 seconds
new external provider call permitted only if: >= 15 seconds Lambda time remains
provider API client timeout:                  <= 10 seconds
```

The dispatch lease therefore remains live longer than the maximum controller invocation that could have been authorized by it.

While a dispatch lease may still belong to a live invocation, no recovery/cancel path may:

```text
classify the provider operation as never started
invalidate/delete the bound change set
clear or supersede the maintenance operation
release the maintenance lock
re-enable worker service for a drained maintenance operation
admit normal release-control work
```

## 3.1 Accepted-but-unrecorded or delayed provider execution

If the controller crashes, times out, or loses the `ExecuteChangeSet` response:

1. a later invocation waits until the dispatch lease is provably stale, unless the exact prior invocation is already known terminated by the platform;
2. it queries CloudFormation using the exact recorded stack/change-set/operation identity and reconciles execution state before any repeat/cancel decision;
3. if the exact change set is executing or completed, recovery follows the R21 `EXECUTING`/`SUCCEEDED`/`FAILED` path and does not issue a second execution;
4. if provider state is ambiguous, maintenance remains `ACTIVE/UNCERTAIN` and release remains blocked;
5. only if the provider proves the exact change set was never executed may recovery select the no-start cancellation path.

The old invocation cannot resume after its dispatch lease becomes stale because the only normal provider executor is the bounded controller Lambda and that invocation's maximum lifetime is shorter than the lease.

## 3.2 No-start cancellation makes a stale provider call impossible

Before a verified no-start maintenance operation can release its lock, the controller must additionally make the recorded provider identity non-executable:

```text
delete/invalidate the exact unexecuted CloudFormation change set
-> verify that exact ARN can no longer be executed
-> conditionally record cancellation against the same operation/epoch/dispatch generation
```

If the change set cannot be proven non-executable, the maintenance lock remains active.

A stale stack-admin session has no direct normal `ExecuteChangeSet` permission, so deleting the change set plus expiry of the bounded controller invocation removes both normal delayed-call paths.

---

# 4. Generalized service-control owner — FROZEN

R15/R16's promotion-owned service-control fields are generalized. Where earlier text refers to `workerDrainPromotionRequestId`, R22's discriminated owner is authoritative:

```text
workerLeasingMode: ENABLED | DRAIN_REQUESTED | DRAINED
workerDrainEpoch: non-negative integer
workerServiceControlOwnerType: NONE | PROMOTION | MAINTENANCE
workerServiceControlOwnerId: string | null
workerServiceControlOwnerEpoch: integer | null
```

Compatibility mapping for the earlier promotion protocol is:

```text
workerServiceControlOwnerType  = PROMOTION
workerServiceControlOwnerId    = promotionRequestId
workerServiceControlOwnerEpoch = promotion-bound service-control epoch
```

No behavior in R15/R16 is weakened by this rename/generalization.

The production worker acknowledges the exact `workerDrainEpoch` plus owner type/ID; acknowledgement from a different promotion or maintenance operation is invalid.

---

# 5. Maintenance-owned drain/acknowledgement/re-enable — FROZEN

Every approved maintenance plan records one immutable boolean:

```text
requiresWorkerDrain: true | false
```

The value is included in `protectedStackMaintenancePlanHash` and cannot change after the maintenance claim.

A plan that can affect code, IAM, networking, evaluator/build authority, database connectivity, worker dependencies, or any control-plane behavior on which an in-flight learner execution depends must set `requiresWorkerDrain = true`. P1 may conservatively classify more maintenance as requiring drain; it may not downgrade a reviewed `true` plan to `false` at runtime.

## 5.1 Claiming a maintenance drain

For `requiresWorkerDrain = true`, the maintenance controller must establish a maintenance-owned drain before any external maintenance provider mutation.

If service is `ENABLED`, the controller's atomic service-control transaction requires:

```text
exact ACTIVE maintenance operation ID/epoch/plan hash still matches
workerServiceControlOwnerType == NONE
activeLeaseAcquisitionId == null
workerLeasingMode == ENABLED
```

and atomically writes:

```text
workerDrainEpoch = previous + 1
workerLeasingMode = DRAIN_REQUESTED
workerServiceControlOwnerType = MAINTENANCE
workerServiceControlOwnerId = maintenanceOperationId
workerServiceControlOwnerEpoch = maintenanceEpoch
```

This transaction contends with R21/R22 learner-acquisition reservation on the same protected service-control state:

- maintenance drain wins first -> later acquisition reservation fails;
- acquisition reservation wins first -> maintenance drain claim fails and must reconcile that exact acquisition before retrying.

If the source worker is already in a legitimate non-`ENABLED` state owned by another operation, normal maintenance does not steal it; maintenance claim fails until the prior owner reaches its frozen terminal disposition.

## 5.2 Worker acknowledgement and transition to `DRAINED`

The source worker stops requesting new acquisition slots as soon as it observes the maintenance-owned `DRAIN_REQUESTED` epoch.

It acknowledges only after:

```text
exact maintenance owner type/ID/epoch observed
activeLeaseAcquisitionId == null for that source worker
no active learner lease remains for that source worker
local execution state is IDLE
```

The maintenance controller independently verifies the authoritative PostgreSQL primary and protected acquisition state. It may transition to `DRAINED` only when:

```text
exact ACTIVE maintenance operation still owns service control
worker acknowledgement matches exact drain epoch + maintenance owner
activeLeaseAcquisitionId == null
no unresolved acquisition exists for the source worker/epoch
no authoritative active learner lease remains for the source worker
```

The transition is conditional on the exact maintenance owner and does not mutate worker capacity, runtime digest, launch-template identity, or deployment generation.

The R15 source-host-loss recovery rules apply analogously, but the maintenance operation remains blocked until authoritative lease/acquisition state is reconciled.

## 5.3 Provider dispatch requires maintenance drain when selected

When `requiresWorkerDrain = true`, the R22 provider-dispatch lease claim additionally requires:

```text
workerLeasingMode == DRAINED
workerServiceControlOwnerType == MAINTENANCE
workerServiceControlOwnerId == exact maintenanceOperationId
workerServiceControlOwnerEpoch == exact maintenanceEpoch
activeLeaseAcquisitionId == null
no authoritative active learner lease
```

Therefore maintenance cannot start its external provider mutation on a merely requested or point-in-time drain.

## 5.4 Re-enable or remain drained

Worker leasing is not re-enabled merely because CloudFormation reports success/failure.

The maintenance controller may return service to `ENABLED` only after:

```text
same maintenance operation/epoch/plan hash still owns maintenance + service control
no live maintenance provider dispatch lease
provider operation is in an exact reconciled terminal disposition that permits service
actual worker ASG/LT/runtime/capacity identity still equals the pre-maintenance frozen identity
PROTECTED_EXECUTION_DEPLOYMENT still matches actual infrastructure
activeLeaseAcquisitionId == null
no authoritative active learner lease exists
post-change smoke/health checks required by the maintenance plan pass
```

and atomically writes:

```text
workerLeasingMode = ENABLED
workerServiceControlOwnerType = NONE
workerServiceControlOwnerId = null
workerServiceControlOwnerEpoch = null
```

If maintenance is `FAILED`, `UNCERTAIN`, or incident reconciliation is required, service remains `DRAINED` unless the exact reviewed recovery path independently proves it is safe to re-enable.

For a verified no-start cancellation, service may re-enable only after the exact change set is proven non-executable and the same pre-maintenance identity/health predicates pass.

The maintenance lock is cleared only after any maintenance-owned service-control state has either been safely re-enabled or, for an incident path, has been explicitly retained as `DRAINED` with release admission still blocked. A normal maintenance success cannot leave an orphaned maintenance service owner.

---

# 6. Protected Lambda quota correction — REVISED

R19's protected control-Lambda count is superseded by the addition of the maintenance controller.

The production P1 admission report must prove capacity for **four** one-unit reserved-concurrency protected control Lambdas:

```text
fpllm-beta-candidate-admission       reserved concurrency 1
fpllm-beta-execution-release-broker reserved concurrency 1
fpllm-beta-promotion-controller     reserved concurrency 1
fpllm-beta-maintenance-controller   reserved concurrency 1
```

Required project reservation total:

```text
4 concurrent executions
```

P1 must verify the applied regional account concurrency permits these four reservations while preserving AWS's required unreserved concurrency pool and all already-frozen application Lambda needs. Failure is a hard provisioning stop; do not silently remove a reservation or merge controller roles.

No other R19 provider-quota decision is changed by this round.

---

# 7. IAM and mutation authority consequences — FROZEN

After initial protected-stack bootstrap, normal v0.5 authority is:

| Principal | Normal maintenance authority |
|---|---|
| `fpllm-beta-protected-stack-admin` | invoke maintenance controller/admission + bounded read diagnostics; no direct protected release-control write or `ExecuteChangeSet` |
| `fpllm-beta-maintenance-controller` | exact maintenance state/service-control transactions + exact recorded change-set execution/reconciliation required by this contract |
| `fpllm-beta-promotion-controller` | promotion-owned worker deployment/service-control operations only; cannot claim a maintenance owner |
| production worker | acquisition-slot request + exact worker acknowledgement only; cannot claim maintenance/promotion ownership |
| GitHub OIDC/deploy roles | no protected maintenance claim, service-control ownership, or protected maintenance execution |

The maintenance controller's CloudFormation authority is resource- and operation-bounded to the selected FPLLM protected stacks and exact recorded change-set path. It receives no private evaluator bundle read authority, learner DB mutation authority, GitHub App secrets, or arbitrary worker digest-selection authority.

P1 must prove the effective IAM deny/absence of direct normal `ExecuteChangeSet` authority on stack-admin, not merely rely on procedure.

---

# 8. Required P1 evidence additions

P1 must prove, in addition to every earlier gate:

1. production learner lease ownership is established by one autocommit SQL statement/server operation with no client-held `BEGIN ... COMMIT` interval;
2. acquisition ID/epoch/worker/lease fields and job ownership transition are atomic and acquisition ID is unique;
3. `statement_timeout <= 5s`, `lock_timeout <= 2s`, and `idle_in_transaction_session_timeout <= 5s` are effective for the worker lease path;
4. accepted-but-unrecorded acquisition recovery cannot classify no-start until the whole autocommit operation is beyond its server bound and two authoritative primary lookups by acquisition ID return no row;
5. the new maintenance controller is reserved at concurrency 1 with <=30s timeout and stack-admin lacks direct normal `ExecuteChangeSet` authority;
6. maintenance provider-dispatch lease claim is durable, operation/plan/change-set bound, 90s, and outlives every authorized controller invocation;
7. recovery cannot cancel/release maintenance while a provider-dispatch lease may still be live;
8. a delayed controller invocation cannot execute after recovery has cleared maintenance because it is dead before lease expiry and no other normal principal has execution authority;
9. verified no-start cancellation deletes/invalidates the exact change set and proves it non-executable before lock release;
10. `requiresWorkerDrain` is immutable inside the maintenance plan hash and all runtime-affecting maintenance is classified `true`;
11. maintenance drain and learner-acquisition reservation race in both orders with exactly one authority winner;
12. worker acknowledgement is bound to the exact maintenance owner type/ID/epoch and `DRAINED` requires null acquisition + no unresolved acquisition + zero authoritative active lease;
13. maintenance provider dispatch is impossible before exact maintenance-owned `DRAINED` when drain is required;
14. maintenance re-enable is controller-mediated, owner-bound, forbidden while provider dispatch/operation is uncertain, and requires unchanged worker deployment identity plus health checks;
15. promotion-owned and maintenance-owned service-control operations cannot steal or clear one another's owner/epoch;
16. the applied Lambda quota report covers all four one-unit protected control Lambdas while retaining the required unreserved pool;
17. maintenance-controller code/role/root-control IAM cannot be changed by normal post-bootstrap maintenance;
18. emergency break-glass remains incident-only and cannot synthesize the autocommit-acquisition, dispatch-lease, maintenance-drain, or controller-authority evidence required by the normal path.

---

# 9. Review-state boundary

Round 22 closes FPR22-01, FPR22-02, and FPR22-03 at the decision/specification level. It does not claim the single-operation PostgreSQL lease path, session settings, maintenance controller, IAM mediation, dispatch lease, generalized service-control owner, maintenance drain protocol, updated Lambda reservation, race tests, or production AWS state are implemented.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

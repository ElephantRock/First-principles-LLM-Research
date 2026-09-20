# Platform v0.5 — Maintainer Corrections Round 12 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Codex review baseline:** `9109df0ce26d928bff7e7a7f3a8c71eb9ec41712`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and findings disposition

The fresh exact-HEAD Codex review of `9109df0ce26d928bff7e7a7f3a8c71eb9ec41712` found three remaining time-of-check / mutation-authority gaps in the protected release-control protocol:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| CXR12-01 | P1 | R11 performed a final active-candidate/logical-attempt check immediately before `StartBuild`, but the check and external API call were still non-atomic. A delayed invocation could pass the check, another path could terminalize the attempt and reserve a later ordinal, and the delayed caller could then start the old attempt. | Add a durable per-attempt **start-dispatch lease/epoch** that is claimed transactionally before the external call. Attempt terminalization, candidate-invalidating transitions, and later attempt allocation are prohibited while that lease can still belong to a live broker invocation. Recovery may proceed only after the lease is provably stale and then follows the existing CodeBuild discovery/idempotency protocol. |
| CXR12-02 | P1 | R11 reconciled the prior deployment and then recorded the promotion claim, but did not bind that snapshot to an exclusive infrastructure generation. A concurrent protected deployment operation could change the actual `PAIR`/`ABSENT` state before target mutation. | Add a protected deployment-generation singleton plus one active mutation lock. Promotion claim binds the observed prior state to generation `g` and atomically owns that generation before mutation. All steady-state protected execution-tier mutations must go through the controller below and must match the recorded generation/lock. |
| CXR12-03 | P1 | R11 left the human `fpllm-beta-protected-deploy` role with direct protected-stack mutation authority and used the recovery mediator only after mutation. A mistaken/compromised operator session could therefore deploy a third privileged digest even though later reconciliation would refuse to bless it. | Remove direct steady-state protected infrastructure mutation from the operator role. Route both normal promotion and recovery mutation through one protected schema-enforcing promotion controller that resolves only the bound target/prior states from protected records. The operator may invoke the controller but cannot choose arbitrary digests or call the protected ASG/launch-template mutation APIs directly. |

Precedence inside the P0 record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R12_v0.5.md
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

# 1. StartBuild dispatch fencing — FROZEN

R10/R11 remain authoritative for logical-attempt reservation, CodeBuild native idempotency, project-scoped recovery discovery, and supersession blocking. This round adds the missing durable fence between the last state check and the external `StartBuild` call.

## 1.1 Per-attempt dispatch fields

Each unresolved logical attempt additionally stores:

```text
startDispatchEpoch              # monotonic integer within the logical attempt
startDispatchLeaseId            # server-generated opaque identity | null
startDispatchOwnerRequestId     # AWS Lambda invocation/request identity | null
startDispatchClaimedAt          # server timestamp | null
startDispatchLeaseExpiresAt     # timestamp | null
startDispatchState              # idle | leased | response_recorded
```

These fields are broker-owned protected state. GitHub, builders, approver, protected-deploy operator, web, and worker cannot write them.

The existing execution-release broker remains one Lambda with:

```text
reserved concurrency: 1
timeout: <= 30 seconds
```

as frozen in round 3.

## 1.2 Dispatch lease duration and client bound

The v0.5 dispatch lease is **90 seconds**. It is deliberately longer than the broker's entire maximum Lambda lifetime.

The broker may claim a start-dispatch lease only when its current invocation has at least **15 seconds** of remaining Lambda time. The `StartBuild` SDK/API attempt must use a bounded client attempt/response timeout of **<= 10 seconds**; an invocation does not begin a new `StartBuild` API attempt when less than 15 seconds remain.

Therefore a broker invocation that owned a dispatch lease cannot still be alive and initiate a new external start after that lease becomes reclaimable. A request accepted by AWS before client failure remains covered by R10's native-idempotency/discovery reconciliation path.

## 1.3 Lease claim is the authorization event

Immediately before every initial `StartBuild` call or same-logical-attempt repeat, the broker performs one conditional transaction that requires all R11 authorization predicates plus:

```text
startDispatchState != leased
or previous dispatch lease is already provably stale
```

and atomically writes:

```text
startDispatchEpoch = previous + 1
startDispatchLeaseId = fresh server-generated identity
startDispatchOwnerRequestId = current Lambda request identity
startDispatchClaimedAt = now
startDispatchLeaseExpiresAt = now + 90 seconds
startDispatchState = leased
```

The transaction also rechecks:

```text
ACTIVE_EXECUTION_CANDIDATE.approvalId == candidate approvalId
candidate is not superseded/promoted/failed_locked
component state == starting
component logicalAttemptId == expected logicalAttemptId
component logicalAttemptOrdinal == expected ordinal
component activeBuildId == null
logical attempt has not been terminally classified
```

Only the invocation that owns the exact current `startDispatchLeaseId` may issue the external `StartBuild` request for that attempt.

## 1.4 Transitions blocked by a live dispatch lease

While `startDispatchState == leased` and the lease can still belong to a live broker invocation, **no protected transition may commit that would invalidate the authorization under which the external call is being made**.

This includes:

- classifying the logical attempt `no_start_observed` or otherwise terminal;
- allocating the next logical-attempt ordinal;
- superseding the candidate;
- marking the candidate/component `failed_locked` in a way that would make the current start unauthorized;
- clearing/changing the active-candidate slot;
- resetting/replacing the logical-attempt identity.

A failure discovered elsewhere while a live dispatch lease exists is recorded as pending diagnostic state if needed, but the state transition that invalidates the attempt waits for dispatch reconciliation.

## 1.5 Returned response and ambiguous outcome

If `StartBuild` returns a build ID within the invocation, the broker conditionally records the build only when the same lease/epoch/logical-attempt identity still owns the component, then writes:

```text
activeBuildId = returned build ID
component state = building
startDispatchState = response_recorded
```

If the invocation ends without durably recording a response, the attempt remains `starting` with the dispatch lease metadata. A later broker invocation must not guess whether AWS accepted the call.

Recovery waits until the previous dispatch lease is provably stale, then follows R10 §3 before either repeating the same logical attempt or terminally classifying it.

## 1.6 Recovery after a stale dispatch lease

After the 90-second lease has expired, a new broker invocation first proves that the old owner invocation cannot still be executing under the frozen 30-second Lambda timeout, then performs CodeBuild recovery for the same logical attempt.

Recovery behavior is:

1. inspect the exact protected project with the R10 project-scoped discovery path;
2. if exactly one correlated accepted build exists, persist that build ID and continue reconciliation;
3. if none exists and the native five-minute CodeBuild idempotency window is still valid, a repeat may occur only after claiming a **new dispatch epoch/lease** for the same logical attempt and reusing the same native idempotency token/parameters;
4. if the native idempotency window has expired, perform the R10 final bounded discovery pass before `no_start_observed` can be committed;
5. only after terminal disposition and with no live dispatch lease may a later logical-attempt ordinal be allocated.

A stale dispatch lease is never sufficient by itself to conclude that no build started.

## 1.7 Build-dispatch evidence

P1 must prove at minimum:

- a delayed broker cannot terminalize or advance the attempt while its dispatch lease may still be live;
- another broker invocation cannot claim a second dispatch lease concurrently because reserved concurrency is 1 and the durable lease predicates also reject it;
- candidate supersession/`failed_locked`/active-slot changes cannot invalidate a live dispatch authorization;
- after a broker crash, recovery does not allocate another ordinal until the lease is stale **and** R10 provider reconciliation is complete;
- a same-attempt retry receives a new dispatch epoch but the same CodeBuild native idempotency token;
- a stale invocation cannot initiate a new `StartBuild` after its lease becomes reclaimable because the lease duration exceeds the broker's maximum invocation lifetime and the SDK call has a bounded timeout.

---

# 2. Protected deployment generation and mutation lock — FROZEN

R9/R11 promotion-request binding is extended with one protected singleton deployment-control record:

```text
control key: PROTECTED_EXECUTION_DEPLOYMENT

generation: non-negative integer
mode: PAIR | ABSENT
workerDigest: digest | null
hiddenEvaluatorDigest: digest | null
protectedDeploymentIdentity: bounded exact AWS resource identity

activeMutationPromotionRequestId: string | null
activeMutationAction: APPLY_TARGET | RESTORE_PRIOR | null
activeMutationEpoch: integer
```

For the initial production state before the first execution-tier deployment:

```text
generation = 0
mode = ABSENT
workerDigest = null
hiddenEvaluatorDigest = null
activeMutationPromotionRequestId = null
```

The deployment-control record is protected release state, not an assertion that AWS infrastructure matches it. Every promotion/recovery operation independently reconciles actual infrastructure against it before relying on it.

## 2.1 All steady-state execution-tier mutation uses one controller

Round 11's separate `fpllm-beta-promotion-recover` design and any earlier text granting the human protected-deploy session direct steady-state ASG/launch-template/runtime mutation are superseded.

Use one protected Lambda:

```text
function:              fpllm-beta-promotion-controller
region:                eu-west-1
public Function URL:   disabled
reserved concurrency: 1
timeout:                <= 30 seconds
```

The non-GitHub federated role `fpllm-beta-protected-deploy` becomes an **operator/invoker role**, not a generic infrastructure-mutation role.

It may invoke only the exact promotion-controller Lambda and read the bounded release/audit state required for operator diagnostics. It receives no direct steady-state authority to:

```text
create/modify launch-template versions
change ASG launch-template/runtime selection
start/cancel instance refresh
write protected runtime digest/config values
invoke arbitrary CloudFormation stack updates
pass the controller service role
select/push ECR image digests
write release-control DynamoDB state directly
```

The controller's Lambda service role is the only normal v0.5 principal with the exact protected worker/evaluator deployment-mutation permissions. That service role is assumable only by the Lambda service for this function and is not assumable by GitHub or the human federated operator.

CDK/provisioning may create the protected resources and controller during P1, but the ordinary GitHub OIDC/CDK release role remains unable to mutate the protected execution tier after provisioning, consistent with rounds 3–5.

## 2.2 Controller input is non-authoritative

The controller accepts only:

```json
{
  "promotionRequestId": "opaque-existing-or-first-use-id",
  "action": "APPLY_TARGET | RESTORE_PRIOR | RECONCILE"
}
```

Maximum decoded body: **4 KiB**. Unknown fields are rejected.

The caller cannot supply:

```text
approvalId
digest or tag
launch-template ID/version
ASG name
runtime/evaluator config
previous state
generation
CloudFormation parameters
provider operation IDs
```

Every authoritative value is resolved from the protected active-candidate, candidate, promotion-request, and deployment-control records.

---

# 3. Promotion claim binds the prior snapshot to generation g

`APPLY_TARGET` on a fresh `promotionRequestId` performs the R9 first-use claim through the controller.

## 3.1 Reconcile before claim

Before the claim transaction, the controller reads `PROTECTED_EXECUTION_DEPLOYMENT` at generation `g` and independently inspects the exact protected AWS execution-tier resources.

Claim does not proceed unless actual infrastructure exactly matches the control record's current state:

- for `PAIR`: exact worker digest, hidden-evaluator digest, launch/runtime identity, and expected protected resource identity all match;
- for `ABSENT`: no production worker execution tier is active, no candidate digest is selected in protected runtime configuration, and the recorded absent/disabled identity matches.

If actual state is mixed, unknown, or drifted, promotion stops before claim/mutation.

## 3.2 Atomic claim and mutation ownership

The first-use transaction requires:

```text
ACTIVE_EXECUTION_CANDIDATE.approvalId == candidate approvalId
candidate overall state == built
candidate promotion state == not_promoted
candidate activePromotionRequestId == null
canonical worker/evaluator/base digests are non-null
PROTECTED_EXECUTION_DEPLOYMENT.generation == g
PROTECTED_EXECUTION_DEPLOYMENT.activeMutationPromotionRequestId == null
```

and atomically:

1. creates `PROMOTION_REQUEST#<promotionRequestId>` bound to the candidate/canonical target digest snapshot;
2. records the exact reconciled prior `PAIR` or `ABSENT` state plus `previousDeploymentGeneration = g` and `previousProtectedDeploymentIdentity`;
3. records the prior rollback image availability proof when prior mode is `PAIR`;
4. writes `candidate promotion state = promoting` and `candidate activePromotionRequestId = promotionRequestId`;
5. writes `PROTECTED_EXECUTION_DEPLOYMENT.activeMutationPromotionRequestId = promotionRequestId`;
6. writes `activeMutationAction = APPLY_TARGET` and increments `activeMutationEpoch`.

The deployment generation itself remains `g` until one bound state is conclusively verified and terminalized.

Once this transaction commits, no other normal protected execution-tier mutation can claim the singleton until this promotion reaches a terminal target/rollback state.

## 3.3 Final drift fence before provider mutation

Immediately before issuing the first protected provider mutation for `APPLY_TARGET`, the controller rechecks all of:

```text
PROMOTION_REQUEST is bound to promotionRequestId/approval/target snapshot
candidate activePromotionRequestId == promotionRequestId
PROTECTED_EXECUTION_DEPLOYMENT.generation == previousDeploymentGeneration
PROTECTED_EXECUTION_DEPLOYMENT.activeMutationPromotionRequestId == promotionRequestId
activeMutationAction == APPLY_TARGET
actual AWS deployment still exactly equals the recorded prior PAIR/ABSENT state
```

If any check fails, **no target mutation is issued**.

Because the human operator and all other steady-state principals have no direct protected mutation authority, this singleton claim plus the controller's reserved concurrency serializes the normal observe/claim/apply interval. A break-glass mutation is not a competing release path; if an audited incident action changes infrastructure, the controller detects drift and fails closed until the incident is reconciled.

---

# 4. Controller mutation semantics

The controller may mutate only the exact protected resources frozen for the worker execution tier. It constructs provider requests from code plus protected state; caller input never supplies provider parameters.

The controller may perform bounded operations such as creating/selecting the exact launch-template/runtime configuration for the bound state and starting/observing the exact worker replacement/refresh. Long-running convergence is not waited synchronously inside one Lambda invocation: provider operation identities are recorded in protected state and later `RECONCILE` calls continue verification.

The controller receives no authority to:

- push/overwrite ECR images;
- read private evaluator S3/KMS source material;
- start/update CodeBuild projects;
- mutate web/ECS/RDS learner evidence resources;
- choose a digest other than the bound target or recorded prior state;
- mutate a promotion request other than the singleton active mutation it currently owns.

## 4.1 APPLY_TARGET

`APPLY_TARGET` may select only:

```text
PROMOTION_REQUEST targetWorkerDigest
PROMOTION_REQUEST targetHiddenEvaluatorDigest
```

plus the already-bound protected runtime/evaluator-base identities required by the frozen deployment contract.

Replays are idempotent: if the exact target operation is already applying, the controller reconciles/continues that operation rather than creating a different target.

## 4.2 RESTORE_PRIOR

`RESTORE_PRIOR` is valid only for the same active promotion request after a failed/ambiguous target application or failed smoke/reconciliation.

It may restore only:

- the exact recorded prior worker/evaluator pair when `previousDeploymentMode == PAIR`; or
- the exact recorded absent/disabled execution-tier state when `previousDeploymentMode == ABSENT`.

Before mutation, the controller conditionally changes `activeMutationAction` to `RESTORE_PRIOR` while retaining the same promotion-request lock/generation. It cannot substitute a third state.

## 4.3 RECONCILE

`RECONCILE` performs no new infrastructure mutation. It reads actual protected infrastructure plus any retained provider operation identities and compares them to the request's two permitted bound states.

If actual state matches neither target nor prior state completely, no terminal release-control transition occurs.

---

# 5. Terminal generation transactions

A promotion request retains exclusive mutation ownership until one of the following transactions commits.

## 5.1 Verified target

After actual infrastructure and required smoke/compatibility checks prove the exact target state, one transaction requires the same active request/lock and `generation == previousDeploymentGeneration`, then writes:

```text
candidate overall state = promoted
candidate promotion state = promoted
candidate promotedAt = server timestamp
candidate activePromotionRequestId = null
PROMOTION_REQUEST disposition = promoted
PROMOTION_REQUEST lastReconciledAt = server timestamp

PROTECTED_EXECUTION_DEPLOYMENT.generation = previousDeploymentGeneration + 1
PROTECTED_EXECUTION_DEPLOYMENT.mode = PAIR
PROTECTED_EXECUTION_DEPLOYMENT.workerDigest = targetWorkerDigest
PROTECTED_EXECUTION_DEPLOYMENT.hiddenEvaluatorDigest = targetHiddenEvaluatorDigest
PROTECTED_EXECUTION_DEPLOYMENT.protectedDeploymentIdentity = verified target identity
PROTECTED_EXECUTION_DEPLOYMENT.activeMutationPromotionRequestId = null
PROTECTED_EXECUTION_DEPLOYMENT.activeMutationAction = null

ACTIVE_EXECUTION_CANDIDATE.approvalId = null
```

## 5.2 Verified prior state / rollback

After actual infrastructure and rollback smoke/compatibility checks prove the exact recorded prior `PAIR` or `ABSENT` state, one transaction requires the same active request/lock and `generation == previousDeploymentGeneration`, then writes:

```text
candidate overall state = built
candidate promotion state = not_promoted
candidate activePromotionRequestId = null
PROMOTION_REQUEST disposition = rolled_back
PROMOTION_REQUEST lastReconciledAt = server timestamp

PROTECTED_EXECUTION_DEPLOYMENT.generation = previousDeploymentGeneration + 1
PROTECTED_EXECUTION_DEPLOYMENT.mode/digests/identity = verified recorded prior state
PROTECTED_EXECUTION_DEPLOYMENT.activeMutationPromotionRequestId = null
PROTECTED_EXECUTION_DEPLOYMENT.activeMutationAction = null

ACTIVE_EXECUTION_CANDIDATE.approvalId = bound approvalId
```

Generation increments even when the semantic state returns to the prior deployment. This prevents a later request from confusing the restored state with the pre-attempt generation.

The rolled-back promotion request remains terminal. Any later promotion attempt uses a new `promotionRequestId` and snapshots the newly incremented generation.

---

# 6. Uncertain/partial infrastructure state

If provider calls return ambiguously, convergence is partial, actual identity is mixed/unknown, or required smoke fails before a safe target/prior terminal state is proven:

```text
PROMOTION_REQUEST disposition = failed_requires_operator
candidate promotion state = failed_requires_operator
candidate activePromotionRequestId = promotionRequestId
PROTECTED_EXECUTION_DEPLOYMENT.activeMutationPromotionRequestId = promotionRequestId
ACTIVE_EXECUTION_CANDIDATE remains occupied by the bound approval
```

The deployment generation remains the request's `previousDeploymentGeneration`; the active mutation lock remains occupied.

Recovery uses only the **same promotion controller**:

- `APPLY_TARGET` to converge toward the already-recorded target;
- `RESTORE_PRIOR` to converge toward the already-recorded prior `PAIR`/`ABSENT` state;
- `RECONCILE` to verify/terminalize when the infrastructure already equals one permitted state.

The operator cannot directly mutate protected infrastructure and cannot ask the controller for a third state.

If a true break-glass incident requires a third state or architectural change, the normal release controller remains locked/fail-closed and the incident/change must be separately documented and reconciled before another production release. Break-glass authority is not granted to GitHub and is not part of routine promotion.

---

# 7. Audit and authority separation

CloudTrail data events are enabled for the exact promotion-controller Lambda `Invoke` ARN.

The retained promotion evidence binds at minimum:

```text
promotionRequestId
bound approvalId
target canonical digest state
previousDeploymentGeneration
recorded prior PAIR/ABSENT state
activeMutationEpoch/action
controller invocation request identity/timestamps
provider mutation/refresh identities
actual deployment identity observed during reconciliation
CloudTrail authenticated protected-deploy operator session
terminal generation transaction outcome
```

Caller-supplied actor strings are not authoritative.

The v0.5 authority split after this correction is:

```text
GitHub OIDC release authority
    -> no protected execution-tier build or deployment mutation

sensitive release approver
    -> admission mediator only; no protected build/deploy mutation

execution-release broker
    -> protected build start/reconciliation only; no deployment promotion

fpllm-beta-protected-deploy federated operator
    -> invoke exact promotion controller only; no direct protected infrastructure mutation

fpllm-beta-promotion-controller service role
    -> exact protected deployment mutation/reconciliation + conditional release-control transitions
```

---

# 8. Required P1 evidence additions

P1 must retain evidence that:

1. start-dispatch lease duration exceeds the broker Lambda lifetime and API-attempt timeout;
2. a live dispatch lease blocks logical-attempt terminalization, next-ordinal allocation, supersession, active-slot change, and candidate-invalidating failure transition;
3. a crashed dispatch owner is reconciled through CodeBuild discovery before a repeat or terminal `no_start_observed` decision;
4. a same-logical-attempt repeat uses a fresh dispatch epoch/lease and the same native CodeBuild idempotency token;
5. the protected-deploy federated operator cannot directly call the protected ASG/launch-template/runtime mutation APIs, arbitrary CloudFormation update paths, or write release-control state;
6. GitHub, web, worker, builders, approver, and ordinary CDK roles cannot invoke or mutate the promotion controller/service role;
7. the promotion controller accepts no caller-supplied digests/generation/provider parameters;
8. first-use promotion claim reconciles actual infrastructure, snapshots exact prior `PAIR`/`ABSENT` state, and atomically claims generation `g` before mutation;
9. provider mutation fails if actual state drifts from the recorded prior state after claim;
10. two promotion requests cannot own the deployment singleton concurrently;
11. normal target application can select only the bound canonical target state;
12. recovery mutation can select only the bound target or exact recorded prior state;
13. a third digest/state submitted by an operator is impossible at the controller schema and IAM layers;
14. partial/unknown infrastructure keeps the mutation lock and active candidate occupied;
15. successful target verification increments generation, records exact target identity, and clears both mutation/active-candidate locks atomically;
16. verified rollback increments generation, records the exact prior `PAIR`/`ABSENT` identity, clears only the mutation lock, and leaves the candidate active/built for a deliberate later action;
17. controller invocation and terminal outcomes are attributable to the non-GitHub federated operator through CloudTrail without storing private evaluator contents.

---

# 9. Review-state boundary

Round 12 closes CXR12-01, CXR12-02, and CXR12-03 at the decision/specification level. It does not claim dispatch leases, deployment generations, IAM removals, the promotion controller, protected infrastructure mutations, CloudTrail data events, or production AWS evidence are implemented.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

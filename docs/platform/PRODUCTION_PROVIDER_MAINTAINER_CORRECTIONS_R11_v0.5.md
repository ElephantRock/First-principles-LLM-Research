# Platform v0.5 — Maintainer Corrections Round 11 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Codex review baseline:** `65bb2d3824623766814a2a244a7e96a30ef1076d`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and findings disposition

The fresh exact-HEAD Codex review of `65bb2d3824623766814a2a244a7e96a30ef1076d` found two remaining release-control gaps:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| CXR11-01 | P1 | Round 7 supersession rejected `running/building` and non-null `activeBuildId`, but round 10 added an earlier `starting` state with an unresolved logical attempt and null build ID. A supersede-and-admit race could therefore replace the active candidate after a build attempt was reserved but before `StartBuild` returned. | Treat every unresolved logical attempt, including `starting`, as active for supersession; prohibit supersession while any component owns such an attempt; and revalidate active-candidate/attempt identity immediately before every external `StartBuild` call or same-attempt retry. |
| CXR11-02 | P1 | Round 9's `failed_requires_operator` promotion state occupied the active slot but supplied no authorized transition out of that state. New promotion and supersession were both blocked, so P1 would have to invent a direct state mutation. | Freeze one protected promotion-recovery mediator, capture the pre-promotion production pair before mutation, permit only bounded target-reconcile or exact-prior-pair rollback recovery, and make the mediator the only authority that can terminalize `failed_requires_operator`. |

Precedence inside the P0 record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R11_v0.5.md
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

# 1. Supersession treats a reserved logical attempt as active

Round 7 §1.2 is superseded where it defines the preconditions for `supersede-and-admit`.

A candidate may be superseded only if **every** protected component satisfies all of:

```text
component state not in {starting, building}
logicalAttemptId == null OR logical attempt is durably terminal/reconciled
activeBuildId == null
no unresolved build-result receipt/reconciliation exists for the component
```

For this rule, an unresolved round-10 logical attempt is active work even if CodeBuild has not yet returned a build ID.

Therefore a component in:

```text
state = starting
logicalAttemptId != null
activeBuildId = null
```

**blocks supersession**. The active candidate remains in the singleton slot until the attempt is reconciled to a terminal state.

The supersession transaction also rechecks that:

```text
ACTIVE_EXECUTION_CANDIDATE.approvalId == supersedesApprovalId
candidate promotion state == not_promoted
candidate overall state is not promoted/superseded
```

and that all component attempt predicates above are still true in the same transaction.

---

# 2. StartBuild requires a final active-candidate authorization check

Round 10 is tightened so every initial `StartBuild` call and every same-logical-attempt retry performs a final durable authorization check **after** logical-attempt reservation/recovery and immediately before the external CodeBuild API call.

The broker conditionally verifies:

```text
ACTIVE_EXECUTION_CANDIDATE.approvalId == candidate approvalId
candidate is not superseded/promoted/failed_locked
component state == starting
component logicalAttemptId == expected logicalAttemptId
component logicalAttemptOrdinal == expected ordinal
component activeBuildId == null
logical attempt has not been terminally classified
```

The external `StartBuild` call may proceed only when that check succeeds.

A concurrent supersession cannot pass while the same unresolved attempt exists because §1 now treats that attempt as active. Conversely, if the active slot changed before this check, the broker must not call CodeBuild.

The same rule applies when repeating `StartBuild` inside CodeBuild's native idempotency-token window: the broker cannot use the old logical attempt after the candidate ceases to be active.

P1 must exercise the race:

```text
reserve logical attempt
-> pause broker before StartBuild
-> attempt supersede-and-admit
```

and prove that supersession is rejected and only one candidate/build lineage remains authoritative.

---

# 3. Promotion claim records the exact prior production pair

Round 9's immutable promotion-request record is extended. At the first successful promotion claim, before any infrastructure mutation, the protected promotion path records both the target canonical pair and the exact pre-promotion production identity:

```text
PROMOTION_REQUEST#<promotionRequestId>
  approvalId
  platformSourceSha
  targetWorkerDigest
  targetHiddenEvaluatorDigest
  targetEvaluatorBaseDigest

  previousWorkerDigest
  previousHiddenEvaluatorDigest
  previousProtectedDeploymentIdentity

  createdAt
  disposition
  lastReconciledAt
```

The previous pair must come from the protected production deployment state that the promotion path has just reconciled, not from caller-supplied digest values.

If the existing production identity cannot be established before mutation, promotion does not begin.

The previous pair is immutable for the promotion request and is the only rollback target authorized by the recovery path below.

---

# 4. Protected promotion-recovery mediator — FROZEN

Add one protected Lambda in `eu-west-1`:

```text
function:              fpllm-beta-promotion-recover
public Function URL:    disabled
reserved concurrency:  1
timeout:                <= 30 seconds
```

Only the non-GitHub federated `fpllm-beta-protected-deploy` operator may invoke this function. GitHub OIDC/deploy roles, web, worker, builders, admission approver, and release-material publisher receive no invoke authority.

The recovery Lambda is part of the protected execution/sensitive-release stack and cannot be mutated by the ordinary GitHub OIDC/CDK path.

It accepts only a bounded schema:

```json
{
  "promotionRequestId": "opaque-existing-id",
  "recoveryAction": "RECONCILE_TARGET | CONFIRM_ROLLBACK"
}
```

Maximum decoded body: **4 KiB**. Unknown fields are rejected. No digest, approval ID, launch-template value, image tag, or arbitrary infrastructure identity is accepted from the caller.

The function resolves every authoritative value from protected release-control state.

---

# 5. Recovery authority and actual-infrastructure verification

The recovery mediator has:

- read access to only the protected promotion/candidate/control records required for the bound promotion request;
- read-only AWS control-plane authority required to inspect the exact worker ASG/launch-template/runtime configuration and determine the currently deployed worker + hidden-evaluator immutable identities;
- conditional write authority only for the recovery transitions in §§6–7;
- no private evaluator S3/KMS read authority;
- no ECR image-content read authority;
- no CodeBuild start/update authority;
- no authority to choose or deploy arbitrary image digests;
- no protected infrastructure mutation authority.

The `fpllm-beta-protected-deploy` role remains the only steady-state authority that may apply the already-frozen protected infrastructure promotion/rollback mutation. For recovery it may deploy only one of two immutable pairs already present in the bound promotion record:

```text
target pair   = targetWorkerDigest + targetHiddenEvaluatorDigest
prior pair    = previousWorkerDigest + previousHiddenEvaluatorDigest
```

It may not substitute a third pair under that recovery request.

After the operator has reconciled or restored infrastructure, it invokes the mediator. The mediator independently reads actual deployed identity before changing release-control state.

---

# 6. RECONCILE_TARGET terminal transition

`RECONCILE_TARGET` is valid only when:

```text
candidate promotion state == failed_requires_operator
candidate activePromotionRequestId == promotionRequestId
PROMOTION_REQUEST disposition == failed_requires_operator
bound approval/canonical target digests still match candidate state
ACTIVE_EXECUTION_CANDIDATE.approvalId == bound approvalId
```

The mediator independently verifies that actual protected production infrastructure is fully and consistently running the request's recorded **target** worker/evaluator pair and that the frozen promotion smoke/compatibility conditions have been re-established.

If and only if target identity is proven, one conditional transaction writes:

```text
candidate overall state = promoted
candidate promotion state = promoted
candidate promotedAt = server timestamp
candidate activePromotionRequestId = null
PROMOTION_REQUEST disposition = promoted
PROMOTION_REQUEST lastReconciledAt = server timestamp
ACTIVE_EXECUTION_CANDIDATE.approvalId = null
```

A later replay of the same recovery request returns the existing promoted disposition and cannot act on another candidate.

---

# 7. CONFIRM_ROLLBACK terminal transition

`CONFIRM_ROLLBACK` is valid under the same bound failed-recovery predicates as §6, but the mediator must independently verify that actual protected production infrastructure has been restored to the immutable **previous** worker/evaluator pair recorded before promotion began.

If and only if rollback identity and required rollback smoke/compatibility checks are proven, one conditional transaction writes:

```text
candidate overall state = built
candidate promotion state = not_promoted
candidate activePromotionRequestId = null
PROMOTION_REQUEST disposition = rolled_back
PROMOTION_REQUEST lastReconciledAt = server timestamp
ACTIVE_EXECUTION_CANDIDATE.approvalId = bound approvalId
```

The rolled-back promotion request remains terminal. A deliberate future promotion attempt for this still-built candidate requires a new `promotionRequestId` under round 9.

Because the active slot remains bound to the candidate after verified rollback, no unrelated candidate can become active until normal supersession or a later successful promotion follows the frozen rules.

---

# 8. Recovery failure behavior

If actual infrastructure is:

- partially target and partially prior;
- running any unrecorded/third digest;
- not queryable sufficiently to prove one complete pair;
- inconsistent with the bound protected deployment identity;
- failing required recovery smoke/compatibility checks;

then the mediator performs **no release-control state transition**. The candidate remains `failed_requires_operator`, the request remains bound, and the active slot remains occupied.

The operator may correct infrastructure only toward the already-recorded target or prior pair, then retry the mediator with the same recovery action. No direct DynamoDB mutation is an authorized recovery procedure.

If recovery requires a different image pair or architectural change, stop and create a documented protected incident/change path; do not weaken this P0 contract silently.

---

# 9. Audit and idempotency

CloudTrail data events are enabled for the exact recovery Lambda `Invoke` ARN, following the admission-audit pattern already frozen in round 7.

The recovery evidence package binds:

```text
promotionRequestId
bound approvalId
target pair
previous pair
recovery action
actual deployment identity observed
recovery Lambda request identity/timestamp
CloudTrail authenticated operator session
terminal transaction outcome
```

Caller-supplied actor strings are not authoritative.

Concurrent recovery invocations are serialized by conditional state checks and reserved concurrency. At most one terminal transaction can commit.

---

# 10. Required P1 evidence additions

P1 must retain evidence that:

1. `starting` or any unresolved logical attempt blocks supersession;
2. the reserve-attempt / supersede race cannot move the active slot before the attempt is terminal;
3. every initial or repeated `StartBuild` revalidates active candidate + logical attempt immediately before the external call;
4. a broker call for a no-longer-active candidate cannot start CodeBuild;
5. promotion claim captures the exact prior deployed worker/evaluator identity before mutation;
6. GitHub and all non-protected principals cannot invoke `fpllm-beta-promotion-recover`;
7. recovery mediator cannot mutate infrastructure, read private evaluator bytes, or select arbitrary digests;
8. protected-deploy recovery can target only the recorded target or prior pair;
9. `RECONCILE_TARGET` succeeds only after actual infrastructure equals the recorded target pair and clears the active slot atomically;
10. `CONFIRM_ROLLBACK` succeeds only after actual infrastructure equals the recorded prior pair and returns the candidate to built/not-promoted while retaining the active slot;
11. mixed/unknown/third-digest infrastructure fails closed with no state mutation;
12. a terminal recovery replay is idempotent and cannot migrate to another approval;
13. CloudTrail evidence identifies the federated recovery operator separately from GitHub release authority.

---

# 11. Review-state boundary

Round 11 closes CXR11-01 and CXR11-02 at the decision/specification level. It does not claim supersession-race guards, pre-StartBuild checks, prior-pair capture, the recovery Lambda, infrastructure reconciliation, or production AWS evidence are implemented.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

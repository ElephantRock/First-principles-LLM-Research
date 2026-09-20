# Platform v0.5 — Maintainer Corrections Round 13 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `e938fe5d4333f1ea721a118d6d3727dc1c06f8fb`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and maintainer findings

The fresh maintainer re-review of the round-12 candidate found four issues that should be closed before asking Codex for another independent pass:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR13-01 | HIGH | R12 made the promotion controller the sole mutation principal, but its own provider mutation still had an accepted-but-unrecorded response gap: it said provider operation IDs were recorded after calls without freezing how a crash between acceptance and persistence is recovered. | Freeze an exact desired-state mutation protocol using immutable launch-template versions, deterministic EC2 idempotency for launch-template creation, reconciliable `UpdateAutoScalingGroup`, and a termination request bound to one pre-recorded instance ID. Every external step has a durable intent before the call and is reconciled from AWS state before repeat. |
| FPR13-02 | HIGH | R12 allowed both `APPLY_TARGET` and `RESTORE_PRIOR` during uncertain recovery but did not make the recovery choice monotonic. An operator could oscillate between target and prior under one promotion request. | Freeze a monotonic mutation phase machine. Target convergence may continue until rollback is selected; once `RESTORE_PRIOR` is claimed, the request can only continue/reconcile prior-state restoration and can never return to target under that promotion request. |
| FPR13-03 | HIGH | R12 correctly made the routine protected-deploy role invoke-only, but earlier protected-stack change procedure still needs an authority capable of creating/updating the controller, its IAM role, and protected stack. Leaving that implicit makes future maintenance either impossible or an undocumented privilege bypass. | Freeze a separate non-GitHub `fpllm-beta-protected-stack-admin` role as an explicit high-privilege TCB used only for reviewed protected-stack changes, not routine release/promotion. Its use is source/change-set bound and audited. The routine protected-deploy operator remains invoke-only. |
| FPR13-04 | MEDIUM | R11/R12 introduced the first-release `ABSENT` state without reconciling it precisely with the frozen steady-state worker ASG `1/1/1` contract. | Freeze the P1 bootstrap state as the already-created protected ASG at `min=0, desired=0, max=1`, no worker instance and no selected candidate runtime. The first successful promotion changes it to the steady-state `1/1/1`; rollback of the first failed promotion restores exactly the bootstrap `ABSENT` state. |

Precedence inside the P0 record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R13_v0.5.md
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

# 1. Exact protected worker deployment primitive — FROZEN

Round 12's generic references to a worker replacement/refresh are superseded by this exact v0.5 mutation protocol. The operating worker topology remains one On-Demand `m7i.xlarge` in an ASG with no overlap replacement under the frozen default quota envelope.

The protected worker ASG uses one fixed protected launch template. Production selection always names an **explicit numeric launch-template version**; `$Latest` and `$Default` are prohibited release identities.

A launch-template version contains the immutable runtime/bootstrap configuration required to run the exact bound:

```text
worker image digest
hidden-evaluator image digest
test-runtime identity required by the frozen compatibility contract
worker bootstrap/runtime configuration identity
```

No private evaluator source bytes or runtime secrets are embedded in launch-template user data. Runtime secrets continue to come from the already-frozen IAM/Secrets Manager path.

The normal protected promotion controller receives only the minimum EC2/Auto Scaling permissions required for the exact launch template and ASG. It does not receive generic CloudFormation update authority.

Official provider basis at this correction:

- EC2 `CreateLaunchTemplateVersion` supports a caller-supplied `ClientToken` for request idempotency: https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateLaunchTemplateVersion.html
- Auto Scaling `UpdateAutoScalingGroup` applies an explicit launch-template version and its resulting group state is readable through `DescribeAutoScalingGroups`: https://docs.aws.amazon.com/autoscaling/ec2/APIReference/API_UpdateAutoScalingGroup.html
- `TerminateInstanceInAutoScalingGroup` terminates one specified instance and, with `ShouldDecrementDesiredCapacity=false`, causes Auto Scaling to launch a replacement: https://docs.aws.amazon.com/autoscaling/ec2/APIReference/API_TerminateInstanceInAutoScalingGroup.html
- `DescribeAutoScalingGroups` exposes the selected launch template/version and current instance membership: https://docs.aws.amazon.com/autoscaling/ec2/APIReference/API_DescribeAutoScalingGroups.html

`StartInstanceRefresh` is **not** part of the v0.5 protected worker promotion protocol. The frozen single-worker/quota model intentionally uses drain -> exact group desired-state update -> terminate the recorded old instance -> replacement.

---

# 2. Bootstrap `ABSENT` state versus steady-state `PAIR`

The protected execution stack is provisioned before the first execution-tier promotion, but the first release begins from a non-serving bootstrap state.

## 2.1 Initial P1 bootstrap state

The exact initial `PROTECTED_EXECUTION_DEPLOYMENT` state is:

```text
generation = 0
mode = ABSENT
workerDigest = null
hiddenEvaluatorDigest = null
activeMutationPromotionRequestId = null
```

The corresponding protected AWS state is:

```text
worker ASG exists
min size = 0
desired capacity = 0
max size = 1
no EC2 worker instance belongs to the group
no candidate worker/evaluator digest is selected as production runtime
launch template/resource identities are the fixed protected bootstrap identities
```

This `0/0/1` setting is a **bootstrap-only exception** before the first successful protected execution-tier promotion and the exact rollback target for a failed first promotion. It is not an operating beta configuration.

## 2.2 Steady-state production state

A successfully promoted `PAIR` has:

```text
worker ASG min = 1
desired = 1
max = 1
exact numeric launch-template version selected
one healthy worker instance running that exact version
runtime worker/evaluator digests equal the protected deployment record
```

Thus the original frozen `1/1/1` worker requirement remains the steady-state production contract. Worker scale-to-zero during a later announced beta pause remains governed by the earlier explicit pause rule and is not silently treated as the initial `ABSENT` release state.

---

# 3. Durable promotion mutation journal — RESERVED BEFORE EVERY EXTERNAL STEP

The round-12 deployment singleton and promotion request are extended with a mutation journal. The controller conditionally reserves each next external provider step **before** making that call.

Each promotion request stores at minimum:

```text
mutationPhase
mutationStepOrdinal
mutationStepId
mutationStepState          # reserved | response_recorded | reconciled
mutationStepCreatedAt
mutationStepLastCheckedAt

selectedLaunchTemplateId
selectedLaunchTemplateVersion
launchTemplateClientToken

sourceInstanceId           # exact instance allowed to be terminated | null
terminationActivityId      # if returned | null

lastObservedAsgIdentity
lastObservedInstanceId
```

All fields are controller-owned protected state. Caller input cannot set or replace them.

A new mutation step may not be reserved while the preceding step is unresolved. A lost provider response is therefore recovered against the same step; it is never treated as permission to allocate an unrelated next action.

---

# 4. Monotonic mutation phase machine

The promotion request uses the following coarse phases:

```text
CLAIMED_TARGET
TARGET_TEMPLATE_READY
TARGET_GROUP_CONFIGURED
TARGET_SOURCE_DRAINED
TARGET_SOURCE_TERMINATION_REQUESTED
TARGET_REPLACEMENT_OBSERVED
TARGET_SMOKE

ROLLBACK_CLAIMED
PRIOR_TEMPLATE_READY
PRIOR_GROUP_CONFIGURED
PRIOR_SOURCE_DRAINED
PRIOR_SOURCE_TERMINATION_REQUESTED
PRIOR_REPLACEMENT_OBSERVED
PRIOR_SMOKE

TERMINAL_PROMOTED
TERMINAL_ROLLED_BACK
FAILED_REQUIRES_OPERATOR
```

The exact low-level journal step may be more granular in implementation, but it cannot weaken these monotonic transitions.

## 4.1 Target side

`APPLY_TARGET` may initialize a fresh request or continue a request whose mutation direction is still target. Repeated calls reconcile/continue the same target intent.

A target-side failure may enter `FAILED_REQUIRES_OPERATOR` while retaining `recoveryDirection = TARGET_UNDECIDED`.

From that state, the operator may either:

- invoke `APPLY_TARGET` to continue convergence toward the same recorded target; or
- invoke `RESTORE_PRIOR` once to atomically claim rollback.

## 4.2 Rollback is a one-way choice

The first valid `RESTORE_PRIOR` call conditionally writes:

```text
recoveryDirection = PRIOR
mutationPhase = ROLLBACK_CLAIMED
activeMutationAction = RESTORE_PRIOR
```

while retaining the same promotion request, deployment generation, and singleton lock.

After `recoveryDirection = PRIOR`, **`APPLY_TARGET` is permanently rejected for that promotion request**. Only `RESTORE_PRIOR` and non-mutating `RECONCILE` may continue.

Therefore one request cannot oscillate target -> prior -> target. If a later deliberate release wants the former target again after verified rollback, it uses a new `promotionRequestId` under the ordinary rules.

---

# 5. Exact target/prior mutation steps and crash recovery

The protocol below applies in the target direction and symmetrically in prior-state restoration. Every step is bound to the same promotion request, deployment generation, mutation lock, direction, and exact state digest set.

## 5.1 Reconcile before every provider call

Before an external provider call, the controller:

1. reads the current protected journal step;
2. reads actual ASG/launch-template/instance state;
3. determines whether that step has already taken effect;
4. if already effective, records it reconciled without repeating a destructive call;
5. otherwise conditionally reserves or confirms the exact same step and only then issues the provider call.

A response timeout/crash never causes the controller to advance merely because no provider operation ID was persisted.

## 5.2 Immutable launch-template version

For each bound target or prior `PAIR` state, the controller derives a deterministic client token from immutable protected values including:

```text
promotionRequestId
previousDeploymentGeneration
mutation direction
bound worker/evaluator digest state
```

The exact token is stored before the call.

`CreateLaunchTemplateVersion` uses that stored `ClientToken` and a deterministic version description/correlation value. A retry uses the same token and identical request parameters. Changed parameters under the same logical step are forbidden.

After return or recovery, the controller records/reconciles one exact numeric launch-template version and verifies its immutable data equals the bound state before continuing.

The controller never selects `$Latest` or `$Default`.

Prior launch-template versions and required prior ECR image digests may not be deleted while a promotion request still has rollback authority over them.

## 5.3 Configure ASG desired state

For target `PAIR`, the desired ASG control state is:

```text
LaunchTemplate = exact target numeric version
min = 1
desired = 1
max = 1
```

For prior `PAIR`, it is the exact recorded prior numeric launch-template version plus `1/1/1`.

For prior `ABSENT`, it is the fixed bootstrap ASG identity at:

```text
min = 0
desired = 0
max = 1
```

with no selected production candidate runtime.

`UpdateAutoScalingGroup` is treated as a desired-state operation, not evidence by response alone. After any response or timeout, the controller calls `DescribeAutoScalingGroups` and advances only when the exact launch-template version and capacity values equal the intended state.

Repeating `UpdateAutoScalingGroup` is permitted only with the same protected desired-state values for the same unresolved journal step. The controller never changes an unrelated ASG property during promotion.

## 5.4 Drain and bind the exact source instance

For a `PAIR -> PAIR` transition, after group configuration is set to the new numeric launch-template version, the currently serving **old** instance is placed through the already-frozen worker drain procedure.

The controller does not terminate until durable product/runtime evidence proves:

```text
worker no longer leases new jobs
no active learner execution remains on that instance
queued work remains durable/retryable
```

The controller then records exactly one `sourceInstanceId` from the protected ASG membership before any termination call.

For an `ABSENT -> PAIR` first promotion there is no source instance to drain/terminate; raising desired capacity to 1 creates the first worker from the selected target version.

For `PAIR -> ABSENT`, the serving instance is drained and recorded before desired capacity is reduced to 0; terminal rollback requires that no worker instance remains.

## 5.5 Terminate only the recorded old instance

For `PAIR -> PAIR`, the controller calls:

```text
TerminateInstanceInAutoScalingGroup(
  InstanceId = recorded sourceInstanceId,
  ShouldDecrementDesiredCapacity = false
)
```

The exact source instance ID is immutable for that termination journal step.

If the call returns an activity ID, it is recorded conditionally. If the response is lost or the controller crashes, recovery **never chooses the replacement instance**. It first describes the ASG/EC2 state for the recorded old ID:

- if that exact old ID is absent/terminating/terminated, the termination step is treated as accepted/in progress and no second instance is selected;
- if that exact old ID remains the serving member and no termination activity/state is visible, the same termination request may be retried only against that same instance ID;
- a replacement instance ID is never substituted into the existing termination step.

Because ASG max remains 1, this implements the already-accepted terminate-then-launch replacement behavior without overlapping two `m7i.xlarge` workers.

For `PAIR -> ABSENT`, reducing desired/min to zero is the termination mechanism; the controller verifies the recorded old instance leaves the group and no replacement appears before advancing.

## 5.6 Observe replacement and exact identity

A `PAIR` direction advances only after `DescribeAutoScalingGroups` and EC2/runtime checks prove one healthy replacement instance:

```text
belongs to the exact protected ASG
uses the selected numeric launch-template version
booted from the frozen AMI/bootstrap identity
runs the exact bound worker digest
supplies the exact bound hidden-evaluator digest to the worker runtime
passes worker/gVisor/runtime preflight
```

The previous instance must no longer be serving.

Only then may compatibility/smoke checks run and the round-12 terminal generation transaction commit.

---

# 6. Provider-operation ambiguity never authorizes a different state

If any external mutation is accepted but its response is lost, actual AWS state is authoritative for reconciliation. The controller remains bound to the current journal step and one of the promotion request's two allowed states.

It may not respond to ambiguity by:

- creating an unrelated launch-template version with changed data;
- selecting `$Latest`/`$Default`;
- terminating an unrecorded replacement instance;
- changing desired capacity outside the exact target/prior/bootstrap value;
- clearing the deployment mutation lock;
- advancing the deployment generation;
- switching from prior restoration back to target.

If actual state cannot be classified safely, the request stays `FAILED_REQUIRES_OPERATOR` with its mutation lock and journal intact. Recovery continues through the same controller and journal.

---

# 7. Protected-stack administrative authority — EXPLICIT HIGH-PRIVILEGE TCB

Round 12 remains authoritative that `fpllm-beta-protected-deploy` is a routine **invoke-only** promotion operator and has no direct steady-state protected infrastructure mutation authority.

A separate non-GitHub federated role is frozen for actual protected-stack maintenance:

```text
role: fpllm-beta-protected-stack-admin
purpose: reviewed protected-stack/controller/IAM infrastructure changes only
routine promotion/recovery use: prohibited
GitHub OIDC trust: none
static AWS access keys: none
```

This role is explicitly part of the high-privilege trusted computing base. The project does **not** claim private evaluator or worker-control secrecy against a malicious holder of this administrative authority; instead, use is deliberately rare, independently authenticated, change-bound, and audited.

## 7.1 Required stack-admin procedure

Every use requires:

```text
reviewed repository source SHA
-> successful repository CI/review gates
-> synthesized protected-stack template/change set attributable to that SHA
-> authenticated non-GitHub federated administrator session
-> review of the exact change set before execution
-> execute only that recorded protected-stack change
-> retain CloudFormation/change-set/resource-diff + CloudTrail actor evidence
```

The role may have the permissions required to update the protected controller/IAM/ASG stack and pass its protected CloudFormation execution role. That authority is why the role is explicitly in the TCB.

It is not supplied to GitHub Actions, the web task, worker, builders, release-material publisher, sensitive-release approver, execution-release broker, or routine protected-deploy operator.

The stack-admin role is not an alternative promotion path. Using it to select a release digest or repair an ordinary promotion instead of the promotion controller is a process violation and invalidates the release evidence until the drift is reconciled and reviewed.

## 7.2 Controller self-protection

Only the protected-stack administrative path may update:

```text
promotion-controller code/configuration
promotion-controller service role/policies
promotion-controller resource policy
protected deployment singleton/table policy
worker ASG/launch-template IAM guardrails
routine protected-deploy invoke-only IAM policy
```

The promotion-controller service role itself cannot update its own Lambda code/configuration or IAM policy and cannot pass/assume the stack-admin role.

P1 must retain negative authorization evidence for all routine principals and CloudTrail/change-set evidence for the stack-admin bootstrap/configuration operation.

---

# 8. Required P1 evidence additions

In addition to all earlier gates, P1 must prove:

1. initial protected worker bootstrap is exactly `ABSENT` with ASG `0/0/1`, no worker instance, and no selected candidate runtime;
2. first successful protected promotion changes the ASG to exact target numeric launch-template version and steady-state `1/1/1`;
3. failed first promotion can restore the exact `ABSENT` bootstrap state without leaving a worker instance;
4. each provider mutation has a durable journal intent before the external call and cannot allocate the next step while unresolved;
5. launch-template creation uses the recorded deterministic `ClientToken`, and an identical retry yields/reconciles the same immutable configuration rather than changed parameters;
6. `$Latest`/`$Default` are impossible release identities;
7. ASG updates are reconciled through `DescribeAutoScalingGroups` after success, timeout, or retry and cannot alter unrelated properties;
8. the exact old serving instance is drained and recorded before termination;
9. a lost termination response can never cause the controller to terminate the replacement instance because retries remain bound to the recorded old instance ID;
10. ASG max=1 and the terminate-then-launch flow never requires two simultaneous `m7i.xlarge` workers under the default quota envelope;
11. target/prior launch-template and ECR rollback identities remain available while rollback authority is live;
12. target-side recovery may continue target convergence until rollback is selected, but once `RESTORE_PRIOR` claims `recoveryDirection=PRIOR`, later `APPLY_TARGET` under that request is rejected;
13. partial/unknown provider state leaves the same deployment generation, mutation lock, promotion request, and journal step occupied;
14. only the routine promotion controller can perform steady-state worker ASG/launch-template mutation;
15. the routine protected-deploy role remains invoke-only and cannot use the new stack-admin authority;
16. the protected-stack-admin role is non-GitHub federated, has no static keys, is absent from routine release automation, and every actual use is tied to a reviewed source SHA/change set with CloudTrail evidence;
17. the controller service role cannot mutate itself, its IAM policy, or assume/pass the stack-admin role.

---

# 9. Review-state boundary

Round 13 closes FPR13-01 through FPR13-04 at the decision/specification level. It does not claim the exact launch-template/ASG journal, bootstrap `ABSENT` state, drain/replacement protocol, stack-admin role, IAM negative tests, CloudTrail evidence, or production AWS behavior are implemented.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

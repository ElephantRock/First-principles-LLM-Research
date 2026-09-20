# Platform v0.5 — Maintainer Corrections Round 14 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `5e8191e1bc7d46efadba9b80efc1e5e994d0ec80`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and final maintainer hardening findings

The continued maintainer pass over round 13 found three internal details that need to be explicit before independent rereview:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR14-01 | HIGH | R13's generic launch-template step could be read as creating a new equivalent launch-template version while restoring a prior `PAIR`. That would not be the exact prior infrastructure identity R11/R12 require. | Promotion claim must record the exact prior numeric launch-template ID/version. Rollback to prior `PAIR` reuses and verifies that exact immutable version; it never creates a replacement equivalent version. Only a new target `PAIR` may create a new version. |
| FPR14-02 | HIGH | R13 listed ASG configuration before drain in its generic step ordering, while its `PAIR -> ABSENT` prose required drain before desired capacity is reduced. Applying `desired=0` first could terminate the serving worker before drain evidence exists. | Freeze transition-specific sequencing. Any transition whose source is `PAIR` enters global worker drain and proves no active learner execution before changing ASG launch-template/capacity state. `PAIR -> ABSENT` drains before `0/0/1`; `PAIR -> PAIR` drains before selecting target LT and terminating the recorded source instance. |
| FPR14-03 | HIGH | The new protected-stack-admin role is an explicit high-privilege TCB, but a normal stack-admin change concurrent with a promotion could still invalidate the controller's protected assumptions and force ambiguous drift. | Normal protected-stack administration is prohibited while a protected build/promotion/deployment mutation is active. Runtime-affecting protected-stack changes use an explicit maintenance/drain window and a clean release-control precondition. Emergency break-glass use during an active release marks that release non-promotable until incident reconciliation/review. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R14_v0.5.md
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

# 1. Exact prior launch-template identity is part of the promotion snapshot

Round 12's first-use promotion claim and round 13's mutation journal are extended so a reconciled prior `PAIR` records:

```text
previousWorkerDigest
previousHiddenEvaluatorDigest
previousLaunchTemplateId
previousLaunchTemplateVersion          # explicit numeric version
previousBootstrapRuntimeIdentity
previousProtectedDeploymentIdentity
previousDeploymentGeneration
```

The controller verifies the prior launch-template version exists and its immutable data corresponds exactly to the recorded prior worker/evaluator/bootstrap state before the claim can commit.

For prior `ABSENT`, the request records:

```text
previousDeploymentMode = ABSENT
bootstrapLaunchTemplateId
bootstrapLaunchTemplateVersion          # explicit numeric protected bootstrap version
previousDeploymentGeneration
```

The bootstrap version is part of the reviewed protected-stack identity and contains no selected production candidate runtime.

## 1.1 Target versus rollback launch-template rules

A **new target `PAIR`** may create one new immutable numeric launch-template version using round 13's deterministic `ClientToken` protocol.

A rollback to prior `PAIR` **must not create a new equivalent version**. It selects the exact recorded:

```text
previousLaunchTemplateId@previousLaunchTemplateVersion
```

and verifies its immutable contents again before ASG selection.

A rollback to `ABSENT` selects the exact recorded protected bootstrap launch-template version and `0/0/1` capacity state.

If the required prior/bootstrap launch-template version has been deleted, modified by impossible provider behavior, or cannot be proven to match its recorded identity, rollback fails closed. The controller does not synthesize a replacement and call it the prior state.

Lifecycle/IAM policy must therefore retain any launch-template version referenced by:

- the current protected deployment record;
- a live promotion request's target state;
- a live promotion request's rollback state.

The same retention rule continues to apply to referenced ECR image digests.

---

# 2. Transition-specific worker drain and mutation order — FROZEN

Round 13's generic phase list is superseded where it implies that ASG desired-state configuration always precedes drain. The exact order depends on source/target deployment mode.

The global worker-drain mechanism is the already-frozen product/runtime control that stops new leases while preserving queued work and learner evidence. Drain is not inferred from EC2 termination state.

## 2.1 `ABSENT -> PAIR`

There is no serving source worker.

Order:

```text
claim promotion/generation lock
-> create/reconcile exact target numeric LT version
-> update ASG to target LT + 1/1/1
-> observe one healthy target worker
-> worker/gVisor/runtime preflight
-> compatibility/smoke
-> terminal target transaction
```

No source-instance drain or termination step exists.

## 2.2 `PAIR -> PAIR`

Order:

```text
claim promotion/generation lock
-> create/reconcile exact target numeric LT version (no operational selection yet)
-> enable global worker drain
-> prove no active learner execution remains
-> record the exact current sourceInstanceId and verify it runs the recorded prior LT/runtime
-> recheck deployment generation/lock and actual source identity
-> update ASG desired configuration to exact target numeric LT + 1/1/1
-> reconcile the group configuration
-> terminate only the recorded sourceInstanceId with ShouldDecrementDesiredCapacity=false
-> observe its departure and one replacement from the exact target LT
-> worker/gVisor/runtime preflight
-> compatibility/smoke
-> terminal target transaction
```

The ASG is never switched to the target launch-template version before the source worker is drained. If the source instance disappears before the target ASG update, ordinary host-loss recovery applies; the controller re-reconciles the still-prior deployment, keeps global drain enabled, and records the current prior-version source instance before continuing.

Because max remains 1, the sequence preserves the frozen terminate-then-launch outage model and does not require an 8-vCPU EC2 quota.

## 2.3 `PAIR -> prior PAIR` rollback

Rollback first atomically claims `recoveryDirection = PRIOR` as frozen by round 13.

If a worker instance is present, order is:

```text
global worker drain
-> prove no active learner execution remains
-> inspect actual current instance and group state
-> if already exact recorded prior PAIR: skip destructive replacement and proceed to prior smoke
-> otherwise record the exact current sourceInstanceId
-> select/reconcile exact recorded previous LT version + 1/1/1
-> terminate only that recorded source instance
-> observe one healthy replacement from the exact previous LT
-> worker/gVisor/runtime preflight
-> rollback compatibility/smoke
-> terminal rollback transaction
```

A target/partial instance is never used as the identity of the prior state merely because it is healthy.

## 2.4 `PAIR -> ABSENT` rollback

When the recorded prior state is initial-release `ABSENT`, the serving/partial worker must be drained **before** desired capacity is reduced.

Order:

```text
claim recoveryDirection = PRIOR
-> enable global worker drain
-> prove no active learner execution remains
-> record the current worker instance if present
-> select the exact protected bootstrap LT version and set ASG min=0, desired=0, max=1
-> reconcile ASG desired state
-> prove every worker instance has left the group / terminated
-> prove no replacement worker appears
-> verify no production candidate runtime is selected
-> terminal ABSENT rollback transaction
```

The controller does not call `TerminateInstanceInAutoScalingGroup(...false)` for this transition because desired capacity is intentionally zero.

## 2.5 Drain cleanup

A successful target terminal transaction re-enables ordinary worker leasing only after the new worker passes the required smoke/preflight gates and release-control state commits successfully.

A successful rollback to prior `PAIR` similarly re-enables leasing only after prior smoke/compatibility and the terminal rollback transaction.

Rollback to `ABSENT` leaves no worker to enable.

If any transition remains partial or `FAILED_REQUIRES_OPERATOR`, the global drain state remains conservative: no newly observed worker may begin learner leasing until the controller proves it is one of the two permitted bound states and the appropriate terminal/recovery gate authorizes service.

---

# 3. Protected-stack administration is serialized against release mutation

Round 13's `fpllm-beta-protected-stack-admin` role remains the explicit high-privilege TCB for reviewed protected-stack/controller/IAM changes. Normal use now has mandatory release-control preconditions.

Before applying a non-emergency protected-stack change, the administrator must verify and retain evidence that:

```text
PROTECTED_EXECUTION_DEPLOYMENT.activeMutationPromotionRequestId == null
no protected component logical attempt/build is starting/building/unreconciled
no execution-tier promotion request is failed_requires_operator
no ordinary release-control recovery is in progress
```

A runtime-affecting change to worker/controller/IAM/ASG/launch-template/bootstrap behavior additionally requires the already-frozen maintenance/drain mode so no learner execution is active while the trusted execution substrate changes.

The protected stack change set must not select a new learner release digest as a substitute for the promotion controller. After the change, the administrator/controller reconciliation records the new protected **infrastructure/configuration identity** without rewriting historical learner or release evidence.

## 3.1 Emergency break-glass during an active release

If an incident requires high-privilege stack-admin action while a promotion/build/recovery is active, that is explicitly an emergency break-glass event, not a normal release path.

The affected active candidate/promotion becomes **non-promotable pending incident reconciliation**. The active locks are not silently cleared. Before any release resumes:

1. actual protected AWS state is independently inventoried;
2. release-control state and provider state are reconciled;
3. any build/promotion whose assumptions were invalidated is terminalized diagnostically rather than blessed retroactively;
4. a fresh trusted approval/new promotion request is required when the old bound state can no longer be proven;
5. CloudTrail, protected-stack change set, incident record, and resulting release-control disposition are retained.

A break-glass administrator therefore cannot use emergency authority to create normal passing promotion evidence for a third digest/state.

---

# 4. Required P1 evidence additions

P1 must prove, in addition to all previous requirements:

1. promotion claim records and verifies exact numeric prior/bootstrap launch-template IDs and versions;
2. rollback to prior `PAIR` reuses that exact immutable version and cannot create an equivalent replacement version;
3. lifecycle/IAM controls retain launch-template versions and ECR digests referenced by current/live rollback state;
4. `ABSENT -> PAIR` launches from the target version without a source drain path;
5. `PAIR -> PAIR` proves drain/no-active-execution before ASG selects the target version or terminates the recorded source instance;
6. source loss during drain cannot cause a replacement to be mistaken for the originally recorded source; the controller re-reconciles while global drain remains enabled;
7. `PAIR -> ABSENT` proves drain before desired capacity becomes zero and terminalizes only after no worker remains;
8. prior-PAIR rollback skips unnecessary replacement only when actual instance/group/runtime identity already equals the exact recorded prior state;
9. partial/failed transitions keep learner leasing disabled until an allowed target/prior state is proven and terminalized;
10. normal protected-stack administration is denied by procedure/evidence while a build, mutation, or failed-required-operator recovery is active;
11. runtime-affecting protected-stack administration occurs under maintenance/drain with no active learner execution;
12. emergency stack-admin use during an active release produces incident/reconciliation evidence and cannot directly create normal promotion success.

---

# 5. Review-state boundary

Round 14 closes FPR14-01 through FPR14-03 at the decision/specification level. It does not claim launch-template retention, transition-specific drain sequencing, stack-admin serialization, break-glass incident handling, IAM negative tests, or AWS production evidence are implemented.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

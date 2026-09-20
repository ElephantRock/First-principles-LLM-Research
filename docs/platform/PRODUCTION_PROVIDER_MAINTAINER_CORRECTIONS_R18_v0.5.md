# Platform v0.5 — Maintainer Corrections Round 18 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `af32811fb2abe6d40d26d9fc195e52719ec264cc`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and maintainer finding

The continued exact-head maintainer review found one remaining protected-stack maintenance ambiguity:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR18-01 | HIGH | R14 says that after a runtime-affecting protected-stack change, "administrator/controller reconciliation" records a new protected infrastructure/configuration identity. But rounds 12–17 deliberately give the routine promotion controller only release-bound actions and give the stack administrator no ordinary release-control-state write path. The record therefore still does not define who may advance/rewrite the live deployment identity after an out-of-band ASG/launch-template/bootstrap maintenance change. P1 would have to invent either a direct DynamoDB mutation or a new controller action, reopening the same mutation-authority problem. | Remove normal post-bootstrap stack-admin mutation of the live worker deployment identity from v0.5. P1 stack-admin may establish the initial protected bootstrap topology before production service is opened. After the first successful production `PAIR`, normal stack-admin changes may update controller/IAM/protected infrastructure only when they leave the current worker deployment identity and release-control state unchanged. Any planned change that would alter the live worker ASG selection, numeric launch-template identity, AMI/bootstrap runtime identity, capacity, or release/service-control state requires an explicit P0 amendment and bounded migration protocol before execution. Emergency break-glass retains the incident/fail-closed path and never becomes normal release evidence. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R18_v0.5.md
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

# 1. P1 bootstrap administration versus post-promotion administration

The protected-stack administrator has two distinct lifecycle contexts.

## 1.1 Initial P1 provisioning/bootstrap

Before the first production execution-tier promotion, `fpllm-beta-protected-stack-admin` may create and converge the reviewed protected infrastructure required by the P0 record, including:

```text
protected CodeBuild projects/roles
admission/execution/promotion controller Lambdas and roles
protected DynamoDB/S3/KMS/ECR policies
worker ASG/launch template/bootstrap resources
private-build networking/endpoints
CloudTrail/audit configuration
```

P1 bootstrap is complete only when the exact reviewed initial state is independently verified and retained:

```text
PROTECTED_EXECUTION_DEPLOYMENT.generation = 0
mode = ABSENT
ASG = exact protected bootstrap LT + 0/0/1
no worker instance
workerLeasingMode = DRAINED
workerDrainEpoch = 0
workerDrainPromotionRequestId = null
no active release build/promotion mutation
```

The stack administrator does not fabricate learner release success by creating this bootstrap state; it is infrastructure admission for the first protected promotion.

## 1.2 After the first successful production PAIR

After production has reached a terminal promoted `PAIR`, normal stack-admin changes are allowed only if the proposed change leaves the current protected worker deployment identity and release-control state unchanged.

The normal administrator must not directly change:

```text
selected worker ASG launch-template ID/version
worker AMI/bootstrap/runtime identity represented by the protected deployment record
ASG min/desired/max capacity
worker/evaluator release digests or runtime selection
worker service-control epoch/mode/owner
PROTECTED_EXECUTION_DEPLOYMENT generation/mode/digests/identity
candidate/promotion/build journal state
```

The stack-admin role receives no direct application-level DynamoDB write path for those release-control fields merely because it can administer the infrastructure stack.

---

# 2. Allowed normal protected-stack maintenance after promotion

A reviewed stack-admin change may proceed under the round-14 serialization/maintenance rules when it changes protected infrastructure without changing the live worker deployment identity. Examples include bounded changes to:

- promotion/admission/broker Lambda code or configuration that preserve the frozen external schemas/authority contracts;
- IAM policy tightening or equivalent permission corrections that preserve required runtime authority;
- logging/metrics/alarm configuration;
- protected resource metadata, retention, or policy controls that do not select or replace the running worker runtime;
- private-build infrastructure that does not mutate the active production `PAIR`.

Before and after such a change, the administrator must prove:

```text
no active protected build/promotion/recovery mutation
maintenance/drain requirements satisfied where applicable
actual worker ASG/LT/runtime/capacity identity unchanged
PROTECTED_EXECUTION_DEPLOYMENT still exactly matches actual worker deployment
service-control state unchanged except through its already-authorized owner
```

Because the live deployment identity is unchanged, no deployment-generation advance or ad hoc release-control rewrite is needed or permitted.

R14's phrase that "administrator/controller reconciliation records the new protected infrastructure/configuration identity" is superseded where it could be read to authorize rewriting the live worker deployment identity after a stack-admin mutation.

---

# 3. Planned live worker substrate changes require a P0 amendment

After the first successful production `PAIR`, a planned change that would alter any of the following is outside the normal v0.5 stack-admin path:

```text
worker ASG selected launch-template version
worker AMI/bootstrap runtime identity
steady-state worker capacity topology
worker instance-profile/security-group semantics that materially change runtime trust
worker runtime/evaluator digest selection
service-control state machine semantics
protected deployment generation semantics
```

Such a change must stop before execution and reopen P0 with a reviewed amendment that freezes:

- the exact migration authority and caller schema;
- maintenance/drain and learner-admission behavior;
- old/new deployment identity and generation transitions;
- crash/replay recovery for external AWS mutations;
- compatibility and rollback state;
- release/evidence provenance;
- any quota/cost/security consequence.

A stack-admin change set is not itself authorization to invent this migration protocol.

---

# 4. Emergency break-glass remains incident-only

Round 14's emergency semantics remain authoritative. If incident response requires the high-privilege administrator to alter the live worker substrate despite the normal prohibition:

- the affected release/candidate becomes non-promotable pending incident reconciliation;
- ordinary promotion/controller assumptions are invalidated rather than silently rewritten;
- actual AWS and release-control state are inventoried independently;
- the incident/change-set/CloudTrail evidence is retained;
- a fresh P0 amendment and/or fresh trusted approval is required before a changed live substrate is accepted as a normal production baseline.

Emergency authority cannot write a new deployment generation or release success merely to make protected state match the incident mutation.

---

# 5. Required P1 evidence additions

P1 must prove, in addition to every earlier gate:

1. protected-stack bootstrap converges and verifies the exact initial `ABSENT`/`DRAINED` state before first promotion;
2. the stack-admin role has no ordinary application-level write permission to deployment-generation, digest, promotion, journal, or service-control state;
3. after first promotion, a normal stack-admin change cannot change the selected worker launch-template version, ASG capacity, runtime digests, or service-control state;
4. allowed controller/IAM/logging maintenance leaves actual worker deployment identity exactly equal to the protected deployment record before and after the change;
5. no ad hoc deployment-generation update is performed for a maintenance change that leaves worker identity unchanged;
6. an attempted planned worker-substrate change through stack-admin stops for a P0 amendment rather than inventing a direct mutation/reconciliation path;
7. break-glass worker-substrate mutation produces incident/fail-closed evidence and cannot manufacture normal promotion success.

---

# 6. Review-state boundary

Round 18 closes FPR18-01 at the decision/specification level. It does not claim bootstrap provisioning, post-promotion stack-admin IAM denies, maintenance invariance checks, amendment enforcement, incident handling, or production AWS evidence are implemented.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

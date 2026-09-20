# Platform v0.5 — Maintainer Corrections Round 17 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `60583e299bfa3b3f46fb6eb32c1600a07a65ce72`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and maintainer finding

The continued exact-head maintainer review found one remaining operations-authority contradiction created by the later protected-deployment controls:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR17-01 | HIGH | The early P0 record allowed the production worker ASG to scale to zero during an explicitly announced beta pause, and R13 said that pause rule remained separate from bootstrap `ABSENT`. But R12–R16 intentionally removed direct routine ASG mutation from the protected-deploy operator and made the promotion controller the only normal worker deployment mutator; its bounded schema has no independent pause/resume capacity operation. Leaving the old optional pause path in force would require P1 to invent a privileged mutation bypass or misuse release promotion state. | Remove worker scale-to-zero as a normal v0.5 beta-pause operation. After the first successful `PAIR` promotion, the production worker remains ASG `1/1/1` during ordinary announced learner pauses. A pause may stop learner submission admission and/or leasing through the existing product controls, but it does not change protected worker capacity or deployment identity. Any future cost-driven steady-state scale-to-zero/resume mechanism requires an explicit P0 amendment with bounded authority and recovery semantics. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R17_v0.5.md
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

# 1. Worker capacity after first successful promotion — FROZEN

The earlier optional rule permitting worker scale-to-zero during an announced beta pause is superseded for v0.5.

After the first successful protected execution-tier promotion, every ordinary production `PAIR` has:

```text
ASG min = 1
ASG desired = 1
ASG max = 1
one healthy worker instance
explicit numeric protected launch-template version
exact recorded worker/evaluator runtime identity
```

That `1/1/1` capacity remains in force during normal operation and during an announced learner-facing beta pause.

A learner-facing pause may use the already-frozen application/release controls to:

- stop creation/admission of new learner submissions;
- keep worker leasing disabled/drained where maintenance requires it;
- allow existing bounded work to terminalize under the established drain/lease rules;
- keep evidence reads and operator diagnostics available as allowed by the surrounding maintenance contract.

It does **not** authorize an independent ASG capacity or runtime mutation.

---

# 2. `ABSENT` remains bootstrap/rollback-only

The protected deployment mode:

```text
mode = ABSENT
ASG = 0/0/1
workerLeasingMode = DRAINED
```

remains valid only for:

1. the initial pre-first-release bootstrap state; or
2. exact rollback of a failed first promotion whose recorded prior state was bootstrap `ABSENT`.

An announced beta pause after production has reached a successful `PAIR` does not transition the deployment record to `ABSENT`, does not reset worker/evaluator digests, does not select the bootstrap launch-template version, and does not advance deployment generation merely because learners are temporarily paused.

---

# 3. No hidden routine capacity-mutation authority

The authority split from rounds 12–16 remains strict:

```text
fpllm-beta-protected-deploy
    -> invoke bounded promotion controller + read bounded diagnostics only

fpllm-beta-promotion-controller
    -> exact release-bound target/prior worker deployment mutation only

fpllm-beta-protected-stack-admin
    -> reviewed protected-stack/controller/IAM changes under maintenance/change control, not routine pause/resume
```

None of these roles receives a separate undocumented "pause by scaling ASG to zero" steady-state path.

If a future beta phase requires cost-driven worker scale-to-zero after a successful production `PAIR`, P0 must reopen and freeze at minimum:

- caller/authentication authority;
- durable pause/resume request identity and replay semantics;
- interaction with worker leasing/drain epochs and active jobs;
- preserved worker/evaluator deployment identity across zero capacity;
- generation/mutation locking against concurrent promotion;
- crash recovery for ASG capacity changes;
- resume preflight and exact runtime identity proof;
- monitoring/cost implications.

No P1 implementation may invent this path implicitly.

---

# 4. Required P1 evidence additions

P1 must prove, in addition to every earlier gate:

1. after first successful promotion, the steady-state worker ASG is `1/1/1`;
2. ordinary learner-facing pause controls cannot mutate protected ASG capacity or runtime identity;
3. the routine protected-deploy operator has no direct ASG scale-to-zero permission;
4. the promotion controller exposes no free-standing pause/resume capacity action outside a bound promotion request;
5. `ABSENT` is reachable only as initial bootstrap or rollback to the recorded initial bootstrap state;
6. maintenance/drain can disable learner leasing without changing the production `PAIR` capacity identity.

---

# 5. Review-state boundary

Round 17 closes FPR17-01 at the decision/specification level. It does not claim the IAM denies, steady-state capacity, learner-pause controls, maintenance drain behavior, or production AWS evidence are implemented.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

# Platform v0.5 — Maintainer Corrections Round 28 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Independent review baseline:** `ec2f03140d4fd597865221f7665ab85d6c8ef47d`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and exact-head Codex findings

The fresh exact-head Codex review of `ec2f03140d4fd597865221f7665ab85d6c8ef47d` found two remaining P0 decision gaps:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR28-01 | HIGH | Incident admission could occur while a learner lease was active, but the active job's evidence/result terminalization was not incident-epoch fenced. A mutating emergency profile could therefore alter the execution environment under an active job, and that job could still persist ordinary evidence. | Bind every lease to the incident epoch observed at acquisition and require exact `IDLE` + unchanged incident epoch before any learner submission/evidence/mastery terminalization. If an incident rises, the active execution may finish only as quarantined diagnostic work; it cannot produce ordinary learner evidence or consume learner retry/mastery state. New lease acquisition is also incident-mode/epoch fenced. |
| FPR28-02 | HIGH | R25–R27 defined a repair-profile framework but left the actual initial profile IDs, action/resource scopes, base-role permission boundary, and session policies to P1. That leaves material emergency provider authority undecided while P0 claims provider/security selection is closed. | For the initial v0.5 beta, select **no mutating emergency repair profile at all**. The break-glass incident broker remains only for durable incident admission/audit correlation. No emergency provider-mutation IAM role is provisioned and the broker has no `sts:AssumeRole` authority. Any incident requiring provider mutation outside the already-frozen promotion/maintenance recovery controllers remains `INCIDENT` until an explicit P0 amendment freezes the required bounded authority. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R28_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R27_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R26_v0.5.md
    > ...
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

Non-conflicting decisions remain in force.

---

# 1. Every learner lease is bound to the protected incident epoch — FROZEN

R23's protected lease-acquisition controller remains the only production principal allowed to perform a new `QUEUED -> LEASED` transition.

The durable learner-job lease record now includes at minimum:

```text
leaseAcquisitionId
leaseWorkerIdentity
leaseServiceControlEpoch
leaseProtectedControlIncidentEpoch
leaseOwnedAt
```

Before the lease-acquisition controller claims its acquisition dispatch lease **and again immediately before the single R22 autocommit PostgreSQL ownership statement**, it must prove:

```text
protectedStackMaintenanceMode == IDLE
protectedStackIncidentId == null
protectedControlIncidentEpoch == expected incident epoch captured by the acquisition slot
workerLeasingMode == ENABLED
exact acquisition slot/ID/service-control predicates still hold
```

The autocommit ownership statement persists the exact expected incident epoch atomically with learner-job ownership.

If an incident is admitted after the worker reserved the acquisition slot but before the database ownership statement, the exact `IDLE`/epoch predicate fails and no learner lease may be created for that stale acquisition.

Incident admission therefore blocks **new** learner ownership without waiting for a pre-existing acquisition timeout.

---

# 2. Learner result/evidence terminalization is incident-epoch fenced — FROZEN

A worker or evaluator may compute after an incident fence rises, but ordinary learner-visible/persistent evidence cannot be committed from a lease whose incident epoch is stale.

Before any transition that would make a submission execution authoritative for the learner—including at minimum:

```text
submission execution -> PASSED / FAILED / terminal evaluator result
public/hidden evaluator evidence becoming canonical
memory-experiment result becoming canonical
mastery / retry-budget consequence
journal-eligible evidence publication
```

the durable terminalization transaction must prove:

```text
current protectedStackMaintenanceMode == IDLE
current protectedStackIncidentId == null
current protectedControlIncidentEpoch == leaseProtectedControlIncidentEpoch
exact lease ID / worker identity / submission job identity still match
```

This is an authorization predicate, not a best-effort post-check.

If any predicate fails because an incident rose during execution, ordinary terminalization is rejected and the job enters a distinct diagnostic disposition such as:

```text
INFRASTRUCTURE_INCIDENT_QUARANTINED
```

The exact production enum/name is a P1 implementation detail; the semantics are frozen:

- no learner mastery credit or failure is awarded;
- no learner retry budget is consumed;
- no hidden/public evaluator result is promoted to ordinary course evidence;
- diagnostic logs/receipts may be retained under the incident ID/epoch for operator analysis;
- resubmission/replay after incident recovery must use the ordinary immutable-source/retry rules and a fresh lease bound to the then-current incident epoch.

A stale worker cannot bypass this by writing evidence through a secondary path: all database/API mutations that canonicalize submission/evaluator/mastery evidence must enforce the same lease incident-epoch predicate at the trusted persistence boundary.

---

# 3. Incident admission during active learner work — SELECTED BEHAVIOR

Incident admission remains immediate. It does not wait for active learner work to finish before raising the durable `INCIDENT` fence and incrementing `protectedControlIncidentEpoch`.

For an incident opened while one or more learner jobs are already leased:

1. new lease acquisition stops because §1's `IDLE`/epoch predicate fails;
2. existing execution may be allowed to terminate naturally or may be diagnostically cancelled according to bounded worker controls;
3. regardless of process lifetime, §2 prohibits ordinary learner evidence/result terminalization from the stale lease;
4. incident recovery/exit still requires the existing authoritative zero-active-lease and zero-unresolved-acquisition predicates before service returns to ordinary `IDLE`/`ENABLED` operation.

For v0.5 this is the universal learner-safety rule; no emergency permission profile is allowed to claim that active learner execution is “disjoint” and bypass the result fence.

---

# 4. Initial v0.5 emergency provider-mutation profile registry — EMPTY

R25–R27's generic repair-profile/session machinery is **not selected for activation in the initial v0.5 beta**.

The authoritative initial registry is:

```text
mutatingEmergencyRepairProfiles = []
```

There is no production-admissible mutating `repairProfileId` for v0.5.

Consequences:

- `fpllm-beta-break-glass-incident-broker` may admit/append `BREAK_GLASS` and `AUDIT_DETECTED` incidents and return bounded diagnostic metadata only;
- it cannot mint a provider-mutation credential;
- `OPEN_BREAK_GLASS_INCIDENT` does not imply provider mutation authority;
- `OPEN_AUDIT_DETECTED_INCIDENT` never implies provider mutation authority;
- no caller can select a hidden/default/wildcard repair profile;
- no dynamic profile creation is available at invocation time.

The R25–R27 STS attempt/dispatch/expiry/session-policy design remains a reviewed **future activation contract**, but it is dormant in the initial v0.5 topology and cannot be treated as deployed/selected authority without a later explicit P0 amendment.

---

# 5. Emergency provider role and base permission boundary — NOT PROVISIONED FOR v0.5

The initial v0.5 production topology does **not** provision:

```text
fpllm-beta-emergency-break-glass
```

or any equivalent human/broker-assumable mutating emergency provider role.

Accordingly the break-glass incident broker's initial IAM permissions explicitly exclude:

```text
sts:AssumeRole to any provider-mutation role
cloudformation:* mutation
aws autoscaling/EC2/ECS/RDS/IAM/KMS/ECR/S3 mutation outside its already-frozen incident-record action surface
protected release-state direct mutation outside the incident-admission schema
```

The broker's selected responsibilities are only:

- schema-enforced durable incident admission/appending;
- server-generated incident ID/epoch/origin and audit correlation;
- release-fence establishment;
- bounded read/diagnostic data needed to report incident identity/state;
- no direct provider repair mutation.

The human emergency operator may use already-frozen read-diagnostic authorities, but no initial v0.5 identity receives generic mutation permissions through an “emergency” path.

This is the concrete base-role permission boundary for initial beta: **there is no mutating emergency base role**.

---

# 6. How an incident is repaired in initial v0.5

An incident may be cleared only through one of two selected paths:

## 6.1 Existing bounded controller recovery

If the incident can be reconciled/returned to a known safe state using a recovery transition already frozen in the promotion/maintenance/service-control state machines, that exact controller-mediated path may be used under its `INCIDENT` recovery predicates.

No controller gains new provider actions merely because the system is in `INCIDENT`.

## 6.2 P0 amendment for new provider mutation authority

If recovery requires a provider mutation not already expressible by a frozen bounded controller, the service remains fail-closed in `INCIDENT`/non-leasing state while a new P0 amendment freezes, at minimum:

```text
exact repairProfileId
incident/reason classes
exact AWS API actions
exact resource ARN set/patterns and condition keys
canonical inline session policy
base role permissions/trust
required learner drain/result-fence behavior
pre-incident provider-operation reconciliation rules
STS/provider limits and duration
cost/quota/network implications
incident-exit proof
P1 negative/effective-policy/race tests
```

Only after that amendment is reviewed/merged may the corresponding provider role/profile be provisioned and used.

No incident urgency converts an unselected permission set into ordinary evidence-compliant v0.5 authority. Emergency root/account-owner actions remain outside normal evidence and cannot manufacture `IDLE`, release success, or learner evidence; if used, audit detection keeps/re-establishes the incident fence and recovery remains a security event.

---

# 7. R24–R27 provider-session selections superseded for initial beta

For clarity, R28 supersedes the following **selected-topology** claims from R24–R27 for the initial v0.5 release:

- that the break-glass broker may issue a mutating emergency STS session;
- that `fpllm-beta-emergency-break-glass` is part of the initial production IAM topology;
- that an initial repair-profile allowlist contains any mutating profile;
- that P1 must prove real STS issuance for a deployed emergency mutating profile before initial P0/P1 progression.

The timing/size/session-policy constraints in R25–R27 become mandatory only if a later P0 amendment activates a mutating profile; they remain the minimum floor and may be tightened by that amendment.

R28 does **not** remove the sixth protected control Lambda reservation: the break-glass incident broker is still required for durable `BREAK_GLASS`/`AUDIT_DETECTED` incident admission and fencing. It simply has no provider credential issuance authority in the initial beta.

---

# 8. Required P1 evidence additions

P1 must prove, in addition to every earlier gate:

1. every successful new learner lease atomically records `leaseProtectedControlIncidentEpoch`;
2. acquisition dispatch and the autocommit lease-owning statement both fail if mode is not `IDLE`, an incident ID exists, or the incident epoch changed;
3. incident admission racing a pre-SQL acquisition prevents that acquisition from creating a lease;
4. every trusted persistence/API path that canonicalizes submission/evaluator/experiment/mastery evidence requires the exact lease incident epoch and current `IDLE`/no-incident state;
5. a forced incident after lease acquisition but before result commit produces quarantined diagnostic disposition, not ordinary learner evidence;
6. that quarantined path does not consume learner retry budget or award/remove mastery;
7. new leasing remains blocked while `INCIDENT`, and incident exit still requires zero active leases plus zero unresolved acquisitions;
8. `mutatingEmergencyRepairProfiles` is exactly empty in deployed initial-beta configuration;
9. no `fpllm-beta-emergency-break-glass` mutating role (or equivalent) exists in the initial production IAM inventory;
10. the break-glass incident broker has no `sts:AssumeRole` path to a provider-mutation role and no direct generic provider-mutation permissions;
11. break-glass/audit incident admission still works and increments/fences the protected incident epoch without any STS issuance path;
12. a simulated incident requiring an unmodeled provider repair remains fail-closed and produces an explicit P0-amendment requirement rather than a hidden/wildcard permission fallback;
13. the six protected Lambda reservation/topology envelope remains satisfied because the incident broker remains deployed for admission/fencing.

---

# 9. Review-state boundary

Round 28 closes FPR28-01 and FPR28-02 at the decision/specification level only.

It does **not** claim the lease/result incident-epoch predicates, quarantined evidence state, IAM negative permissions, empty repair registry, incident broker, applied quotas, race tests, or production AWS state are implemented.

The resulting exact HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

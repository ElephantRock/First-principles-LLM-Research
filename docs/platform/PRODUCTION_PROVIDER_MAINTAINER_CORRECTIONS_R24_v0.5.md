# Platform v0.5 — Maintainer Corrections Round 24 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Independent review baseline:** `2aaf2c4700d31ec05ff4907a853ad71d3c9ad3c3`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and exact-head Codex finding

The fresh independent review of exact HEAD `2aaf2c4700d31ec05ff4907a853ad71d3c9ad3c3` found one remaining break-glass admission gap in the R21–R23 maintenance/incident model:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR24-01 | HIGH | R21 explicitly retained emergency break-glass use without a normal maintenance claim or while release work was active, but R23 could enter durable `INCIDENT` only from an existing `ACTIVE` maintenance operation. A true out-of-band emergency therefore had no operation ID/plan/provider identity to preserve and could leave maintenance mode `IDLE` while provider state was being changed. | Define a server-generated break-glass incident admission path that can atomically enter `INCIDENT` from `IDLE` without requiring release quiescence, and that can convert `ACTIVE` maintenance to `INCIDENT` while preserving its owner. Make the supported emergency provider role obtainable only through a protected credential broker after that incident state is durable. Add a monotonic incident epoch checked before every normal release provider dispatch and every normal release terminal/canonical state advancement so release work that won a prior race cannot continue as normal after the incident fence rises. Incident exit must wait until all brokered emergency sessions are expired/revoked and all affected provider/release state is reconciled. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R24_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R23_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R22_v0.5.md
    > ...
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

Non-conflicting decisions remain in force.

---

# 1. Supported emergency break-glass authority — REDEFINED

R21 §7's phrase “emergency authority is used without a normal maintenance claim” remains valid, but “without a normal maintenance claim” no longer means “without a durable incident fence.”

The supported v0.5 emergency path is:

```text
trusted non-GitHub emergency operator
    -> protected break-glass incident broker
    -> durable INCIDENT admission
    -> short-lived brokered emergency provider session
    -> emergency provider repair
    -> exact incident reconciliation
    -> session expiry/revocation proof
    -> INCIDENT -> IDLE only if every frozen invariant is restored
```

A human/operator does not directly assume the emergency provider-mutation role before the incident record exists.

Direct root/account-owner or otherwise unbrokered provider mutation is **not** a supported normal break-glass workflow. If it occurs, it is treated as an unauthorized/security incident and must be detected, fenced, and reconciled under the incident procedure; it cannot be cited as normal P0/P1 release evidence.

---

# 2. Protected break-glass incident broker — SELECTED

Add one bounded protected control-plane Lambda:

```text
name:                  fpllm-beta-break-glass-incident-broker
region:                eu-west-1
reserved concurrency:  1
timeout:                <= 30 seconds
caller:                 separately authorized non-GitHub emergency operator only
protected incident-state write authority: broker only for break-glass admission/session issuance
STS assume-role authority: exact emergency provider role only
normal release/build/promotion authority: none
```

The emergency operator has no direct `sts:AssumeRole` trust path to the provider-mutation role. The emergency provider role trusts only the broker principal.

The broker request schema is bounded to:

```text
incidentRequestId
reasonCode
human-readable emergency reason (bounded length)
reviewed emergency resource-scope descriptor/hash
```

The broker server-generates the durable incident identity. The caller cannot supply or select:

- maintenance/release epochs;
- candidate/build/promotion request IDs;
- worker/evaluator image digests;
- launch-template versions;
- change-set/provider operation identities;
- service-control owner epochs;
- arbitrary IAM role ARNs.

The broker is not a normal deployment path and cannot create a normal maintenance success or release success.

---

# 3. Break-glass incident admission — FROZEN

Extend the R23 maintenance/incident singleton with:

```text
protectedControlIncidentEpoch: non-negative integer
protectedStackIncidentId: string | null
protectedStackIncidentOrigin: NORMAL_MAINTENANCE | BREAK_GLASS | null
protectedStackIncidentRequestId: string | null
protectedStackIncidentActorIdentity: string | null
protectedStackIncidentReasonCode: string | null
protectedStackIncidentReasonHash: sha256 | null
protectedStackIncidentResourceScopeHash: sha256 | null
protectedStackIncidentEnteredAt: timestamp | null
protectedStackIncidentReleaseSnapshot: bounded structured snapshot | null
protectedStackIncidentLatestEmergencySessionExpiry: timestamp | null
protectedStackIncidentSessionIssueClosedAt: timestamp | null
```

`protectedControlIncidentEpoch` is monotonic history and is never reset to zero.

## 3.1 `IDLE -> INCIDENT` without a normal maintenance claim

The break-glass broker may atomically claim an emergency incident from `IDLE` **without requiring release quiescence**.

The transaction requires at minimum:

```text
protectedStackMaintenanceMode == IDLE
no existing protectedStackIncidentId
incidentRequestId unused or exact-idempotent replay
```

and atomically writes:

```text
protectedStackMaintenanceMode = INCIDENT
protectedControlIncidentEpoch = previous + 1
protectedStackIncidentId = server-generated cryptographically unique ID
protectedStackIncidentOrigin = BREAK_GLASS
protectedStackIncidentRequestId = exact request ID
protectedStackIncidentActorIdentity = authenticated emergency actor
protectedStackIncidentReasonCode/hash = exact bounded request commitment
protectedStackIncidentResourceScopeHash = exact reviewed scope commitment
protectedStackIncidentEnteredAt = server timestamp
protectedStackIncidentReleaseSnapshot = bounded snapshot of currently active release-control identities
protectedStackIncidentLatestEmergencySessionExpiry = null
protectedStackIncidentSessionIssueClosedAt = null
```

Because emergency incident admission may race active release work, the snapshot records any currently active candidate/build dispatch, protected build slot, promotion request, deployment mutation owner, release-owned service-control owner, and other release identity needed for later incident reconciliation. Absence of quiescence is intentional; the incident transition is a **fence**, not proof that no work was active.

If a release authority transaction commits first, the emergency incident may still claim immediately afterward and invalidate further normal progress through the incident epoch rules below. If incident admission commits first, later release authority grants fail because they require exact `IDLE`.

## 3.2 Break-glass during `ACTIVE` maintenance

If a normal maintenance operation is already `ACTIVE`, the broker does not create a second independent owner. It atomically converts the existing operation to `INCIDENT`, preserving the exact maintenance operation/epoch/plan/provider/service-control state and setting:

```text
protectedControlIncidentEpoch = previous + 1
protectedStackIncidentId = server-generated incident ID
protectedStackIncidentOrigin = BREAK_GLASS
break-glass actor/reason/resource-scope commitments
incident release snapshot
```

This is the R23 `ACTIVE -> INCIDENT` path plus the explicit emergency-event identity.

## 3.3 Existing `INCIDENT`

If mode is already `INCIDENT`, a new emergency request cannot replace or clear the incident owner. The broker may only append a bounded, auditable emergency event/session to the existing incident if the requested resource scope is authorized by the incident-recovery policy. It does not generate a second concurrent incident epoch or change the original owner identity except through an explicit monotonic incident event record.

---

# 4. Normal release work is incident-epoch fenced — FROZEN

R23 already requires exact maintenance mode `IDLE` for every normal release authority grant. R24 additionally closes the race where release work obtained authority immediately before break-glass incident admission.

Every normal release-control request/dispatch owner records or resolves the current `protectedControlIncidentEpoch` when it first acquires authority.

Immediately before **every external provider mutation/dispatch** and immediately before **every durable transition that advances normal release state or makes provider output canonical**, the owning protected controller must conditionally prove:

```text
protectedStackMaintenanceMode == IDLE
protectedControlIncidentEpoch == request's expected incident epoch
```

This applies at minimum to:

```text
protected StartBuild dispatch
protected build-result canonicalization
promotion-controller provider mutation
promotion terminal success/rollback state advancement
protected deployment generation advancement
release-owned service-control enable/re-enable
candidate release/supersession transitions that would make later release work admissible
normal maintenance provider dispatch
normal maintenance terminal success / lock release
```

If incident admission changed the mode/epoch first, the normal operation does not issue a new provider mutation and does not commit a normal terminal/canonical transition.

If an external provider mutation was already accepted before the incident fence rose, its provider side effect may complete, but normal release code may only retain diagnostic/provider receipts needed for reconciliation. It must not promote, canonicalize, release the active slot, advance deployment generation, enable learner service, or otherwise classify the operation as a normal success while mode is `INCIDENT`.

Those already-started effects become incident-reconciliation input bound to the snapshot/incident epoch.

A stale normal controller invocation cannot clear `INCIDENT` or reset the incident epoch.

---

# 5. Brokered emergency provider session — FROZEN

The emergency provider-mutation role is:

```text
name: fpllm-beta-emergency-break-glass
trust: fpllm-beta-break-glass-incident-broker only
human/GitHub direct assume-role trust: none
maximum session duration: 15 minutes
```

After and only after the durable incident admission transaction succeeds, the broker may mint one short-lived role session for the exact incident.

The brokered session is tagged/bound with at minimum:

```text
incidentId
protectedControlIncidentEpoch
incident actor/audit identity
resource-scope commitment/hash
```

The broker records the issued session identity, issuance time, expiration, and scope commitment in immutable/auditable incident history and monotonically updates:

```text
protectedStackIncidentLatestEmergencySessionExpiry
```

to the latest expiration among all issued sessions for the incident.

Session issuance is fail-closed if protected mode/incident ID/epoch changes between admission and STS issuance.

The emergency role is high privilege only within the reviewed emergency resource class needed to repair the protected stack. It does **not** receive authority to:

- write protected release-control/incident state directly;
- mark a candidate/build/promotion successful;
- clear service-control ownership;
- set maintenance mode `IDLE`;
- advance deployment generation as normal release evidence;
- mint another emergency session or assume arbitrary production roles.

Private-evaluator/learner-data secret access is not implied by infrastructure break-glass authority and remains excluded unless a separately reviewed incident scope explicitly requires it and the surrounding secrecy/evidence contract is amended or incident-qualified.

---

# 6. Closing emergency-session issuance — FROZEN

Before incident recovery can attempt `INCIDENT -> IDLE`, the broker/controller must first close emergency session issuance for that incident:

```text
protectedStackIncidentSessionIssueClosedAt = server timestamp
```

After this transition, the broker must reject any new emergency session for the incident unless incident recovery deliberately reopens issuance under a later monotonic recovery event while remaining `INCIDENT`.

Normal incident exit requires either:

1. all brokered emergency sessions are past their recorded STS expiration plus a fixed safety interval; or
2. a P1-proven provider mechanism has made every issued session unable to perform further provider mutation and independent verification confirms revocation.

For v0.5, **expiry is the baseline proof**. P1 may add a stronger revocation mechanism, but time before the recorded session expiration is not sufficient by itself.

No `INCIDENT -> IDLE` transition may occur while an emergency provider session can still issue an authorized mutation.

---

# 7. Break-glass incident recovery — REVISED

R23 incident recovery is generalized to support incidents whose origin is `BREAK_GLASS` and that did not originate from a normal maintenance operation.

The operator supplies only the existing `protectedStackIncidentId` plus a bounded recovery intent to the protected maintenance/incident recovery path. For a break-glass-origin incident there is no requirement that a pre-existing normal `maintenanceOperationId` existed before the incident.

The recovery controller resolves from protected state:

- incident ID and epoch;
- original/accumulated emergency actor audit identities;
- reason/resource-scope commitments;
- release snapshot taken at incident admission;
- all brokered emergency session identities/expirations;
- any pre-existing normal maintenance operation if the incident interrupted one;
- any active build/promotion/provider dispatch that existed when the fence rose;
- actual protected infrastructure and release-control state after emergency action.

Incident recovery must explicitly reconcile every release/provider operation captured by the admission snapshot or observed to have crossed the incident epoch. A provider side effect that completed after incident entry cannot be silently adopted as normal success; it must be classified by incident recovery and, where required by existing contracts, require rollback, new approval, or a P0 amendment.

`INCIDENT -> IDLE` is permitted only after all R23 exit predicates plus all of the following hold:

```text
incident ID/epoch still match
emergency session issuance is closed
all emergency sessions are expired/revoked under §6
no active normal release provider-dispatch lease can still mutate provider state
all release/provider effects crossing the incident epoch are reconciled
no affected release candidate/build/promotion remains falsely canonical/promoted
actual protected infrastructure and PROTECTED_EXECUTION_DEPLOYMENT agree with an accepted terminal identity
no maintenance-owned or release-owned service-control owner remains unresolved
activeLeaseAcquisitionId == null
no live lease-acquisition dispatch lease exists
no authoritative active learner lease exists
required post-incident health/security checks pass
```

If any predicate cannot be proved, mode remains `INCIDENT`.

For an incident opened from `IDLE` solely by break-glass, incident exit clears the server-generated incident identity only after the above proof. It does not fabricate a normal maintenance operation in historical evidence.

---

# 8. Detection of unsupported out-of-band mutation — FROZEN BOUNDARY

The brokered path above is the only supported emergency provider-mutation workflow for v0.5.

P1 must configure CloudTrail/audit monitoring over the protected mutation surface so a mutation by root, an unexpected principal, or a provider path outside the promotion/maintenance/break-glass principals is security-significant and triggers fail-closed incident response.

Because root/account-compromise authority cannot be made impossible by application IAM, detection is a recovery boundary rather than ordinary release evidence. On detection:

- learner/release operations are failed closed as soon as the incident fence is established;
- the event is not retroactively called a normal serialized maintenance operation;
- provider/release state is independently inventoried and reconciled;
- the event may require security incident handling, credential rotation, evidence invalidation, or P0/P1 requalification.

P1 must not claim that this detection path eliminates the physical possibility of root-level out-of-band mutation.

---

# 9. Protected Lambda quota correction — REVISED AGAIN

R23's five protected one-unit control Lambda reservations are superseded by addition of the break-glass incident broker.

The first P1 no-create admission report must prove capacity for **six** one-unit reserved-concurrency protected control Lambdas:

```text
fpllm-beta-candidate-admission             reserved concurrency 1
fpllm-beta-execution-release-broker       reserved concurrency 1
fpllm-beta-promotion-controller           reserved concurrency 1
fpllm-beta-maintenance-controller         reserved concurrency 1
fpllm-beta-lease-acquisition-controller   reserved concurrency 1
fpllm-beta-break-glass-incident-broker    reserved concurrency 1
```

Required project reservation total:

```text
6 concurrent executions
```

P1 must verify applied regional Lambda concurrency permits these six reservations while preserving AWS's required unreserved pool and all already-frozen application Lambda needs. Failure is a hard provisioning stop.

The break-glass broker requires protected release-control access and STS access to only the exact emergency role. It does not require Internet/NAT egress to issue AWS API calls through the selected AWS control-plane path; any net-new VPC endpoint/subnet/security-group requirement must be included in the first topology/quota admission report.

---

# 10. IAM and trust consequences — FROZEN

P1 effective-policy/trust evidence must prove at minimum:

```text
emergency human/operator
    -> may invoke break-glass incident broker
    -> cannot directly assume emergency provider role
    -> cannot write incident/release-control state

break-glass incident broker
    -> break-glass incident admission/session-history write authority only
    -> may AssumeRole only fpllm-beta-emergency-break-glass
    -> no normal release/build/promotion authority

fpllm-beta-emergency-break-glass
    -> trust broker principal only
    -> short-lived session <= 15m
    -> provider repair authority bounded to reviewed emergency resource class
    -> no incident/release-control state write
    -> no normal release evidence authority

normal release/build/promotion/maintenance controllers
    -> require maintenance mode IDLE + unchanged incident epoch before provider dispatch and terminal/canonical advancement
    -> cannot clear break-glass incident state

GitHub OIDC/web/worker/learner/evaluator principals
    -> cannot assume emergency role
    -> cannot invoke incident broker unless explicitly the authorized non-GitHub emergency operator path
```

---

# 11. Required P1 evidence additions

In addition to every earlier P1 gate, retain machine-readable evidence for:

1. break-glass broker Lambda timeout/reserved concurrency/caller and exact STS role policy;
2. emergency role trust policy proving direct human/GitHub assumption is denied and broker-only trust is effective;
3. atomic `IDLE -> INCIDENT` break-glass admission while release state is active, including server-generated incident ID and release snapshot;
4. race test: release claim wins immediately before incident admission, then release provider dispatch/terminalization must fail on incident mode/epoch;
5. race test: provider dispatch began before incident admission, then any completed side effect is reconciled as incident state and cannot become normal canonical/promoted success;
6. race test: incident admission wins first and later release authority grant fails;
7. break-glass during `ACTIVE` normal maintenance preserves the existing maintenance owner while entering `INCIDENT`;
8. brokered emergency session issuance occurs only after durable incident admission and is bound to exact incident ID/epoch/scope;
9. no `INCIDENT -> IDLE` transition occurs before latest emergency session expiry + safety interval (unless stronger independently verified revocation is implemented);
10. incident recovery reconciles every release/provider operation captured by the admission snapshot and every operation crossing the incident epoch;
11. six protected one-unit Lambda reservations fit applied regional quota while preserving required unreserved concurrency;
12. CloudTrail/audit monitoring identifies mutation of the protected surface by a principal outside the frozen promotion/maintenance/break-glass paths and routes it to fail-closed security incident handling.

---

# 12. Review-state boundary

Round 24 closes FPR24-01 at the decision/specification level only.

It does **not** claim the break-glass incident broker, emergency role trust, credential vending, incident-epoch checks, six Lambda reservations, CloudTrail detection, race tests, session-expiry enforcement, or production AWS evidence are implemented.

The resulting exact HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

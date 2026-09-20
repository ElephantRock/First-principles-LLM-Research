# Platform v0.5 — Maintainer Corrections Round 31 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer hardening baseline:** `5330038cf84047f60ada95c5c8b843a9a207eca6`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and pre-review hardening findings

Before treating R30 as an exact-head review candidate, the maintainer hardening pass found two P0 details that R30 left underspecified:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR31-01 | HIGH | R30 generalized `fpllm-beta-break-glass-incident-broker` into the incident-admission mediator and gave it an incident-fence PostgreSQL principal, but did not select the production network/authentication path by which that protected Lambda reaches the private RDS primary. R24 had previously stated that the broker did not need a VPC data-plane path. Leaving this to P1 would let implementation invent a privileged DB secret/network boundary after P0 was supposedly closed. | Freeze the mediator as a VPC-attached protected Lambda using private TCP/5432 access to the exact production RDS primary, IAM database authentication to one exact `fpllm_incident_fence` database role, and the already-required protected release-control access through a DynamoDB gateway endpoint. No database password is provisioned to the mediator; no Internet/NAT egress is required. Add the Lambda ENI/subnet/SG/RDS-IAM requirements to the first P1 topology/quota admission evidence. |
| FPR31-02 | HIGH | R30's protected admission identity was described as orchestration serialization only. During a `NORMAL_MAINTENANCE` escalation, or break-glass/audit admission while maintenance was `ACTIVE`, the maintenance controller could still dispatch/terminalize and clear `ACTIVE -> IDLE` after the admission slot was claimed but before R30 step 3 committed `INCIDENT`, defeating the requirement that the incident preserve the exact active maintenance owner/provider state. More generally, a broker crash after admission-slot claim could leave normal provider/release work progressing while incident admission was pending. | Make the durable active incident-admission slot a protected **pre-incident admission hold**. Every new normal release/build/promotion/maintenance provider dispatch and every normal terminal/canonical advancement must require that no admission hold exists. If maintenance is active, the hold atomically binds the exact maintenance operation/epoch and prevents normal maintenance dispatch, success/lock release, service re-enable, or `ACTIVE -> IDLE`; already-accepted provider effects remain reconciliation input. The hold is consumed only by the same exact incident admission and is terminalized after the learner fence is `ESTABLISHED`. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R31_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R30_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R29_v0.5.md
    > ...
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

Non-conflicting decisions remain in force.

---

# 1. Active incident-admission slot becomes a protected pre-incident hold — FROZEN

R30's durable incident-admission identity remains, but its authority is strengthened.

Protected release-control state contains at most one active admission slot:

```text
activeIncidentAdmissionId: string | null
incidentAdmissionOrigin: NORMAL_MAINTENANCE | BREAK_GLASS | AUDIT_DETECTED | null
incidentAdmissionRequestIdentity: string/hash | null
incidentAdmissionActorIdentity: string/hash | null
incidentAdmissionReasonScopeHash: sha256 | null
incidentAdmissionPhase:
    NONE
  | PREPARING_LEARNER_FENCE
  | LEARNER_RESERVED
  | INCIDENT_COMMITTED
incidentAdmissionMaintenanceOperationId: string | null
incidentAdmissionMaintenanceEpoch: integer | null
incidentAdmissionCreatedAt: server timestamp | null
```

Immutable admission history retains the completed identity after the active slot is cleared; the active slot is not itself the historical record.

The first-use admission transaction atomically requires no other active admission and writes the exact server-generated admission identity and origin commitments.

If protected maintenance mode is `ACTIVE`, the same transaction also binds:

```text
incidentAdmissionMaintenanceOperationId = exact active maintenanceOperationId
incidentAdmissionMaintenanceEpoch = exact active maintenance epoch
```

If mode is `IDLE`, those two fields are null.

An exact replay returns the same slot. A conflicting request cannot replace it.

---

# 2. The admission slot is a normal-provider/release hold — FROZEN

From the moment `activeIncidentAdmissionId != null`, every normal release/control-plane authority grant, provider dispatch, and normal terminal/canonical advancement must additionally require:

```text
activeIncidentAdmissionId == null
```

This is a pre-incident hold. It does not increment `protectedControlIncidentEpoch` and is not itself an `INCIDENT -> IDLE` state transition, but it is fail-closed for normal provider/release progression while the exact incident admission is being established.

At minimum the hold blocks new/next normal:

```text
candidate admission/supersession authority
protected build-attempt reservation
StartBuild dispatch authorization
build-result canonicalization
promotion claim/provider mutation/terminalization
protected deployment-generation advancement
release-owned service-control enable/re-enable
normal protected-stack maintenance claim/provider dispatch/terminal success
maintenance-owned service-control enable/re-enable
normal maintenance lock release / ACTIVE -> IDLE
```

An external provider operation already accepted before the hold may complete, but its output cannot become a normal terminal/canonical transition while the hold remains. It is recorded/reconciled by the same incident admission/recovery chain.

This hold is additional to all existing maintenance-mode, incident-epoch, build-slot, promotion-lock, service-control, and dispatch-lease predicates; it does not replace them.

---

# 3. Active-maintenance preservation across admission — FROZEN

When the admission slot binds an active maintenance operation, that exact maintenance owner is frozen for incident escalation.

While the slot is active:

```text
maintenanceOperationId == incidentAdmissionMaintenanceOperationId
maintenanceEpoch == incidentAdmissionMaintenanceEpoch
```

must remain true, and the maintenance controller cannot:

- issue a new provider mutation;
- classify the operation as normal success;
- release its maintenance lock;
- clear a matching maintenance-owned service-control owner;
- re-enable learner service as normal maintenance completion;
- transition `ACTIVE -> IDLE`.

If a provider call was accepted before the admission hold, it may complete but becomes incident-reconciliation input. The later protected `ACTIVE -> INCIDENT` transaction preserves the exact bound maintenance operation/epoch/plan/provider/service-control state plus the crossing provider result/receipt state.

A stale maintenance invocation cannot clear or overwrite the admission hold.

This closes the R30 window in which the origin maintenance operation could disappear between learner-fence reservation and protected incident allocation.

---

# 4. R30 admission phases and slot terminalization — FROZEN

R30's cross-store sequence is retained with explicit protected admission-phase advancement:

```text
1. claim active admission slot
   -> phase PREPARING_LEARNER_FENCE
   -> normal provider/release hold is active

2. PostgreSQL OPEN -> RESERVED under exact admission ID
   -> protected phase LEARNER_RESERVED after exact DB reconciliation

3. protected IDLE/ACTIVE -> INCIDENT under exact admission ID
   -> phase INCIDENT_COMMITTED
   -> incident ID/epoch allocated

4. PostgreSQL RESERVED -> FENCED with exact incident ID/epoch

5. protected learner-fence acknowledgement -> ESTABLISHED
   -> atomically terminalize the admission slot:
      activeIncidentAdmissionId = null
      phase = NONE
      append/retain immutable completed-admission history
```

`protectedStackIncidentAdmissionId` remains on the active incident after the admission slot is terminalized. Clearing the active admission slot is not clearing the incident.

If step 5 response is lost, exact replay first reconciles that the protected incident is `ESTABLISHED` and the immutable completed-admission identity exists before treating the active slot as terminal.

No active admission slot is cleared merely because a controller invocation timed out.

---

# 5. Existing-incident event append does not re-reserve the learner fence — FROZEN

R25/R26's append semantics remain in force.

If protected mode is already `INCIDENT` and PostgreSQL is already exact `FENCED` for that incident, a later `BREAK_GLASS` or `AUDIT_DETECTED` event is an append to the existing incident history. It does **not** attempt a new `OPEN -> RESERVED` transition, does not allocate a second incident epoch merely for the append, and does not clear/replace the existing learner fence.

If mode is `INCIDENT` but PostgreSQL is `RESERVED`, conflicting, or not yet exact `FENCED`, the mediator first recovers the active incident admission to `ESTABLISHED`; it cannot append a new event as a way to bypass unfinished learner-fence establishment.

---

# 6. Incident-admission mediator network and database authentication — SELECTED

R30's incident-admission mediator is the existing protected Lambda:

```text
fpllm-beta-break-glass-incident-broker
reserved concurrency: 1
timeout: <= 30 seconds
```

For R30/R31 learner-fence operations, its production placement is now frozen as:

```text
AWS region: eu-west-1
network: VPC-attached to the selected production VPC
subnets: private application/control subnets with no public IP
security group egress: TCP/5432 only to the exact production RDS security group,
                       plus AWS service endpoint traffic required below
Internet/NAT egress: not required and not selected for this Lambda
PostgreSQL target: authoritative production RDS primary endpoint only
read replica use for admission/fence decisions: forbidden
```

The RDS primary security group admits TCP/5432 from the incident-mediator security group only for this path. It does not admit the general Internet, GitHub runners, learner sandboxes, or evaluator containers.

R24's earlier statement that the incident broker did not require a VPC data-plane path is superseded for R30/R31. The broker still does not require Internet/NAT egress.

---

# 7. IAM database authentication for the incident-fence principal — SELECTED

The incident mediator does not receive a reusable PostgreSQL password secret.

Enable RDS PostgreSQL IAM database authentication for the production primary and create one exact database login/role:

```text
fpllm_incident_fence
```

The Lambda execution role receives only the exact `rds-db:connect` authority for that database user/resource identity. It generates a short-lived IAM database authentication token per bounded invocation and does not persist or log the token.

Database grants for `fpllm_incident_fence` permit only the R30/R31 learner-fence reserve/finalize/reconcile/reopen functions. The role has no direct ordinary learner table-write grants, no learner lease-claim authority, and no evidence/mastery/retry mutation authority.

R30's existing production-principal negative boundary remains:

- worker hosts/worker DB roles cannot assume or obtain the incident-fence DB identity;
- web application cannot use it;
- GitHub Actions cannot use it;
- learner/evaluator containers cannot use it.

If P1 proves the selected RDS engine/configuration cannot support this exact IAM-authenticated database boundary, provisioning stops and P0 must be amended; a static broad database password is not a silent fallback.

---

# 8. Protected-state AWS API path from the VPC-attached mediator — FROZEN

Because the same mediator must coordinate protected admission state and PostgreSQL, its VPC placement must not silently introduce NAT dependency.

The production VPC therefore includes a DynamoDB **gateway endpoint** on the route tables used by the mediator subnets, with endpoint/resource policy limited to the exact protected release-control/admission tables required by the mediator.

No Internet/NAT route is required for DynamoDB coordination.

The mediator does not require Secrets Manager for its database credential because R31 selects IAM database authentication. If a future implementation adds another AWS API dependency requiring an interface endpoint, that dependency must be included in the first P1 topology/cost/quota admission report before provisioning rather than silently enabling NAT.

---

# 9. Capacity and provider-limit consequences — FROZEN

R31 adds no new Lambda function and no new reserved concurrency unit.

P1's first read-only/no-create topology/quota admission report must additionally prove:

```text
incident mediator can attach to the selected private subnets/security group
sufficient subnet IP/ENI capacity exists for reserved concurrency 1 + Lambda platform needs
RDS IAM database authentication is supported/enabled for the exact PostgreSQL configuration
exact rds-db:connect resource identity can be constructed and policy-bounded
DynamoDB gateway endpoint is available/configurable on the selected route tables
RDS connection headroom includes at most one concurrent incident-mediator session
```

Any net-new monthly cost caused by required networking/provider resources must be included in the fresh exact-topology P1 cost estimate and remains subject to the existing USD 900/month stop/review threshold.

---

# 10. Audit-detected evidence boundary — CLARIFIED

For `AUDIT_DETECTED`, the offending provider mutation may have occurred before detection and therefore before the R31 admission hold and R30 learner-fence reservation.

R30/R31 guarantee that ordinary learner evidence cannot cross the committed database reservation and that normal provider/release progression is held from admission-slot claim onward. They do **not** retroactively prove that evidence committed before detection/reservation was unaffected by the already-occurred out-of-band mutation.

R24's security-incident boundary remains: incident recovery must independently classify the affected time/resource interval and may require evidence invalidation, learner replay/requalification, credential rotation, or P0/P1 requalification. Pre-reservation evidence is not automatically trusted merely because it linearized before `OPEN -> RESERVED`.

---

# 11. Required P1 evidence additions

P1 must prove, in addition to every earlier gate:

1. `activeIncidentAdmissionId` is globally exclusive and exact-idempotent across all new incident origins;
2. every normal release/build/promotion/maintenance authority grant, provider dispatch, and normal terminal/canonical advancement rejects while an admission hold is active;
3. when maintenance is `ACTIVE`, admission-slot claim binds the exact maintenance operation/epoch and later normal maintenance dispatch/success/lock-release/`ACTIVE -> IDLE` attempts fail;
4. an already-accepted maintenance/provider call may complete but cannot become normal canonical success after the admission hold and is reconciled by the incident path;
5. admission phase advances monotonically `PREPARING_LEARNER_FENCE -> LEARNER_RESERVED -> INCIDENT_COMMITTED -> terminal`, and slot terminalization occurs only after exact learner-fence `ESTABLISHED` acknowledgement;
6. completed admission history remains immutable after the active slot clears, while `protectedStackIncidentAdmissionId` remains bound to the incident;
7. a later event during an already-established incident appends without attempting a new learner-fence reservation or second incident epoch;
8. the incident mediator is VPC-attached to the selected private subnets with SG egress to only the exact RDS SG on TCP/5432 plus selected AWS service endpoints;
9. RDS admits the mediator SG and rejects unauthorized network sources;
10. `fpllm_incident_fence` uses IAM database authentication and the mediator role has only exact `rds-db:connect` authority for that DB user/resource;
11. the incident DB role can call only reserve/finalize/reconcile/reopen functions and cannot directly create learner ownership/evidence/mastery/retry state;
12. worker/web/GitHub/evaluator identities cannot obtain the incident DB identity/token or call its privileged functions;
13. the DynamoDB gateway endpoint/policy lets the mediator reach only required protected state without NAT/Internet egress;
14. first P1 topology/quota evidence includes Lambda ENI/subnet IP capacity, RDS IAM-auth support, RDS connection headroom, and endpoint availability;
15. an `AUDIT_DETECTED` drill distinguishes the guaranteed post-reservation fence from potentially affected pre-detection evidence and exercises the required invalidation/requalification decision path.

---

# 12. Review-state boundary

Round 31 closes FPR31-01 and FPR31-02 at the decision/specification level only.

It does **not** claim VPC attachment, RDS IAM authentication, database roles/functions, DynamoDB endpoint policy, admission-hold predicates, maintenance-race tests, audit evidence invalidation, or production AWS state are implemented.

The resulting exact HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh independent exact-HEAD second opinion
   (Codex when quota is available; project quota-fallback review otherwise)
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

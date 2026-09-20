# Platform v0.5 — Maintainer Corrections Round 25 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `9e73db14032c8c1ab10255c52ae8b380bb67d7e7`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and maintainer findings

A fresh maintainer review of R24 found three decision-level defects that must be corrected before the exact-head independent review gate:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR25-01 | HIGH | R24 §4 correctly intended incident-epoch fencing, but its literal `protectedStackMaintenanceMode == IDLE` precondition was also listed for normal maintenance provider dispatch and maintenance terminalization. A legitimate maintenance operation is `ACTIVE` while those actions occur, so the rule was internally contradictory. | Split the incident fence by authority class: normal release/build/promotion work requires `IDLE`; normal maintenance work requires the exact `ACTIVE` maintenance owner/epoch/plan and unchanged incident epoch; incident/break-glass recovery requires the exact `INCIDENT` owner/epoch. Any transition to `INCIDENT` invalidates normal release and normal maintenance progress. |
| FPR25-02 | HIGH | R24 durably recorded an emergency STS session only after `AssumeRole` returned. A broker crash or lost response after STS accepted the request could therefore leave a live but unrecorded emergency credential, allowing incident recovery to believe no session remained and clear `INCIDENT` before the credential expired. | Reserve a durable emergency-session logical attempt and conservative possible-expiry bound before every external `AssumeRole`; fence the external call with a dispatch lease that outlives the broker invocation; never repeat an ambiguous STS issuance attempt; and block incident exit through the conservative expiry + safety interval unless a stronger revocation proof exists. |
| FPR25-03 | MEDIUM | R24 committed a reviewed emergency resource-scope hash, but a hash alone does not constrain what the brokered STS credential can modify if the base role is broader than the selected repair scope. | Freeze a server-owned bounded emergency repair-profile registry. The broker resolves the requested profile, commits its exact policy hash, and supplies a server-generated restrictive STS session policy. Caller-supplied IAM/session policy text is prohibited. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R25_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R24_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R23_v0.5.md
    > ...
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

Non-conflicting decisions remain in force.

---

# 1. Incident-epoch fencing is authority-specific — CORRECTED

R24 §4 is superseded where it requires `protectedStackMaintenanceMode == IDLE` for normal maintenance provider dispatch or maintenance terminalization.

Every protected operation that can mutate an external provider or advance durable canonical/terminal control state must still bind the incident epoch it observed when that operation acquired authority:

```text
expectedProtectedControlIncidentEpoch
```

The required mode/owner predicate depends on the authority class.

## 1.1 Normal release/build/promotion authority

Candidate admission/supersession, protected build reservation/dispatch/canonicalization, promotion provider mutation, deployment-generation advancement, release-owned service-control transition, and normal promotion terminalization require immediately before the relevant external call or durable advancement:

```text
protectedStackMaintenanceMode == IDLE
protectedStackIncidentId == null
protectedControlIncidentEpoch == expectedProtectedControlIncidentEpoch
exact existing candidate/build/promotion/deployment owner predicates still hold
```

If an incident fence rises after the operation acquired authority, a stale normal release controller may retain diagnostic/provider receipts but cannot issue a new provider mutation or advance normal canonical/terminal release state.

## 1.2 Normal maintenance authority

A reviewed normal maintenance operation is expected to run while maintenance mode is `ACTIVE`.

Immediately before normal maintenance provider dispatch, provider retry/reconciliation that can cause mutation, service-control advancement, or normal maintenance terminal success/lock release, the maintenance controller must prove:

```text
protectedStackMaintenanceMode == ACTIVE
protectedStackMaintenanceOperationId == exact operation ID
protectedStackMaintenanceEpoch == exact maintenance epoch
protectedStackMaintenancePlanHash == exact approved plan hash
protectedStackIncidentId == null
protectedControlIncidentEpoch == operation's expected incident epoch
exact maintenance provider-dispatch/service-control predicates still hold
```

If break-glass or another security event converts `ACTIVE -> INCIDENT`, these predicates fail. The former normal maintenance path may no longer continue as ordinary maintenance success; its provider state becomes incident-reconciliation input.

## 1.3 Incident and break-glass recovery authority

Incident recovery is not authorized by either the `IDLE` normal-release predicate or the `ACTIVE` normal-maintenance predicate. It requires instead:

```text
protectedStackMaintenanceMode == INCIDENT
protectedStackIncidentId == exact incident ID
protectedControlIncidentEpoch == exact incident epoch
exact incident/recovery owner predicates still hold
```

Incident recovery cannot use its authority to create a normal build/promotion/maintenance success retroactively.

## 1.4 Crossing the incident epoch

For all authority classes, a provider effect accepted before an incident fence rose may complete externally, but after the epoch changes it cannot be made normal canonical/terminal state by the stale authority. The effect must be reconciled under the incident owner before ordinary admission resumes.

P1 must make the mode/epoch checks part of the same durable authorization transition that fences each later external call or state advancement wherever the underlying provider API cannot participate in the transaction.

---

# 2. Emergency STS session attempts are reserved before issuance — FROZEN

R24 §5 is superseded where it records a session only after successful `AssumeRole` response.

The protected incident record gains bounded emergency-session-attempt history with at minimum:

```text
incidentSessionRequestId
incidentSessionAttemptId
incidentId
incidentEpoch
repairProfileId
repairProfilePolicyHash
roleSessionName
state: RESERVED | DISPATCHING | ISSUED | AMBIGUOUS | EXPIRED_OR_REVOKED
reservedAt
requestedDurationSeconds
possibleExpiryAt
stsSessionArn: string | null
stsAccessKeyIdHash: sha256 | null
stsIssuedAt: timestamp | null
stsActualExpiryAt: timestamp | null
dispatchEpoch: integer
dispatchLeaseExpiresAt: timestamp | null
```

Secrets returned by STS are never persisted in the incident table or logs.

`incidentSessionRequestId` is globally/idempotently bound to one incident/session attempt and one immutable repair profile. A replay with a different payload is rejected.

## 2.1 Pre-issuance reservation

Before any external `AssumeRole` call, the broker transactionally reserves exactly one logical session attempt while proving:

```text
protectedStackMaintenanceMode == INCIDENT
protectedStackIncidentId == exact incident ID
protectedControlIncidentEpoch == exact incident epoch
session issuance is not closed
no conflicting live dispatch exists for this request/attempt
repair profile is valid for this incident
```

The broker server-generates a unique `incidentSessionAttemptId` and `roleSessionName` and records:

```text
state = RESERVED
requestedDurationSeconds <= 900
possibleExpiryAt = serverNow + requestedDurationSeconds + configured clock-skew allowance
```

The same transaction monotonically advances:

```text
protectedStackIncidentLatestEmergencySessionExpiry
```

to at least `possibleExpiryAt` **before STS is called**.

Therefore an accepted-but-unrecorded STS session is conservatively represented by the incident exit bound even if its response is lost.

## 2.2 Dispatch lease around `AssumeRole`

Immediately before `AssumeRole`, the broker claims a durable session-dispatch epoch/lease:

```text
state = DISPATCHING
dispatchEpoch = previous + 1
dispatchLeaseExpiresAt = serverNow + 60 seconds
```

with frozen timing:

```text
broker Lambda timeout          <= 30 seconds
STS client timeout             <= 10 seconds
minimum remaining invocation   >= 15 seconds before a new STS call
session dispatch lease         60 seconds
```

The dispatch lease therefore outlives any authorized broker invocation that could have made that exact STS call.

While the dispatch lease can still belong to a live invocation:

- session issuance cannot be classified `AMBIGUOUS`/terminal;
- incident session issuance cannot be closed in a way that permits incident exit;
- `INCIDENT -> IDLE` is prohibited.

## 2.3 Successful response

If STS returns successfully, the broker conditionally records against the exact incident/request/attempt/dispatch epoch:

```text
state = ISSUED
stsSessionArn = exact returned session ARN
stsAccessKeyIdHash = hash(returned access-key identifier)
stsIssuedAt = server timestamp / provider-correlated issuance time
stsActualExpiryAt = exact returned expiration
dispatchLeaseExpiresAt = null
```

and keeps `protectedStackIncidentLatestEmergencySessionExpiry` at the maximum of its current value, `possibleExpiryAt`, and `stsActualExpiryAt`.

The credential itself is returned only to the authenticated emergency caller through the protected broker response path and is never logged or written to ordinary application persistence.

## 2.4 Lost response or broker crash after possible acceptance

AWS STS `AssumeRole` is treated as a non-idempotent external issuance API for this contract. If the broker cannot durably prove whether the reserved call returned a credential, the attempt becomes `AMBIGUOUS` only after its dispatch lease is stale.

An ambiguous attempt is **never re-issued with the same `incidentSessionRequestId` or attempt ID**. Recovery retains `possibleExpiryAt` as a live-credential upper bound and blocks incident exit until:

```text
serverNow > possibleExpiryAt + fixed safety interval
```

or a stronger P1-proven revocation mechanism independently proves that any credential from that attempt can no longer mutate provider state.

If operators need another emergency credential while the first attempt is ambiguous, they must create a new bounded session request/attempt while the same incident remains open. The new attempt receives its own pre-reserved possible-expiry bound, and the incident-level latest expiry remains the maximum across all attempts.

No absence of an STS response, process death, Lambda timeout, or CloudTrail propagation delay is by itself proof that no session was issued.

---

# 3. Session issuance closure and incident exit — STRENGTHENED

R24 §6–§7 remain in force with these additional predicates.

Closing emergency session issuance is a durable transition that requires:

```text
protectedStackMaintenanceMode == INCIDENT
exact incident ID/epoch
no live emergency-session dispatch lease
```

After issuance is closed, no `RESERVED` attempt may newly acquire dispatch authority.

`INCIDENT -> IDLE` additionally requires every emergency-session attempt to be one of:

```text
ISSUED and past stsActualExpiryAt/possibleExpiryAt + safety interval
AMBIGUOUS and past possibleExpiryAt + safety interval
EXPIRED_OR_REVOKED under independently verified stronger revocation evidence
```

and requires no `RESERVED` or `DISPATCHING` attempt capable of later issuing a credential.

The incident-level latest-expiry field is a conservative summary only. Recovery must reconcile the per-attempt records as well; corruption or inconsistency fails closed.

---

# 4. Emergency repair profiles constrain the credential — FROZEN

R24's resource-scope commitment is retained but made enforceable.

P1 must define a small server-owned registry of reviewed emergency repair profiles. Each profile contains at minimum:

```text
repairProfileId
allowed incident reason classes
allowed AWS actions
allowed resource ARN patterns / explicit resource identities
required session tags
maximum duration <= 900 seconds
canonical STS session-policy document
sha256(canonical session-policy document)
```

The caller may select only a published `repairProfileId` allowed for the incident reason/resource class. The caller cannot supply:

- IAM policy JSON;
- arbitrary AWS actions;
- arbitrary resource ARNs;
- session duration above the profile maximum;
- an alternate role ARN;
- arbitrary session tags.

Before session-attempt reservation, the broker resolves the selected profile from trusted configuration, validates it against the incident's committed resource-scope class, and stores its exact policy hash.

The subsequent `AssumeRole` call must use the server-generated restrictive session policy and server-generated tags. The effective emergency session authority is therefore the intersection of:

```text
base fpllm-beta-emergency-break-glass role policy
AND
server-selected repair-profile session policy
```

A scope hash without the matching restrictive session policy is insufficient evidence.

Any emergency repair need that cannot fit a frozen profile is a security/P0 amendment event rather than permission to broaden the broker dynamically.

---

# 5. Unsupported out-of-band mutation gets a durable incident path — CLARIFIED

R24 §8 remains a detection/recovery boundary, but P1 may not stop at an alert that leaves maintenance mode `IDLE`.

The same protected incident broker supports a second bounded action:

```text
OPEN_AUDIT_DETECTED_INCIDENT
```

callable only by the frozen protected audit-detection principal/path. It accepts only provider audit-event identity/hash, detected principal identity, bounded affected-resource descriptor/hash, and reason classification. It cannot request or receive an emergency STS credential.

On a qualifying protected-surface mutation by a principal outside the frozen promotion/maintenance/break-glass paths, this action atomically establishes or appends to durable `INCIDENT` state with:

```text
protectedStackIncidentOrigin = AUDIT_DETECTED
protectedControlIncidentEpoch = previous + 1 when opening a new incident
release snapshot at admission
immutable offending audit-event identity/hash
```

If mode is already `ACTIVE`, it converts the exact maintenance owner to `INCIDENT` without fabricating maintenance success. If mode is already `INCIDENT`, it appends the audit event to that incident rather than replacing the owner.

The audit-detection principal cannot assume the emergency provider role, cannot write release state directly, and cannot clear incidents. Repair credentials, if later needed, still require a separately authorized emergency operator and the R24/R25 session-attempt protocol.

This mechanism does not claim that out-of-band root mutation can be prevented before detection. It ensures that once the frozen detector classifies such an event, the response establishes a durable fail-closed incident fence rather than only emitting an alert.

---

# 6. Protected control-plane quota — UNCHANGED FROM R24

R24's six one-unit reserved-concurrency control Lambdas remain the selected P0 envelope:

```text
fpllm-beta-candidate-admission             1
fpllm-beta-execution-release-broker       1
fpllm-beta-promotion-controller           1
fpllm-beta-maintenance-controller         1
fpllm-beta-lease-acquisition-controller   1
fpllm-beta-break-glass-incident-broker    1
```

The audit-detection path reuses the break-glass incident broker's bounded incident-admission action and does not add a seventh project Lambda in this round. Any implementation topology that requires another reserved Lambda must update the P1 quota evidence and, if it changes the frozen envelope materially, amend P0.

---

# 7. Required P1 evidence additions

In addition to every earlier gate, P1 must retain machine-readable evidence proving:

1. normal release/build/promotion provider dispatch and terminal/canonical advancement require `IDLE` + unchanged incident epoch;
2. normal maintenance provider dispatch and terminalization require exact `ACTIVE` maintenance owner/epoch/plan + null incident ID + unchanged incident epoch, not `IDLE`;
3. converting `ACTIVE -> INCIDENT` prevents a stale maintenance controller from issuing a later provider call or committing normal maintenance success;
4. an emergency session logical attempt and conservative `possibleExpiryAt` are durable before the first STS `AssumeRole` call;
5. the emergency-session dispatch lease outlives every authorized broker invocation and blocks incident exit while live;
6. a forced crash/lost response immediately after provider acceptance leaves an `AMBIGUOUS` attempt whose conservative possible expiry prevents early incident exit;
7. the same ambiguous session request/attempt is never re-issued;
8. incident exit reconciles every per-attempt session record and cannot rely only on the summary latest-expiry field;
9. emergency operator and GitHub principals cannot directly assume `fpllm-beta-emergency-break-glass`;
10. broker STS calls use only server-owned repair-profile session policies/tags and a caller cannot inject policy/action/resource/role parameters;
11. effective session-policy tests show each repair profile can perform its intended bounded repair and is denied outside its frozen resource/action class;
12. protected audit detection can atomically establish/append durable `AUDIT_DETECTED` incident state and incident epoch without obtaining emergency provider credentials;
13. a detected out-of-band mutation causes later normal release provider dispatch/terminalization to fail on mode/incident-epoch fencing;
14. the six protected Lambda reservations and all endpoint/network dependencies still fit the first P1 no-create quota/topology report.

---

# 8. Review-state boundary

Round 25 closes FPR25-01 through FPR25-03 at the decision/specification level only.

It does **not** claim authority-specific incident predicates, emergency-session attempt persistence, STS dispatch fencing, session-policy enforcement, audit-detected incident admission, IAM trust, quota availability, race tests, or production AWS evidence are implemented.

The resulting exact HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

# Platform v0.5 — Maintainer Corrections Round 26 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `8331a6d3b38e90b5184cebb7459dcd72b1b7f6dc`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and final maintainer timing review

A second exact-candidate maintainer pass over R24–R25 found three remaining precision defects before independent review:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR26-01 | HIGH | R25 reserved `possibleExpiryAt` from the reservation timestamp. If the broker waits before the external `AssumeRole`, an accepted-but-unrecorded credential can expire later than that bound. | At the dispatch transaction, before STS is called, advance the conservative bound to at least `dispatchLeaseExpiresAt + 900s + clock-skew/safety allowance` and advance the incident-level latest expiry in the same transaction. |
| FPR26-02 | HIGH | R24/R25 could issue an emergency repair credential immediately after incident admission even when a pre-incident normal provider call was already in flight against the same protected resource class. The stale normal call is forbidden from canonicalizing success but can still complete externally, racing the emergency repair. | Incident admission remains immediate, but ordinary emergency repair-session dispatch waits until every captured/observed overlapping normal provider dispatch is no longer live and its provider operation has reached an exact reconciled terminal state. No v0.5 “race the provider” repair profile is selected. |
| FPR26-03 | MEDIUM | R24/R25 used `DurationSeconds <= 900`, but AWS STS `AssumeRole` has a documented minimum `DurationSeconds` of 900 seconds. Values below 900 are invalid. | Freeze v0.5 emergency `AssumeRole` duration to exactly 900 seconds. |

Provider fact source for FPR26-03: AWS STS `AssumeRole` API reference, `DurationSeconds` valid range minimum 900 seconds: <https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html>.

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R26_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R25_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R24_v0.5.md
    > ...
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

Non-conflicting decisions remain in force.

---

# 1. Emergency STS duration — EXACT

For v0.5 the broker requests exactly:

```text
DurationSeconds = 900
```

for `fpllm-beta-emergency-break-glass`.

R24/R25 wording that permits an arbitrary duration `<= 900` is superseded. The caller does not supply the duration. Repair profiles may not lower or raise it for v0.5.

The emergency role's configured maximum session duration may be greater than 900 seconds as required by AWS role configuration semantics, but the broker request itself is exactly 900 seconds and P1 evidence must show the effective issued expiration matches that request within provider semantics.

---

# 2. Conservative possible-expiry bound is fixed at dispatch — CORRECTED

R25 §2.1 may retain an initial reservation-time provisional expiry for diagnostics, but that value is **not** sufficient for ambiguous-session safety.

Immediately before an external `AssumeRole`, the same durable transaction that claims the session dispatch lease must write:

```text
state = DISPATCHING
dispatchEpoch = previous + 1
dispatchLeaseExpiresAt = serverNow + 60 seconds
requestedDurationSeconds = 900
possibleExpiryAt = max(
    existing possibleExpiryAt,
    dispatchLeaseExpiresAt + 900 seconds + configured clock-skew/safety allowance
)
protectedStackIncidentLatestEmergencySessionExpiry = max(
    current incident summary,
    possibleExpiryAt
)
```

The transaction also retains all R25 exact incident/request/attempt/repair-profile predicates.

Because:

```text
broker Lambda timeout <= 30 seconds
session dispatch lease = 60 seconds
```

no authorized broker invocation belonging to that dispatch epoch can first issue the STS call after the recorded dispatch lease expiry. Using `dispatchLeaseExpiresAt + 900s + allowance` therefore conservatively upper-bounds the expiration of a credential that might have been accepted but whose response was lost.

The external STS call is prohibited unless this durable dispatch transaction commits successfully.

If STS returns an actual expiration later than the conservative bound because a provider assumption proves different from the frozen timing model, the broker must persist the later actual expiration, keep the incident fenced, and treat the mismatch as a P1 defect/P0-requalification signal rather than shortening the bound.

---

# 3. No emergency repair races an overlapping pre-incident provider mutation — FROZEN

Incident admission remains intentionally immediate and does **not** wait for release quiescence. That property is required to raise the fence promptly.

Emergency credential issuance is stricter.

Before the broker may reserve or dispatch an emergency repair session attempt, it must resolve the incident admission snapshot plus current protected provider-dispatch journals and prove one of the following for every normal release/maintenance provider operation that was live or ambiguous when the incident epoch rose:

```text
A. operation is terminal and exactly reconciled, with no caller/dispatch lease able to issue a later provider mutation;
OR
B. operation's provider/resource scope is independently proven disjoint from the selected emergency repair profile's effective resource/action scope.
```

For v0.5, **A is the default**. A repair session is not issued merely because the stale normal controller can no longer commit canonical state.

If an overlapping provider mutation has been accepted and is still executing, queued, retryable by a live dispatch owner, or otherwise non-terminal/ambiguous, ordinary emergency repair credential issuance waits fail-closed while `INCIDENT` remains durable.

No v0.5 repair profile is selected that intentionally races an overlapping in-flight protected provider mutation. A future “immediate containment despite overlap” capability would require an explicit P0 amendment defining the orthogonal control surface, conflict model, and evidence.

The broker stores the reconciliation decision used to authorize issuance:

```text
incidentSessionAttemptId
selected repairProfileId/policyHash
set/hash of pre-incident provider operation identities examined
terminal/disjoint classification for each
reconciliation timestamp/evidence references
```

A stale or newly discovered overlapping provider operation invalidates session-dispatch authorization until reconciled again.

This precondition applies to both `BREAK_GLASS` and `AUDIT_DETECTED` incidents before a human emergency repair session is minted.

---

# 4. Audit-detected incident identity — EXPLICIT

R25 extends the incident-origin enum explicitly to:

```text
NORMAL_MAINTENANCE | BREAK_GLASS | AUDIT_DETECTED | null
```

For `OPEN_AUDIT_DETECTED_INCIDENT`, the provider audit event's stable event identity plus canonical event hash is globally/idempotently bound:

- exact replay of the same event identity/hash returns the existing incident/event record;
- the same event identity with a different hash is rejected and itself treated as an integrity defect;
- a new event while `INCIDENT` appends to immutable incident history without replacing the incident owner or decrementing the incident epoch.

The detector path still cannot mint or receive emergency credentials.

---

# 5. Required P1 evidence additions

In addition to every earlier gate, P1 must prove:

1. broker `AssumeRole` requests use exactly `DurationSeconds=900` and caller input cannot change it;
2. the session-dispatch transaction advances `possibleExpiryAt` and incident latest expiry **before** the STS call to at least `dispatchLeaseExpiresAt + 900s + allowance`;
3. a forced delay between reservation and dispatch cannot make an ambiguous credential outlive the conservative incident-exit bound;
4. a forced crash immediately after STS acceptance but before response persistence remains fenced through the conservative bound;
5. incident admission can occur while a provider dispatch is active, but emergency repair-session issuance is denied until every overlapping pre-incident provider operation is terminal/reconciled and no stale dispatch lease/caller can mutate later;
6. a provider operation proven disjoint from a selected repair profile may satisfy the disjointness exception only through machine-verifiable resource/action-scope evidence;
7. no selected v0.5 repair profile permits deliberate overlap with a non-terminal protected provider mutation;
8. `AUDIT_DETECTED` is an explicit incident origin and audit-event identity/hash replay is idempotent/integrity checked;
9. the six protected Lambda reservation/topology envelope remains unchanged and still passes the first P1 no-create admission report.

---

# 6. Review-state boundary

Round 26 closes FPR26-01 through FPR26-03 at the decision/specification level only.

It does **not** claim STS timing, provider-dispatch overlap reconciliation, repair-profile disjointness, audit-event idempotency, IAM enforcement, quota availability, race tests, or production AWS evidence are implemented.

The resulting exact HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

# Platform v0.5 — Maintainer Corrections Round 29 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Independent maintainer-review baseline:** `57cf0a0d11c29ce72c17b679284aba4cf1def456`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and maintainer-first exact-head finding

The fresh maintainer-first exact-head review of `57cf0a0d11c29ce72c17b679284aba4cf1def456` found one remaining P0 race in R28:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR29-01 | HIGH | R28 required the lease-acquisition controller and learner result/evidence terminalization to prove protected `IDLE` / no incident / unchanged `protectedControlIncidentEpoch` immediately before a PostgreSQL ownership or evidence transaction. Protected incident state and PostgreSQL are different transactional domains, so an incident could commit after that check but before the PostgreSQL transaction committed. That could create a lease or ordinary learner evidence after the protected incident fence had risen. | Add one PostgreSQL-local learner incident-fence singleton and a crash-recoverable broker admission protocol. The broker first raises the protected provider/release incident fence and allocates the exact incident epoch, then establishes the same incident identity/epoch in PostgreSQL using one bounded autocommit fence operation. Lease acquisition and every canonical learner evidence/result/mastery transaction serialize on that database-local singleton. The database fence is the linearization boundary for learner ownership/evidence: either the learner transaction commits first and is ordered before the learner fence, or the fence commits first and the learner transaction cannot acquire/terminalize normally. Ambiguous cross-store admission remains fail-closed and is reconciled by exact incident identity before any ordinary authority resumes. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R29_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R28_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R27_v0.5.md
    > ...
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

Non-conflicting decisions remain in force.

---

# 1. Two incident fences with one incident identity — FROZEN

R24–R28's protected incident state remains authoritative for provider/release/control-plane authority. R29 adds a PostgreSQL-local fence solely for learner lease ownership and learner evidence canonicalization.

The production PostgreSQL primary contains exactly one protected learner-fence singleton with at least:

```text
learnerFenceState: OPEN | FENCED
learnerFenceIncidentEpoch: non-negative integer
learnerFenceIncidentId: string | null
learnerFenceAdmissionId: string | null
learnerFenceUpdatedAt: server timestamp
```

Invariant:

```text
learnerFenceState == OPEN
    => learnerFenceIncidentId == null

learnerFenceState == FENCED
    => learnerFenceIncidentId != null
       and learnerFenceAdmissionId != null
```

`learnerFenceIncidentEpoch` is monotonic and is never decremented. When open after recovery, it remains equal to the latest protected `protectedControlIncidentEpoch`; it is not reset to zero.

The PostgreSQL singleton is not a second general incident authority. It exists because the authoritative learner jobs/results/evidence are committed in PostgreSQL and therefore require a fence that can participate in the same database transaction. Provider/release authority continues to use the protected control-plane incident state.

The same server-generated incident ID, incident-admission ID, and incident epoch bind both domains.

---

# 2. Incident admission becomes a crash-recoverable cross-store protocol — FROZEN

A supported `BREAK_GLASS`, `AUDIT_DETECTED`, or other R24–R28 incident admission must establish the protected provider/release fence **before** it can be treated as an established learner fence.

The protected break-glass incident broker remains the bounded mediator for break-glass/audit incident admission. Normal-maintenance incident entry uses the same learner-fence establishment subprotocol whenever learner evidence must be fenced.

## 2.1 Protected admission reservation / provider-release fence

The protected-state transaction first establishes or appends the exact incident according to the governing R24–R28 origin rules and atomically records at minimum:

```text
protectedStackMaintenanceMode = INCIDENT
protectedControlIncidentEpoch = previous + 1 when this is a new incident epoch
protectedStackIncidentId = exact server-generated incident ID
protectedStackIncidentAdmissionId = server-generated unique admission ID
protectedStackIncidentLearnerFenceState = PENDING
protectedStackIncidentLearnerFenceExpectedEpoch = exact protectedControlIncidentEpoch
```

For an idempotent replay of the same incident/admission identity, the exact existing values are reused. A different request cannot replace them.

From the moment this protected transaction commits:

- all new normal release/build/promotion/maintenance authority grants remain blocked by the existing `INCIDENT` predicates;
- no new learner lease-acquisition dispatch may be granted;
- no emergency provider-mutation credential may be issued (the initial v0.5 mutating registry remains empty under R28 in any event);
- the broker/controller proceeds only with learner-fence establishment or exact recovery of that establishment.

`PENDING` is therefore fail-closed. It is not `IDLE`, release-normal, or evidence that the PostgreSQL learner fence has already committed.

## 2.2 PostgreSQL learner-fence establishment

The broker/controller then invokes one narrowly permissioned PostgreSQL operation as one bounded autocommit statement/function call.

That operation:

1. locks the learner-fence singleton;
2. verifies that the requested `incidentAdmissionId`, `incidentId`, and incident epoch are internally valid inputs for a monotonic fence transition;
3. conditionally changes the singleton from the exact prior open epoch to:

```text
learnerFenceState = FENCED
learnerFenceIncidentEpoch = exact protected incident epoch
learnerFenceIncidentId = exact incident ID
learnerFenceAdmissionId = exact incident-admission ID
learnerFenceUpdatedAt = database server timestamp
```

4. returns the exact committed fence identity.

The operation uses the same server-side bounded execution discipline as the lease-claim protocol: no client-held `BEGIN ... COMMIT` interval is allowed around the authoritative fence update.

An exact-idempotent replay of the same admission ID/incident ID/epoch returns the committed fence. A conflicting identity or epoch is rejected and leaves the database fail-closed/current state unchanged.

## 2.3 Protected establishment acknowledgement

Only after the authoritative PostgreSQL primary proves the exact learner fence committed may protected incident state advance:

```text
protectedStackIncidentLearnerFenceState = ESTABLISHED
protectedStackIncidentLearnerFenceEstablishedAt = server timestamp / receipt metadata
```

If the database call times out, the broker/controller does not guess. Protected mode remains `INCIDENT` with learner-fence state `PENDING`; release/provider/new-acquisition authority remains blocked. Recovery queries the authoritative PostgreSQL primary by the exact admission ID/incident ID/epoch before retrying or changing protected state.

If PostgreSQL proves the exact fence committed, recovery records `ESTABLISHED`. If PostgreSQL proves it did not commit and no original database invocation can still commit, the same exact admission identity may be retried. A different admission identity is not minted merely because the response was lost.

---

# 3. PostgreSQL is the learner-transaction linearization boundary — FROZEN

R28's wording that a protected-state read “immediately before” PostgreSQL is sufficient is superseded.

Every database operation that creates or extends authoritative learner-job ownership or canonicalizes learner results/evidence must serialize on the PostgreSQL learner-fence singleton inside the **same database transaction** as the learner mutation.

The required local predicate is:

```text
learnerFenceState == OPEN
learnerFenceIncidentId == null
learnerFenceIncidentEpoch == expected learner/lease incident epoch
```

The learner transaction must lock/read the singleton in a way that makes the fence update and the learner mutation linearly ordered in PostgreSQL.

Therefore exactly one of two orderings wins:

```text
learner transaction commits first
-> it is ordered before the learner incident fence
-> incident fence commits afterward
```

or:

```text
learner incident fence commits first
-> learner transaction observes FENCED / epoch mismatch
-> ordinary acquisition/renewal/terminalization cannot commit
```

There is no valid ordering in which a learner transaction observes the old open fence, an incident fence commits, and the learner transaction later publishes ordinary authoritative state without re-serializing against the fence.

The protected incident epoch remains useful for cross-system provenance and release/control-plane fencing, but a remote DynamoDB read is not treated as an atomic substitute for the PostgreSQL-local predicate.

---

# 4. Learner lease acquisition under the database fence — REVISED

R23's lease-acquisition controller remains the only production principal/database role allowed to perform `QUEUED -> LEASED`.

The R22 single autocommit PostgreSQL ownership operation is extended so it also locks/checks the learner-fence singleton and atomically persists:

```text
leaseAcquisitionId
leaseWorkerIdentity
leaseServiceControlEpoch
leaseProtectedControlIncidentEpoch
leaseOwnedAt
```

with:

```text
leaseProtectedControlIncidentEpoch == learnerFenceIncidentEpoch
learnerFenceState == OPEN
```

The controller still must pass all protected acquisition-slot/dispatch/service-control predicates before issuing SQL. The PostgreSQL fence is an additional mandatory boundary, not a replacement for protected acquisition authorization.

R28 §1's stronger claim that protected incident admission itself makes any already-authorized-but-not-yet-issued PostgreSQL statement impossible is narrowed to the actual linearizable contract:

- if the PostgreSQL lease transaction commits before the learner fence, the lease is validly ordered before the learner fence but becomes stale for ordinary result/evidence terminalization once the incident fence is established;
- if the learner fence commits first, the lease transaction cannot create ownership;
- after the protected incident reservation is `PENDING`, no **new** acquisition dispatch authority may be granted, so only a bounded pre-fence controller operation can win the first ordering.

Incident recovery still treats any such pre-fence committed lease as an active learner lease until it expires or reaches the incident-quarantine disposition.

---

# 5. Lease renewal/stage advancement cannot extend a stale incident lease — FROZEN

Any production operation that renews `leaseExpiresAt`, advances an already-owned job execution stage, or otherwise extends authoritative learner ownership must execute in PostgreSQL under the same learner-fence row lock/predicate.

If the fence is `FENCED` or its epoch differs from the lease's `leaseProtectedControlIncidentEpoch`:

- the lease is not renewed or extended;
- no next ordinary execution stage is made authoritative;
- the worker may finish already-running local compute only as diagnostic work;
- the bounded incident-quarantine path owns the durable disposition/release of that stale job.

This prevents an incident-crossing worker from repeatedly extending a stale lease and delaying the zero-active-lease recovery condition.

---

# 6. Result/evidence/mastery terminalization under the database fence — REVISED

Every PostgreSQL transaction that makes learner execution authoritative—including at minimum submission/test-run terminal state, public/hidden evidence rows, memory-experiment canonical results, retry-budget consequence, mastery evidence, and journal-eligible evidence publication—must lock/check the learner-fence singleton in the same transaction and require:

```text
learnerFenceState == OPEN
learnerFenceIncidentId == null
learnerFenceIncidentEpoch == leaseProtectedControlIncidentEpoch
exact leaseAcquisitionId / lease owner / job / submission identity still match
lease remains unexpired under the frozen lease rules
```

If the fence wins first or the epoch/lease identity is stale, the ordinary learner transaction aborts without partially canonicalizing results, retry consequences, or mastery.

No API/service path may canonicalize learner evidence outside this database-enforced boundary merely because it performed a prior protected-state check.

R28's quarantine semantics remain fully in force.

---

# 7. Incident-quarantine disposition — FROZEN

The incident-quarantine transition is a trusted database mutation distinct from ordinary learner result terminalization.

It is allowed only for an exact job/lease whose incident epoch is stale or whose current learner fence is `FENCED`, and it must atomically:

```text
record diagnostic incident ID / incident epoch / exact lease identity
set the job/test-run diagnostic disposition to INFRASTRUCTURE_INCIDENT_QUARANTINED or equivalent
clear leaseOwner / leaseExpiresAt so the stale lease is no longer active
preserve immutable source / execution correlation needed for later replay
record no learner pass/fail/mastery consequence
consume no learner retry budget
publish no ordinary public/hidden evaluator evidence
```

The exact enum/storage layout remains P1 detail, but these transactional effects are not optional.

The worker may request this disposition for an already-owned job, but the production database privilege boundary must prevent it from choosing an arbitrary incident identity, rewriting ordinary evidence, or quarantining a job/lease it does not exactly own. A narrowly permissioned stored procedure/function or bounded persistence controller is preferred.

If the worker disappears before requesting quarantine, lease expiry remains a safe fallback; incident recovery/replay reconciles the exact stale job after the lease is no longer active. No expired stale job may become ordinary evidence without a fresh post-recovery lease under the ordinary immutable-source rules.

---

# 8. Incident exit and reopening learner work — REVISED

`INCIDENT -> IDLE` remains subject to every R23–R28 recovery predicate. R29 additionally requires exact agreement between protected incident state and the PostgreSQL learner fence.

Before learner service can resume, recovery must prove:

```text
protected incident ID/epoch/admission ID are exact and reconciled
protectedStackIncidentLearnerFenceState == ESTABLISHED
PostgreSQL learner fence is FENCED with the same incident ID/epoch/admission ID
no authoritative active learner lease exists
no live/unresolved lease-acquisition dispatch exists
no ordinary learner terminalization can still commit under a pre-fence database transaction
all other R23–R28 provider/release/session/service-control recovery predicates pass
```

Reopening is fail-closed and ordered:

1. keep protected mode `INCIDENT` and new acquisition authority blocked;
2. use one bounded PostgreSQL autocommit operation to reopen the learner fence only for the exact reconciled incident identity while retaining `learnerFenceIncidentEpoch == protectedControlIncidentEpoch` and clearing the incident ID/admission ID;
3. reconcile/read back the exact open database fence;
4. only then may the protected incident recovery transaction clear incident ownership to `IDLE` and make ordinary service-control/leasing eligibility available under the existing rules.

If the process fails after database reopen but before protected `IDLE`, protected mode remains `INCIDENT`, so no acquisition dispatch or normal release authority can be granted. Recovery either verifies the exact reopened fence and completes the same incident exit or re-fences it under the same incident identity before any other transition. It never manufactures a new incident epoch merely to hide an ambiguous exit.

Because stale leases retain an older `leaseProtectedControlIncidentEpoch`, reopening the database fence at the current epoch cannot make an incident-crossing stale lease eligible for ordinary terminalization.

---

# 9. Database authority and secrets — FROZEN

P1 must create a database authority boundary sufficient to enforce the learner fence independently of application convention.

At minimum:

```text
incident-fence writer principal
    -> may call only the exact learner-fence establish/reopen/reconcile operations
    -> cannot create learner evidence, mastery, or queued-job ownership

lease-acquisition controller principal
    -> may perform the exact lease claim only while the learner fence is OPEN at the expected epoch
    -> cannot alter the learner-fence singleton

worker / learner-evidence persistence principal(s)
    -> may advance/terminalize only exact owned leases under the OPEN matching fence
    -> cannot alter the learner-fence singleton
    -> cannot bypass the fence through direct table writes
```

The incident-fence database credential/identity is not present on worker hosts, learner/evaluator containers, GitHub Actions, or the web application.

Direct table grants/triggers/row-level constraints or stored-procedure privilege design must make bypass of the singleton predicate impossible for the production principals that persist learner ownership/evidence.

---

# 10. Required P1 evidence additions

P1 must prove, in addition to every earlier gate:

1. the PostgreSQL learner-fence singleton exists with monotonic epoch and exact incident/admission identity;
2. protected incident reservation enters fail-closed `INCIDENT`/learner-fence `PENDING` before any database fence attempt and blocks all new release/provider/acquisition authority;
3. the learner-fence establishment operation is one bounded autocommit database operation with exact-idempotent replay/reconciliation;
4. an accepted-but-unrecorded database fence is recovered by exact incident-admission identity rather than guessed/reissued under a new identity;
5. lease acquisition and canonical terminalization both serialize on the same PostgreSQL learner-fence row inside their authoritative database transactions;
6. race: lease/evidence transaction wins first -> commit is ordered before the learner fence, then incident fence establishes and later stale work cannot terminalize normally;
7. complementary race: learner fence wins first -> no lease ownership or ordinary evidence/mastery transaction may commit afterward;
8. stale lease stage advancement/renewal cannot extend lease expiry after the fence/epoch changes;
9. incident-quarantine disposition clears the exact stale lease and records diagnostics without learner retry/mastery/pass/fail consequence;
10. no production worker/web/GitHub/evaluator principal can mutate or bypass the learner-fence singleton;
11. incident exit proves exact protected/PostgreSQL incident identity agreement and zero active leases before reopening learner service;
12. crash after database reopen but before protected `IDLE` remains fail-closed and is reconciled under the same incident identity;
13. R28's empty `mutatingEmergencyRepairProfiles`, absence of a mutating emergency provider role, and broker `sts:AssumeRole` denial remain true.

---

# 11. Review-state boundary

Round 29 closes FPR29-01 at the decision/specification level only.

It does **not** claim the PostgreSQL learner-fence singleton, database principals/functions, cross-store incident-admission reconciliation, lease renewal fence, quarantine transaction, IAM/database denies, race tests, or production state are implemented.

The resulting exact HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

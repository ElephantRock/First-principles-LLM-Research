# Platform v0.5 — Maintainer Corrections Round 30 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Independent quota-fallback second-opinion baseline:** `afdc98ba22eaaee6ecdfc9545767f91fda7b57d6`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and exact-head second-opinion finding

The fresh independent exact-head second-opinion review of `afdc98ba22eaaee6ecdfc9545767f91fda7b57d6`, performed under the project's Codex-quota fallback rule, found one remaining P0 race in R29:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR30-01 | HIGH | R29 made the PostgreSQL learner-fence row the learner transaction linearization point, but protected incident admission still happened before the database fence was established. During `INCIDENT` + learner-fence `PENDING`, a fresh ordinary terminalization could still begin while the database fence was `OPEN` and win the row-lock ordering; an already-started learner transaction could also hold the fence row for an unbounded client-managed transaction lifetime because R29 did not freeze the whole authoritative evidence/mastery mutation as one server-bounded autocommit operation. For an audit-detected or break-glass incident this can permit ordinary learner evidence to canonicalize after the system has already committed the protected incident. | Make learner-fence reservation the first authoritative learner-side step of incident admission. Generalize the existing protected incident broker as the single admission mediator without adding another Lambda: it serializes an admission identity, atomically reserves the PostgreSQL learner fence `OPEN -> RESERVED`, then commits protected `IDLE/ACTIVE -> INCIDENT`, then finalizes the exact database reservation `RESERVED -> FENCED`. Every ordinary learner ownership-extension or evidence/mastery mutation that contends on the learner fence must itself be one server-bounded autocommit statement/function call. Thus a learner mutation can only linearize before the database reservation and complete within the frozen server bound, or observe `RESERVED/FENCED` and fail ordinary canonicalization. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R30_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R29_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R28_v0.5.md
    > ...
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

Non-conflicting decisions remain in force.

---

# 1. One serialized incident-admission mediator — FROZEN

R24's existing protected control Lambda remains deployed and keeps its existing initial-beta no-provider-mutation boundary from R28:

```text
fpllm-beta-break-glass-incident-broker
reserved concurrency: 1
provider-mutation credential authority: none for initial v0.5
```

R30 generalizes this already-reserved Lambda as the **single incident-admission mediator** for every incident origin that must fence learner ownership/evidence, including:

```text
BREAK_GLASS
AUDIT_DETECTED
NORMAL_MAINTENANCE escalation to INCIDENT
```

This does **not** add a seventh protected Lambda or change R19/R24's six-unit protected-Lambda reservation total.

The maintenance controller may request a normal-maintenance incident admission from this mediator, but it does not independently write the learner-fence reservation or bypass the admission protocol below.

For each new incident admission the mediator server-generates one globally unique:

```text
incidentAdmissionId
```

and binds it to the exact origin request identity/event identity and bounded reason/scope commitments. Exact replay reuses the same admission identity. A conflicting payload under an existing request identity is rejected.

Only one nonterminal incident admission may exist at a time. A later request cannot replace or bypass the active admission.

---

# 2. PostgreSQL learner-fence state machine — REVISED

R29's learner-fence singleton is extended from two states to three:

```text
learnerFenceState: OPEN | RESERVED | FENCED
learnerFenceIncidentEpoch: non-negative integer
learnerFenceIncidentId: string | null
learnerFenceAdmissionId: string | null
learnerFenceOrigin: NORMAL_MAINTENANCE | BREAK_GLASS | AUDIT_DETECTED | null
learnerFenceUpdatedAt: database server timestamp
```

Required invariants:

```text
OPEN
    => learnerFenceIncidentId == null
       and learnerFenceAdmissionId == null
       and learnerFenceOrigin == null

RESERVED
    => learnerFenceIncidentId == null
       and learnerFenceAdmissionId != null
       and learnerFenceOrigin != null

FENCED
    => learnerFenceIncidentId != null
       and learnerFenceAdmissionId != null
       and learnerFenceOrigin != null
```

`learnerFenceIncidentEpoch` remains monotonic and is never decremented. While `RESERVED`, it retains the last committed incident epoch; the next exact epoch is attached only after the protected incident transition allocates it.

`RESERVED` is fail-closed for every ordinary learner lease acquisition, lease renewal/stage advancement, result/evidence/mastery terminalization, retry consequence, and journal-eligible evidence publication. It is not ordinary service and it is not evidence that the protected incident transaction has already committed.

---

# 3. Incident admission ordering — REVISED

R29's protected-first learner-fence establishment order is superseded. The selected cross-store protocol is now:

```text
1. serialize exact incidentAdmissionId in the protected incident-admission mediator
2. PostgreSQL learner fence: OPEN -> RESERVED
3. protected control plane: IDLE/ACTIVE -> INCIDENT and allocate exact incident ID/epoch
4. PostgreSQL learner fence: RESERVED -> FENCED with that exact incident ID/epoch
5. protected incident state acknowledges learner fence ESTABLISHED
```

The database reservation is deliberately first because PostgreSQL is the authoritative learner ownership/evidence store. Once the reservation commits, no new ordinary learner transaction can canonicalize across the pending incident.

The protected `INCIDENT` transition remains the authoritative provider/release/control-plane fence. Release/provider activity that commits before step 3 is ordered before the protected incident and is captured/reconciled by the existing incident release snapshot and crossing-operation rules. Learner ownership/evidence has already been blocked by step 2 before that protected transition is attempted.

There is no supported cancellation path after step 2. Once the database learner-fence reservation commits, recovery must complete or reconcile the same incident admission identity; it may not silently reopen learner service merely because a later protected-state write failed or timed out.

---

# 4. Step 1 — admission identity serialization — FROZEN

Before touching PostgreSQL, the incident mediator establishes one durable admission identity bound to the origin request/event.

This admission identity is an orchestration reservation, not yet the provider/release incident fence. It exists to prevent two incident origins from independently reserving PostgreSQL or allocating conflicting incident identities.

The reservation records at minimum:

```text
incidentAdmissionId
origin
origin request/event identity + canonical hash
requested/observed actor identity
reason/scope commitment hashes
admission phase = PREPARING_LEARNER_FENCE
server timestamp
```

A second admission request cannot proceed while this reservation is nonterminal except as exact replay or as an immutable event that will later append to the already-created incident after the active admission completes.

The mediator's reserved concurrency 1 is defense in depth; correctness depends on the durable admission identity/phase, not Lambda scheduling alone.

---

# 5. Step 2 — learner-fence reservation is one bounded autocommit operation — FROZEN

The incident-fence database principal performs exactly one narrowly permissioned PostgreSQL statement/function call that:

1. locks the learner-fence singleton;
2. verifies it is exactly `OPEN` at the expected last incident epoch;
3. verifies no conflicting admission identity is already present;
4. atomically writes:

```text
learnerFenceState = RESERVED
learnerFenceAdmissionId = exact incidentAdmissionId
learnerFenceOrigin = exact origin
learnerFenceIncidentId = null
learnerFenceIncidentEpoch = unchanged last committed epoch
learnerFenceUpdatedAt = database server timestamp
```

5. returns the exact committed reservation identity.

The reservation operation is one autocommit server operation. No client-held `BEGIN ... COMMIT` interval is allowed around it.

Exact replay of the same admission identity/origin returns the existing reservation. A different admission identity while `RESERVED` or `FENCED` is rejected.

After this operation commits, all ordinary learner mutation functions reject because the local state is no longer `OPEN`.

---

# 6. Step 3 — protected incident transition after learner reservation — FROZEN

Only after the authoritative PostgreSQL primary proves the exact `RESERVED` admission identity may the incident mediator commit the protected incident transaction.

For a new incident from `IDLE`, the protected transaction atomically performs the governing R24–R29 admission semantics and additionally requires the same exact active `incidentAdmissionId`, then records at minimum:

```text
protectedStackMaintenanceMode = INCIDENT
protectedControlIncidentEpoch = previous + 1
protectedStackIncidentId = server-generated incident ID
protectedStackIncidentAdmissionId = exact incidentAdmissionId
protectedStackIncidentLearnerFenceState = RESERVED
protectedStackIncidentLearnerFenceExpectedEpoch = exact new protectedControlIncidentEpoch
incident origin/request/event commitments
release/provider snapshot required by the governing incident-origin rules
```

For a normal maintenance escalation from `ACTIVE`, the same transaction preserves the exact maintenance owner/epoch/plan/provider/service-control identity while entering `INCIDENT` and allocating the new incident epoch.

For an exact replay, the existing incident ID/epoch/admission identity are reused. A conflicting protected incident identity leaves the system fail-closed and enters incident-reconciliation handling; it does not rewrite the PostgreSQL reservation under a new identity.

Once this transaction commits, all existing R24–R29 protected provider/release incident-mode/epoch fences apply.

---

# 7. Step 4/5 — finalize and acknowledge the learner fence — FROZEN

After protected `INCIDENT` state is durable, the mediator invokes one bounded PostgreSQL autocommit operation that requires:

```text
learnerFenceState == RESERVED
learnerFenceAdmissionId == exact protectedStackIncidentAdmissionId
learnerFenceOrigin == exact protected incident origin
```

and atomically writes:

```text
learnerFenceState = FENCED
learnerFenceIncidentEpoch = exact protectedControlIncidentEpoch
learnerFenceIncidentId = exact protectedStackIncidentId
learnerFenceAdmissionId = unchanged exact admission ID
learnerFenceOrigin = unchanged exact origin
learnerFenceUpdatedAt = database server timestamp
```

Exact replay returns the existing `FENCED` identity. A conflicting incident ID/epoch/origin is rejected without broadening authority or reopening learner work.

Only after the authoritative PostgreSQL primary proves this exact `FENCED` state may protected incident state advance:

```text
protectedStackIncidentLearnerFenceState = ESTABLISHED
protectedStackIncidentLearnerFenceEstablishedAt = server timestamp / receipt metadata
```

---

# 8. Crash and response-loss recovery — FROZEN

The cross-store protocol is monotonic and exact-idempotent.

Recovery rules:

```text
PREPARING_LEARNER_FENCE + PostgreSQL OPEN
    -> retry the same exact reservation operation

PREPARING/RESERVED admission + PostgreSQL RESERVED
    -> do not reopen; complete the same protected INCIDENT admission

protected INCIDENT + PostgreSQL RESERVED
    -> finalize RESERVED -> FENCED using the exact protected incident ID/epoch

protected INCIDENT + PostgreSQL FENCED exact match
    -> acknowledge ESTABLISHED if not already acknowledged

protected INCIDENT + PostgreSQL conflicting identity
    -> remain INCIDENT/fail-closed and require protected incident reconciliation;
       never rewrite the database fence by guessing a replacement identity
```

A timeout never causes a new admission ID to be minted merely because a response was lost.

No recovery path may clear `RESERVED` back to `OPEN` without first completing the exact incident and later passing the ordinary R29/R30 `INCIDENT -> IDLE` recovery/reopen protocol.

---

# 9. Every ordinary learner mutation that contends on the fence is server-bounded — FROZEN

R22 already requires new lease acquisition to be one server-bounded autocommit PostgreSQL operation. R30 extends the same correctness property to every ordinary learner mutation that creates, extends, or canonicalizes authoritative learner state.

At minimum the following must each execute as one autocommit SQL statement or one server-side function invoked as one statement:

```text
QUEUED -> LEASED ownership acquisition
lease renewal / leaseExpiresAt extension
execution-stage advancement that extends authoritative ownership
submission/test-run terminalization
public/hidden evidence canonicalization
memory-experiment canonical result persistence
retry-budget consequence
mastery evidence/state mutation
journal-eligible learner evidence publication
```

A single server-side function may atomically update multiple PostgreSQL tables; the prohibition is on a client holding the learner-fence row across a client-managed transaction boundary.

For these ordinary learner mutation paths, production database/session policy must enforce at minimum:

```text
statement_timeout <= 5 seconds
lock_timeout <= 2 seconds
idle_in_transaction_session_timeout <= 5 seconds   # defense in depth
```

The first two bounds apply to the authoritative server operation. `idle_in_transaction_session_timeout` is not the primary correctness mechanism because the production contract forbids a client-held authoritative transaction around the learner-fence predicate.

Therefore a mutation that wins the learner-fence row immediately before incident reservation can complete only within the bounded server operation and is linearly ordered before the `OPEN -> RESERVED` reservation. Once `RESERVED` commits, a later ordinary mutation cannot observe an admissible `OPEN` fence and cannot canonicalize ordinary learner state.

---

# 10. Quarantine under RESERVED/FENCED — REVISED

R29's incident-quarantine semantics remain, but the bounded trusted quarantine mutation is explicitly allowed when the learner fence is `RESERVED` or `FENCED` for an exact stale/incident-crossing lease.

The quarantine operation itself must be one bounded autocommit server operation and must atomically:

```text
verify exact job/lease ownership identity
verify RESERVED or FENCED state makes ordinary continuation inadmissible
record the exact available admission/incident diagnostics
clear lease ownership/expiry
preserve immutable replay/source correlation
record no learner pass/fail/mastery consequence
consume no retry budget
publish no ordinary public/hidden evaluator evidence
```

When the fence is only `RESERVED`, the diagnostic may record the admission ID/origin before the protected incident ID/epoch has been allocated; later reconciliation may attach the exact incident identity without converting the quarantined work into ordinary evidence.

A worker cannot choose an arbitrary admission/incident identity or quarantine a lease it does not exactly own.

---

# 11. Incident exit and learner reopen — RETAINED WITH STATE UPDATE

R29's fail-closed exit order remains authoritative with `RESERVED` added as a non-open state.

`INCIDENT -> IDLE` cannot begin unless the PostgreSQL learner fence is exactly `FENCED` and matches the protected incident ID/epoch/admission ID. A `RESERVED` fence means incident admission/finalization is incomplete and must be recovered first.

After every existing provider/release/session/service-control/active-lease predicate passes, learner reopen remains:

1. protected mode stays `INCIDENT` and new acquisition authority remains blocked;
2. one bounded PostgreSQL autocommit operation changes the exact matching `FENCED` row to `OPEN`, retaining the latest monotonic incident epoch and clearing incident/admission/origin identity;
3. reconcile/read back the exact `OPEN` row;
4. only then may the protected incident recovery transaction clear protected incident ownership to `IDLE`.

Stale leases still carry an older incident epoch and cannot become ordinary terminalization authority merely because the database fence later reopens.

---

# 12. Database authority consequences — FROZEN

R29's database privilege split remains and is tightened:

```text
incident-admission database principal
    -> may call only learner-fence reserve/finalize/reconcile/reopen operations
    -> cannot create/extend learner ownership
    -> cannot create ordinary learner evidence/mastery/retry consequence

lease-acquisition controller principal
    -> may perform the exact bounded lease-claim operation only under OPEN matching fence
    -> cannot reserve/finalize/reopen the learner fence

worker / learner-evidence persistence principal(s)
    -> may invoke only bounded ownership-extension/terminalization/quarantine operations
    -> cannot directly write learner-fence state
    -> cannot bypass OPEN/RESERVED/FENCED predicates through direct table writes
```

The incident-admission database credential remains absent from worker hosts, learner/evaluator containers, GitHub Actions, and the web application.

Direct table grants, function ownership, triggers/constraints, and/or row-level controls must make bypass of these server operations impossible for the production principals that persist learner state.

---

# 13. Required P1 evidence additions

P1 must prove, in addition to every earlier gate:

1. the learner-fence singleton implements exact `OPEN | RESERVED | FENCED` invariants;
2. all learner-fencing incident origins are serialized through one exact incident-admission identity and no separate maintenance/break-glass/audit path can bypass it;
3. `OPEN -> RESERVED` is one bounded autocommit PostgreSQL operation and exact replay is idempotent;
4. after `RESERVED` commits, a newly started ordinary learner ownership/evidence/mastery operation cannot canonicalize;
5. race: ordinary learner mutation locks first -> it completes or aborts within the frozen server bound, then reservation commits;
6. complementary race: reservation locks first -> ordinary learner mutation observes non-`OPEN` state and fails ordinary canonicalization;
7. forced client/process stall cannot hold the learner-fence row beyond the authoritative server-operation bound because no client-managed transaction is permitted;
8. crash after database `RESERVED` but before protected `INCIDENT` remains learner-fail-closed and completes the same exact incident admission on retry;
9. crash after protected `INCIDENT` but before database `FENCED` remains fully fail-closed and exact-idempotently finalizes the same reservation;
10. accepted-but-unrecorded reserve/finalize responses are reconciled by exact admission/incident identity rather than by generating a new identity;
11. every ordinary lease renewal/stage/evidence/mastery/retry/journal mutation is one bounded autocommit statement/function and enforces the learner-fence predicate locally;
12. quarantine is permitted under exact `RESERVED/FENCED` stale-lease conditions, clears ownership, and has no learner consequence;
13. no worker/web/GitHub/evaluator principal can reserve/finalize/reopen or directly bypass the learner-fence state machine;
14. `INCIDENT -> IDLE` refuses a `RESERVED` learner fence and requires exact `FENCED` protected/database identity reconciliation before reopen;
15. the protected Lambda reservation total remains six, and R28's empty mutating emergency registry/no emergency mutating role/no broker `sts:AssumeRole` path remain unchanged.

---

# 14. Review-state boundary

Round 30 closes FPR30-01 at the decision/specification level only.

It does **not** claim the `RESERVED` learner-fence state, generalized incident-admission mediator actions, bounded learner terminalization functions, database grants, timeout policy, race tests, crash recovery, or production state are implemented.

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

# Platform v0.5 — Maintainer Corrections Round 8 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `490ccfb1f8976ecde64edecafafa2e04176e74cf`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and independent findings register

The continued exact-HEAD maintainer-first review of round 7 found three state-machine/replay defects before any new Codex request:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR8-01 | HIGH | Scoping broker idempotency to `(approvalId, requestId)` does not prevent a replay from migrating to a later active candidate: after the pointer changes, the same `requestId` can be paired with the new approval and appear new. | Bind each broker `requestId` globally to exactly one approval on first use; every replay resolves that immutable binding before any active-candidate action. |
| FPR8-02 | MEDIUM | Candidate admission generates `approvalId` server-side but had no mandatory admission idempotency key. A lost synchronous response/retry could create an accepted candidate whose identity the approver did not receive cleanly. | Require a bounded `admissionRequestId`, atomically map it to the generated approval, and return the existing approval on replay. |
| FPR8-03 | HIGH | Active-slot replacement treated `overall state = promoted` as terminal, but the earlier promotion contract only guaranteed a separate promotion-state transition. The active slot could therefore remain non-terminal after a successful deployment unless P1 invented an extra transition. | Freeze the successful promotion state transaction: canonical `overall state = promoted`, `promotion state = promoted`, and conditional active-slot release after smoke/reconciliation. |

This review remains maintainer-first; Codex has not been asked to review round 7/8 yet.

Precedence inside the P0 record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R8_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R7_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R6_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R5_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R4_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R3_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

---

# 1. Broker request identity is globally bound to one approval

Round 7 §1.3 is superseded where it says request-id idempotency is merely scoped to the resolved `approvalId`.

The release-control table contains a broker idempotency record keyed **only** by the bounded opaque `requestId`:

```text
BROKER_REQUEST#<requestId>
  approvalId
  createdAt
  lastDisposition
  relevant component/build identities
```

Maximum `requestId`: 128 UTF-8 bytes. It is an idempotency identity only; it contains no release authority.

## 1.1 First invocation

For a previously unseen `requestId`, the broker transaction:

1. reads/resolves `ACTIVE_EXECUTION_CANDIDATE`;
2. verifies that candidate is eligible;
3. conditionally creates `BROKER_REQUEST#<requestId>` bound to that exact `approvalId` if absent;
4. only then performs/reconciles actions for that bound approval.

Concurrent first uses of the same request ID can create at most one binding.

## 1.2 Replay

For an existing request record, the broker **does not re-resolve the active pointer as authority for a new candidate**. It loads the permanently bound `approvalId` and returns/reconciles only that approval's existing disposition.

If that approval is now superseded, promoted, failed-locked, or no longer active, replay returns the durable terminal/non-action disposition and cannot start work for a later approval.

The same `requestId` therefore never names two approvals.

For the low-volume v0.5 beta, broker request-id records are retained through P7/release freeze; no TTL-based reuse is allowed during the beta release lineage.

---

# 2. Candidate admission is idempotent before approvalId generation

The candidate-admission request now requires:

```text
admissionRequestId: opaque caller-generated idempotency token
```

Maximum length: 128 UTF-8 bytes.

The token carries no trusted actor or release input semantics. It exists only so an approver can safely retry a timed-out/ambiguous synchronous Lambda invocation.

The admission function transaction maintains:

```text
ADMISSION_REQUEST#<admissionRequestId>
  approvalId
  action = admit | supersede_and_admit
  createdAt
  disposition
```

## 2.1 New request

For an unseen `admissionRequestId`, the server:

1. validates the bounded immutable candidate input schema;
2. generates the new `approvalId`;
3. performs the active-slot admission/supersession transaction from round 7;
4. creates the admission-idempotency mapping in the **same transaction**.

Either all state commits or none does.

## 2.2 Replay

For an existing `admissionRequestId`, the function returns the already-bound `approvalId`/disposition and never creates or supersedes a second candidate.

If the retried payload differs materially from the hash of the original bounded immutable request, the replay fails with an idempotency-conflict diagnostic rather than silently returning success for different input.

The mapping therefore stores a canonical request SHA-256 over the normalized bounded admission payload.

Admission idempotency records are retained through P7 for v0.5.

---

# 3. Promotion terminal transition and active-slot release — FROZEN

Promotion remains a protected non-GitHub operation over one canonical built candidate.

Before infrastructure mutation, promotion revalidates the round-6/7 canonical state and creates/uses its own bounded protected promotion operation identity so retry can reconcile partial completion.

The operational order is:

```text
verify built canonical candidate + compatibility gate
-> drain/pause as required
-> apply exact canonical worker/evaluator digests through protected authority
-> smoke/reconcile actual worker/runtime state
-> only after successful verification, commit release-control terminal state
```

## 3.1 Successful promotion state transaction

After actual infrastructure state is verified, one conditional release-control transaction requires:

```text
candidate approvalId == ACTIVE_EXECUTION_CANDIDATE.approvalId
candidate overall state == built
candidate promotion state in {not_promoted, promoting}
canonical digests still equal the promoted infrastructure identities
```

and atomically writes:

```text
candidate overall state = promoted
candidate promotion state = promoted
candidate promotedAt = server timestamp
candidate promoted worker/evaluator digest identities = canonical existing digests
ACTIVE_EXECUTION_CANDIDATE.approvalId = null
```

No new digest value is accepted from the operator as authority during this transaction.

## 3.2 Partial failure and retry

If infrastructure mutation succeeds but the release-control transaction fails, the operation is not blindly repeated. The protected promotion path first reconciles actual worker/hidden-evaluator deployment identity against the canonical candidate. If they match, it may retry only the terminal-state transaction; if they do not match, promotion fails closed and requires operator investigation/rollback under the existing compatibility/evidence rules.

If infrastructure smoke fails and rollback restores the prior production pair, the candidate remains `built`/not promoted and the active slot remains occupied until a later retry or explicit trusted supersession.

This makes the active-slot lifecycle executable rather than documentary.

---

# 4. Updated failure/concurrency invariants

P1 tests must prove:

- a broker `requestId` first bound to approval A cannot act on approval B after the active slot changes;
- concurrent first use of one broker request ID results in one immutable approval binding;
- an admission timeout followed by the same `admissionRequestId` returns the original approval rather than creating a second candidate;
- the same admission idempotency key with materially different input is rejected;
- the active slot is not released merely because image builds succeeded;
- successful promotion clears the active slot only after canonical infrastructure identity is smoke/reconciled;
- a lost final promotion-state write is recoverable by reconciliation without redeploying a different digest;
- failed smoke/rollback leaves the candidate non-promoted and does not open the slot to an unrelated release accidentally.

---

# 5. Review-state boundary

Round 8 closes FPR8-01 through FPR8-03 at the decision/specification level. It does not claim the idempotency mappings, promotion reconciliation, or DynamoDB transactions are implemented.

The resulting exact HEAD must pass CI and receive a **fresh exhaustive maintainer re-review** before Codex is asked for another independent second opinion.

# Platform v0.5 — Maintainer Corrections Round 9 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `45f732e8aa131d7ecf5d5c2d76692dda7c446a8d`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and independent findings register

The fresh maintainer re-review of the round-8 candidate found one remaining release-state ambiguity before another Codex request:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR9-01 | HIGH | Round 8 introduced a protected promotion operation identity but did not freeze how that identity is bound to one approval or how concurrent/lost-response promotion requests behave. After promotion A clears the active slot, a replayed operation identity could otherwise be interpreted against a later candidate B; two different promotion identities could also race the same built candidate before the terminal transaction. | Globally bind each promotion request ID to one approval and canonical digest set, claim one active promotion identity on the candidate before infrastructure mutation, make same-ID replay idempotent, reject different-ID concurrency, and define terminal replay/rollback behavior. |

This is maintainer-first discovery. No new Codex review has been requested against round 8.

Precedence inside the P0 record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R9_v0.5.md
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

# 1. Promotion request identity is globally bound to one approval

Round 8 §3 is tightened as follows.

Every protected promotion attempt requires a bounded opaque:

```text
promotionRequestId
```

Maximum length: **128 UTF-8 bytes**.

The release-control table retains one immutable idempotency record keyed only by that identity:

```text
PROMOTION_REQUEST#<promotionRequestId>
  approvalId
  platformSourceSha
  workerDigest
  hiddenEvaluatorDigest
  evaluatorBaseDigest
  createdAt
  disposition
  lastReconciledAt
```

The three digest values are copied only from canonical broker-recorded candidate state. They are not caller-selected release authority.

Promotion-request records are retained through P7/release freeze; no ID reuse is allowed within the v0.5 release lineage.

---

# 2. First-use promotion claim is atomic

Before any worker/runtime infrastructure mutation, the protected promotion path performs one conditional release-control transaction that requires:

```text
ACTIVE_EXECUTION_CANDIDATE.approvalId == candidate.approvalId
candidate overall state == built
candidate promotion state == not_promoted
candidate activePromotionRequestId == null
all three canonical component digests are non-null
```

and atomically:

1. creates `PROMOTION_REQUEST#<promotionRequestId>` bound to that exact approval and canonical digest set if absent;
2. writes `candidate promotion state = promoting`;
3. writes `candidate activePromotionRequestId = promotionRequestId`;
4. records a server timestamp for the promotion claim.

A different promotion request ID cannot claim the same candidate while it is already `promoting`.

Concurrent first use of one promotion request ID can create at most one binding.

The operator cannot supply an alternative approval or digest set that overrides the active canonical candidate.

---

# 3. Replay behavior is bound to the original approval

For an existing `PROMOTION_REQUEST#<promotionRequestId>`, replay resolves the immutable recorded `approvalId` and digest snapshot first. It does **not** reinterpret that request ID against whatever candidate is currently active later.

Replay behavior is:

```text
record disposition == promoted
    -> return/reconcile the existing successful promotion; do not mutate a later candidate

record disposition == rolled_back
    -> return the terminal rollback disposition; do not redeploy under the old ID

record disposition == failed_requires_operator
    -> return the terminal diagnostic until an explicit new trusted operation is authorized

record disposition in {claimed, applying, verifying}
    -> reconcile only the bound approval/digest set and continue the permitted recovery path
```

A request bound to approval A can never act on approval B after the active slot changes.

A lost response after a fully successful terminal transaction therefore becomes a read/reconcile of the already-promoted request rather than a second deployment.

---

# 4. Successful promotion transaction is operation-bound

Round 8's successful terminal transaction remains authoritative, with these additional preconditions:

```text
candidate activePromotionRequestId == promotionRequestId
PROMOTION_REQUEST#<promotionRequestId>.approvalId == candidate approvalId
PROMOTION_REQUEST canonical digest snapshot == candidate canonical digests
promotion request disposition in {claimed, applying, verifying}
```

After actual deployed worker/evaluator identities have been smoke/reconciled to the canonical snapshot, one atomic transaction writes:

```text
candidate overall state = promoted
candidate promotion state = promoted
candidate promotedAt = server timestamp
candidate promoted worker/evaluator identities = existing canonical digests
candidate activePromotionRequestId = null
PROMOTION_REQUEST disposition = promoted
PROMOTION_REQUEST lastReconciledAt = server timestamp
ACTIVE_EXECUTION_CANDIDATE.approvalId = null
```

The transaction fails if the active slot, bound approval, active promotion identity, canonical digests, or actual reconciled deployment identity no longer match.

---

# 5. Failed smoke, rollback, and uncertain state

If infrastructure smoke fails, the protected path must first reconcile/rollback the exact bound canonical digest pair under the existing compatibility/drain rules.

If rollback is verified to the prior production pair, one conditional transaction:

```text
candidate remains overall state = built
candidate promotion state = not_promoted
candidate activePromotionRequestId = null
PROMOTION_REQUEST disposition = rolled_back
ACTIVE_EXECUTION_CANDIDATE remains the candidate approvalId
```

The rolled-back request ID is terminal and cannot be reused for another deployment attempt. A deliberate later retry uses a **new** `promotionRequestId`.

If actual infrastructure identity cannot be proven to be either the target canonical pair or the verified rollback pair, the operation becomes:

```text
PROMOTION_REQUEST disposition = failed_requires_operator
candidate promotion state = failed_requires_operator
candidate activePromotionRequestId = promotionRequestId
ACTIVE_EXECUTION_CANDIDATE remains occupied
```

No new candidate may be admitted or promoted until the protected operator reconciles the ambiguity through a documented recovery action. The system must not clear the active slot merely to recover release throughput.

---

# 6. Required P1 evidence additions

P1 must retain evidence that:

1. one `promotionRequestId` is globally bound to one approval and one canonical digest snapshot;
2. a promotion request first bound to approval A cannot act on later approval B after the active slot changes;
3. two different promotion request IDs cannot concurrently claim one built candidate;
4. replay of a successfully promoted request returns the existing terminal disposition without another deployment;
5. replay of a rolled-back request cannot redeploy;
6. a new promotion after verified rollback requires a new request identity;
7. the successful terminal transaction requires the candidate's active promotion identity and the bound request record to match;
8. uncertain post-mutation infrastructure state leaves the active slot occupied and fails closed rather than permitting another release;
9. promotion request records and candidate transitions contain no private evaluator bytes or secrets and remain attributable in the protected release evidence package.

---

# 7. Review-state boundary

Round 9 closes FPR9-01 at the decision/specification level. It does not claim promotion-request mappings, claim transactions, reconciliation logic, rollback proof, or production AWS state are implemented.

The resulting exact HEAD must:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> only then receive a fresh independent Codex review
-> disposition every actionable finding
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

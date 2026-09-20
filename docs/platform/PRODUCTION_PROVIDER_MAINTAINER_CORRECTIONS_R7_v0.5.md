# Platform v0.5 — Maintainer Corrections Round 7 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `fbd42ee8345b3bbe0d30ce29823f3bcde6bf99e0`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and independent findings register

A fresh maintainer-first review of the round-6 candidate found three remaining implementation-defining ambiguities before another Codex pass:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR7-01 | HIGH | The execution broker accepts only `requestId` and operates on the "current approved candidate", while candidate admission can create new approval IDs. The record did not freeze how one candidate becomes current or prevent admission/build races across multiple candidates. | Add one protected active-candidate control slot with transactional admission/supersession and broker admission checks. |
| FPR7-02 | HIGH | Protected CodeBuild projects "record" image digests, while later rounds require the broker alone to write canonical digests, but no concrete authenticated result channel existed from CodeBuild back to the broker. | Add immutable per-build result receipts in a protected S3 release-control bucket; broker reconciles CodeBuild status + receipt + ECR metadata before canonicalizing a digest. |
| FPR7-03 | MEDIUM | Round 6 said the admission Lambda derives the federated approver actor from Lambda request context. Direct Lambda `Invoke` authorizes the caller but does not give function code a trustworthy caller-identity field equivalent to an IAM-authenticated HTTP request context. | Make CloudTrail Lambda `Invoke` data events + the AWS SDK invocation receipt the canonical actor evidence; the Lambda records server-generated invocation identity/timestamp but does not invent caller identity. |

This is independent maintainer discovery performed before requesting another Codex review.

Precedence inside the P0 provider/operations record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R7_v0.5.md
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

# 1. One active execution candidate — FROZEN

The release-control DynamoDB table contains one protected singleton control item:

```text
control key: ACTIVE_EXECUTION_CANDIDATE
approvalId:  null | current approvalId
```

The execution-release broker continues to accept only the bounded caller request identity. It does **not** accept an `approvalId` from GitHub Actions. The broker resolves the candidate only through this protected control item.

## 1.1 Normal admission

Candidate admission is one DynamoDB transaction that:

1. creates the new candidate with the exact server-generated initial state frozen by round 6;
2. conditionally sets `ACTIVE_EXECUTION_CANDIDATE.approvalId` to the new server-generated `approvalId`;
3. fails atomically if another non-terminal active candidate occupies the slot.

A candidate is terminal for active-slot replacement when:

```text
overall state == promoted
or overall state == failed_locked
or overall state == superseded
```

A candidate in `approved`, `building`, or `built` state is non-terminal.

## 1.2 Explicit supersession before promotion

A verified candidate can become obsolete before promotion. The admission function therefore supports a separate bounded **supersede-and-admit** action available only to `fpllm-beta-sensitive-release-approver`.

Required caller fields are:

```text
supersedesApprovalId
supersessionReasonCode
new immutable candidate inputs
```

The server transaction succeeds only if:

- the active control item still equals `supersedesApprovalId`;
- the superseded candidate has `promotion state == not_promoted`;
- no component has a non-null active build ID;
- no component is in a running/building state;
- the candidate has not already been promoted.

The transaction atomically:

1. marks the old candidate `overall state = superseded` with a server timestamp/reason code;
2. creates the new candidate with fresh `approvalId` and exact initial state;
3. moves the active control slot to the new approval.

The admission request cannot alter old protected digests, build counters, build IDs, or immutable input identity.

A candidate with an active CodeBuild execution cannot be superseded. It must first be reconciled to a non-running state.

## 1.3 Broker admission check

Before every reconciliation/start operation, the execution broker transactionally verifies that:

```text
ACTIVE_EXECUTION_CANDIDATE.approvalId == candidate.approvalId
candidate overall state is eligible
candidate is not superseded/promoted/failed_locked
```

The broker scopes request-id idempotency to the resolved `approvalId` so a replay cannot migrate silently to a later candidate after the active slot changes.

This removes candidate-selection ambiguity while preserving the rule that GitHub can trigger only an already trusted active approval and cannot choose release inputs.

---

# 2. Protected build-result receipts — FROZEN

Each protected CodeBuild project must return its output identity through an authenticated non-secret result channel before the broker can record a canonical digest.

Use a dedicated protected S3 bucket or protected prefix in `eu-west-1`:

```text
logical name: fpllm-beta-release-control
purpose:      small non-secret protected build-result receipts
public access: blocked
versioning:   enabled
encryption:   enabled
builder delete authority: none
GitHub OIDC read/write authority: none
```

This bucket/prefix is part of the protected execution-release stack. It is not learner artifact storage and never contains private evaluator source bytes.

## 2.1 Receipt key and size

Each protected builder writes exactly one result object after a successful image push:

```text
build-results/<approvalId>/<component>/<codebuild-build-id>.json
```

where component is one of:

```text
worker
evaluator-base
hidden-evaluator
```

Maximum receipt size: **16 KiB**.

The bucket policy requires conditional object creation with `If-None-Match: *` for the builder prefixes and denies builder delete operations. A builder cannot overwrite an existing current receipt key.

Official basis for policy-enforced S3 conditional writes:

- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html

## 2.2 Receipt schema

The strict receipt contains only non-secret identity/provenance:

```text
schemaVersion
approvalId
component
platformSourceSha
codeBuildProjectArn
codeBuildBuildId
imageRepositoryArn
imageDigest
sourceContextSha256                # worker/evaluator-base
privateBundleCommittedSha256       # hidden-evaluator only
baseImageDigest                    # hidden-evaluator only
createdAt
```

No private test contents, tokens, environment dumps, credentials, or learner content are permitted.

## 2.3 Builder authority

Each protected builder role receives `s3:PutObject` only on its own component result prefix and no result-object delete authority.

It receives no DynamoDB candidate-write authority.

The sensitive hidden-evaluator builder reaches the release-control bucket only through the already-frozen S3 VPC gateway endpoint; the endpoint policy is extended narrowly for its result prefix. No Internet/NAT path is added.

## 2.4 Broker reconciliation

The execution broker may read only the protected result prefixes and may use metadata-only:

```text
ecr:DescribeImages
```

on the three protected output repositories. It receives no protected image-layer/content read permission such as `ecr:BatchGetImage` or `ecr:GetDownloadUrlForLayer` merely to reconcile a result.

For a recorded CodeBuild ID, the broker may canonicalize a component digest only after all of the following are true:

1. `codebuild:BatchGetBuilds` reports `SUCCEEDED` for the exact stored build ID/project;
2. the deterministic result-receipt key exists and parses under the bounded schema;
3. receipt `approvalId`, component, project/build ID, platform source SHA and expected source/private/base identities equal canonical candidate/build state;
4. `ecr:DescribeImages` confirms the reported digest exists in the exact component repository;
5. no canonical digest is already recorded for that component under the approval.

The broker then conditionally writes the receipt identity/object version plus canonical digest into candidate state. That digest is immutable for the approval.

A missing, duplicate-conflicting, oversized, malformed, identity-mismatched, or ECR-inconsistent receipt is an internal release invariant failure and never becomes promotable state.

A build that pushed an image but failed before producing a valid receipt is not successful release evidence. A later allowed retry receives a new CodeBuild build ID/result key; stale unreferenced images are never promoted merely because they exist in ECR.

---

# 3. Admission caller identity — CLOUDTRAIL IS CANONICAL

Round 6 is superseded where it says the admission Lambda derives the invoking federated actor directly from Lambda request context.

The approver still invokes `fpllm-beta-sensitive-release-admit` synchronously through the signed AWS Lambda `Invoke` API under its short-lived federated role. No Function URL is required.

Freeze CloudTrail data-event logging for the exact admission function ARN. Lambda `Invoke` is an AWS CloudTrail data event and the CloudTrail event carries the authenticated `userIdentity` for the caller.

Official basis:

- https://docs.aws.amazon.com/lambda/latest/dg/logging-using-cloudtrail.html
- https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html

## 3.1 Candidate-side audit identity

The admission Lambda records server-side:

```text
approvalId
admissionFunctionRequestId          # Lambda execution/request correlation identity
admissionTimestamp
optional bounded caller correlation token
```

It does **not** accept or persist a caller-supplied string as authoritative approver identity.

## 3.2 Canonical approver evidence

The release-approval evidence retains:

```text
approvalId returned by the admission function
AWS SDK/CLI Invoke response request metadata retained by the approver procedure
matching CloudTrail Lambda Invoke data event ID/request identity
CloudTrail userIdentity/session/Identity Center context
function ARN + region + event timestamp
```

CloudTrail is the canonical source for the authenticated federated actor. The candidate's server-side admission request ID/timestamp and the invocation receipt provide the correlation path.

P1 must prove this correlation with a real non-production federated admission and must stop/reopen the audit design if the realized AWS records cannot unambiguously bind one candidate admission to one authenticated caller event.

CloudTrail data-event cost is included in the fresh P1 AWS estimate and log-retention decision.

---

# 4. Field ownership after round 7

The release-control write model is now explicit:

```text
sensitive-release approver role:
  no direct DynamoDB writes
  invokes candidate-admission Lambda only

candidate-admission Lambda role:
  creates immutable candidate inputs + exact initial state
  atomically owns active-slot admission/supersession metadata
  never starts builds or writes protected output digests

protected builder roles:
  push only their own ECR output
  create only their own immutable S3 result receipt
  no candidate-table writes

execution-release broker role:
  resolves active slot
  owns component build state/counters/build IDs
  reads/validates build receipts + ECR metadata
  writes canonical protected output digests
  cannot rewrite immutable candidate input identity

protected promotion path:
  reads canonical built candidate/digests
  records promotion disposition
  cannot substitute non-canonical digests
```

P1 may physically split these into multiple DynamoDB items/tables if that makes IAM enforcement cleaner, but the semantic ownership above is mandatory.

---

# 5. Failure/concurrency rules

The following transitions fail closed:

- two concurrent admissions contend for the active slot -> at most one transaction commits;
- supersession during an active build -> rejected;
- broker invocation after the active slot moved -> old-candidate start rejected;
- request-id replay after active candidate changed -> cannot act on the new candidate under the old idempotency record;
- receipt arrives before CodeBuild success -> not canonicalized;
- CodeBuild success without receipt -> not canonicalized;
- receipt for wrong approval/component/build/source identity -> invariant failure;
- receipt reports a digest absent from the exact repository -> invariant failure;
- builder attempts to overwrite/delete a receipt -> denied/fails conditional write policy;
- candidate promotion without all three canonical broker-recorded digests -> rejected.

No failure path rewrites learner evidence; this is release-control state only.

---

# 6. Required P1 evidence additions

In addition to all non-conflicting prior evidence requirements, retain proof that:

1. concurrent candidate admissions cannot create two active approvals;
2. the broker cannot start or reconcile a superseded/non-active approval through the ordinary GitHub-triggered request path;
3. supersession fails while any component build is active and succeeds atomically only under the frozen preconditions;
4. each protected builder can create only its component receipt and cannot delete/overwrite an existing receipt key;
5. GitHub OIDC cannot read/write the protected build-result prefix;
6. no protected builder has candidate-table write authority;
7. broker digest canonicalization requires exact CodeBuild success + matching receipt + ECR metadata confirmation;
8. broker ECR reconciliation uses metadata-only authority and cannot download protected image layers;
9. hidden-evaluator receipt publication succeeds through private S3 connectivity with no Internet route;
10. admission Lambda runtime does not trust a caller-supplied actor string;
11. CloudTrail data events are enabled for the exact admission function and identify the federated approver session;
12. a real test admission can be correlated unambiguously from returned approvalId/invocation receipt to the CloudTrail caller event;
13. the fresh AWS cost estimate includes CloudTrail data events and the protected release-control bucket/prefix.

---

# 7. Areas re-reviewed with no new decision defect found

This pass also rechecked, without finding a new P0-level contradiction:

- PostgreSQL 18.6 / RDS class and live-orderability reopen gate;
- ECS Express origin/DNS/TLS fallback-amendment behavior;
- OIDC immutable subject plus independent main-only environment/ref enforcement;
- GitHub App/OAuth permissions and provider-rate deferral semantics;
- trusted worker Docker-socket/gVisor/network boundary;
- hidden-evaluator private/no-Internet build boundary;
- protected worker/evaluator-base/final-evaluator image authority split;
- explicit GitHub web/control-plane release TCB acceptance;
- webhook authority/idempotency/body/secret-rotation contract;
- backup/restore and compatibility/drain/rollback requirements;
- cost hard-stop and provider quota/orderability gates.

These are decision/specification conclusions only and still require their P1/P2/P3 evidence gates.

---

# 8. Review-state boundary

Round 7 closes maintainer findings FPR7-01 through FPR7-03 at the decision/specification level. It does not claim active-slot transactions, result receipts, CloudTrail data events, IAM restrictions, or production AWS resources are implemented.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> only then receive a fresh independent Codex review
-> disposition all actionable findings
-> pass final exact-HEAD checks
-> squash merge
```

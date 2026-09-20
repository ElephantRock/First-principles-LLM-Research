# Platform v0.5 — Maintainer Corrections Round 5 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Fifth-review baseline:** `97083eb2cd87d086d298dbbdd2af3faceec3cb39`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and scope

The round-4 exact-HEAD review found one remaining specification inconsistency rather than a new provider choice: round 3 required a trusted approver to approve a `hidden-evaluator-base` digest before candidate creation, while round 4 correctly moved evaluator-base byte production into a protected builder that runs **after** candidate approval. The same review also found that the trusted human/federated release roles should be frozen precisely enough that P1 does not invent overlapping privileges.

This delta resolves those two points. Precedence inside the P0 record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R5_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R4_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R3_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion records
```

Non-conflicting decisions remain in force.

---

# 1. Approved-candidate lifecycle — CORRECTED

Round 3 §4.1/§4.2 is superseded where it requires an evaluator-base digest to exist before approval.

A newly created approved candidate contains authoritative **inputs**, not yet the protected build outputs:

```text
approvalId
platform source SHA
execution-source-context S3 bucket/key/version + SHA-256 + bytes
private evaluator S3 bucket/key/version + committed SHA-256 + bytes
testBundleId
private evaluator version
approval timestamp + trusted approver audit identity

worker state = approved
worker buildStartCount = 0
worker activeBuildId = null
workerDigest = null

evaluator-base state = approved
evaluator-base buildStartCount = 0
evaluator-base activeBuildId = null
evaluatorBaseDigest = null

hidden-evaluator state = blocked_on_base
hidden-evaluator buildStartCount = 0
hidden-evaluator activeBuildId = null
hiddenEvaluatorDigest = null

overall state = approved
```

The protected broker may then start the worker and evaluator-base builders according to the frozen idempotency/start-count rules.

Only the broker, using conditional/transactional state transitions after reconciling the recorded CodeBuild execution, may populate:

```text
workerDigest
evaluatorBaseDigest
hiddenEvaluatorDigest
```

The hidden-evaluator component becomes eligible only after `evaluatorBaseDigest` is durably recorded from the successful protected evaluator-base project under the same `approvalId` and platform source SHA.

The trusted human approver does **not** manually select or write any of the three protected output digests.

Overall state may become `built` only when all three protected outputs succeeded under one approval. Promotion remains a separate protected action over those recorded exact digests.

---

# 2. Trusted federated role separation — FROZEN

P1 may choose AWS IAM Identity Center or equivalently bounded workforce federation for the human entry point, but it must implement distinct roles with no GitHub OIDC trust.

## 2.1 Private release-material publisher

Freeze logical role:

```text
fpllm-beta-release-material-publisher
```

Purpose: publish a new committed private evaluator archive version.

Allowed authority is limited to the release-material path/key required to:

- `PutObject` the private evaluator archive under the content-addressed/versioned release-material prefix;
- use the release-material KMS key for encryption as required by the selected S3 SSE-KMS path;
- read back object metadata/version/checksum needed to confirm publication.

It has no candidate-table write authority, no CodeBuild start/update authority, no ECR push authority, no worker administration authority, and no protected-stack deployment authority.

Static AWS access keys are forbidden.

## 2.2 Sensitive release approver

Freeze logical role:

```text
fpllm-beta-sensitive-release-approver
```

Purpose: independently verify one reviewed execution candidate and create the immutable approval input record.

Required authority is limited to:

- read the exact execution-source-context object version and metadata required to independently recompute/verify its SHA-256 and reviewed platform source identity;
- read the exact private evaluator object version required to independently verify byte size and committed SHA-256;
- `kms:Decrypt` only through the release-material key/path required for that verification;
- read the public commitment and required non-secret release metadata;
- create one new approved-candidate item in `fpllm-beta-sensitive-release` using the bounded schema and conditional write semantics;
- read back that candidate for verification/audit.

It has no `codebuild:StartBuild`, no protected ECR push, no worker-host/ASG administration, no GitHub OIDC assumption, and no protected CloudFormation apply authority.

Replacing/resetting an approval after `failed_locked`, promotion, or any integrity mismatch requires a new `approvalId`; the approver cannot rewrite protected output digests on an existing approval.

## 2.3 Protected deployment/release operator

Freeze logical operator/deployment authority:

```text
fpllm-beta-protected-deploy
```

This is a separately trusted federated operator path used to apply reviewed changes to the protected execution/sensitive-release CloudFormation stack and to promote the exact already-recorded protected worker/evaluator digests under the frozen compatibility/drain procedure.

It has no GitHub OIDC trust. Its CloudFormation execution role is inaccessible to the normal GitHub deployment path.

The role is not the private-bundle publisher and should not receive private evaluator object/KMS read authority merely because it can deploy protected infrastructure. If a one-off maintenance action truly needs both authorities, P1 must retain an explicit break-glass/dual-role audit record rather than silently combining the steady-state policies.

---

# 3. Promotion cannot rewrite build identity

The protected deployment/release operator consumes, but does not replace, the broker-recorded digests.

Promotion input is exactly:

```text
approvalId
platform source SHA
workerDigest
evaluatorBaseDigest
hiddenEvaluatorDigest
```

with `overall state = built` and all component identities originating from the protected projects.

The promotion path may update the protected worker launch/image configuration to the recorded `workerDigest` + `hiddenEvaluatorDigest` pair after the frozen compatibility/drain gates. It may not substitute arbitrary image digests, a mutable tag, or outputs from a different approval/source SHA.

P1 must prove this with a negative test that a protected-deploy invocation carrying a non-recorded digest is rejected before infrastructure mutation.

---

# 4. Required P1 evidence additions

Retain evidence for:

1. no GitHub OIDC principal can assume the publisher, approver, or protected-deploy roles;
2. the publisher cannot write candidate state or start builds;
3. the approver can verify the exact versioned source/private inputs and create a new approval, but cannot start builds, push ECR images, or mutate an existing protected output digest;
4. the protected-deploy role cannot read private evaluator material in steady state and cannot substitute a non-recorded digest during promotion;
5. the broker alone writes successful protected component digests after reconciling their CodeBuild IDs;
6. hidden-evaluator build admission remains `blocked_on_base` until the protected evaluator-base digest is durably recorded under the same approval;
7. CloudTrail/audit evidence identifies the federated actor for publication, approval, and protected deployment separately.

---

# 5. Review-state boundary

This delta resolves the candidate-lifecycle contradiction introduced by moving evaluator-base production into the protected build path and freezes the human/federated role separation required to implement that path without inventing new privilege during P1.

It does not claim those roles, policies, candidate transitions, or production resources are implemented.

The merge gate remains:

```text
CI/affected gates on the new exact HEAD
-> fresh exhaustive maintainer review
-> fix/repeat if needed
-> fresh exact-HEAD Codex review
-> disposition all actionable threads
-> final exact-HEAD CI/review/thread check
-> squash merge
```

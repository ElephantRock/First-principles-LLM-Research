# Platform v0.5 — Maintainer Corrections Round 3 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Reopened review baseline:** `9f806edd5bf41fec4f5890b59b03f226f67f538d`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and why the gate reopened

During final review-thread disposition after the round-2 exact-HEAD maintainer pass, a previously submitted security finding was re-surfaced and found to remain substantively unresolved: a GitHub-controlled AWS release session with direct `codebuild:StartBuild` authority over the sensitive hidden-evaluator project can supply per-build overrides. Because that CodeBuild service role can read/decrypt the private evaluator bundle, direct mutable invocation authority would undermine the intended separation between the GitHub-hosted release runner and private evaluator material.

The prior exact-HEAD maintainer-clean statement for `9f806edd...` is therefore superseded. The P0 merge gate is reopened until this correction is committed, CI is green, and the new exact HEAD is independently re-reviewed.

Precedence inside the P0 provider/operations record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R3_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion P0 records
```

Non-conflicting decisions remain in force.

---

# 1. Direct GitHub-controlled CodeBuild invocation — PROHIBITED

The parent/companion statements that permit the GitHub deployment role to start `fpllm-beta-hidden-evaluator` directly are superseded.

The GitHub OIDC broker/deployment path receives **none** of the following authority over the sensitive hidden-evaluator project:

```text
codebuild:StartBuild
codebuild:StartBuildBatch
codebuild:RetryBuild
codebuild:UpdateProject
codebuild:DeleteProject
codebuild:CreateProject
```

It also receives no IAM or CloudFormation path that can mutate the sensitive CodeBuild project, its service role, its KMS key, its private release-material bucket, or the protected release broker defined below.

This prohibition is structural, not merely a workflow convention. P1 must prove the effective AWS authorization denies these operations to the GitHub OIDC broker/deploy principals.

AWS documents that `StartBuild` accepts per-run overrides including buildspec, environment variables, source, artifacts, cache, image, service role, logs, timeout, compute type, and privileged mode. The project therefore does not rely on caller discipline or on an incomplete deny-list of override fields to protect private evaluator material.

Official basis:

- CodeBuild `StartBuild` API: https://docs.aws.amazon.com/codebuild/latest/APIReference/API_StartBuild.html
- AWS CLI `start-build`: https://docs.aws.amazon.com/cli/latest/reference/codebuild/start-build.html

---

# 2. Protected hidden-evaluator release broker — SELECTED

Production hidden-evaluator builds are triggered through a dedicated AWS-side broker:

```text
service: AWS Lambda
function: fpllm-beta-hidden-evaluator-release-broker
region: eu-west-1
```

The GitHub deployment role may receive only:

```text
lambda:InvokeFunction
```

against the exact broker function ARN. It cannot update the function code/configuration, attach layers, alter environment variables, pass roles, change its resource policy, or invoke arbitrary Lambda functions.

## 2.1 Caller input is non-authoritative

The broker accepts only a bounded request identity, for example:

```json
{
  "requestId": "opaque-bounded-release-request-id"
}
```

The caller does **not** supply authoritative build inputs such as:

```text
buildspec
source location/type/version
Docker image
service role
privileged mode
cache/artifact/log configuration
environment variables
platform source SHA
private bundle key/version/hash
public context key/version/hash
```

Unknown fields are rejected. Request size is bounded. Duplicate `requestId` values are idempotent.

## 2.2 Broker authority

The broker role may:

- read the single approved hidden-evaluator release-candidate metadata record defined in §3;
- call `codebuild:StartBuild` only on the exact hidden-evaluator project ARN;
- pass only the small allowlisted environment-variable set constructed from that approved metadata record;
- optionally read build status for the resulting build ID if required by the orchestration path;
- emit bounded structured logs/metrics for release correlation.

The broker role cannot read or decrypt the private evaluator object itself. It receives no S3 private-bundle content permission and no release-material KMS decrypt permission.

---

# 3. Approved hidden-evaluator candidate record — TRUSTED AUTHORITY

The exact release inputs for the hidden evaluator are frozen into an AWS-side approved-candidate record before the GitHub workflow can trigger a build.

Use a dedicated non-secret metadata record, implemented during P1 with Systems Manager Parameter Store, DynamoDB, or an equivalently bounded AWS service. The selected implementation must preserve the following semantics:

```text
record identity: one active approved hidden-evaluator candidate
writer authority: trusted federated release approver only
reader authority: protected release broker + required audit path
GitHub OIDC write authority: none
```

The record binds at minimum:

```text
platform source SHA
public source-context S3 bucket/key/version
public source-context SHA-256
private evaluator S3 bucket/key/version
private evaluator committed SHA-256
private evaluator archive byte size
testBundleId
private evaluator version
approval timestamp
approval actor/audit identity
```

## 3.1 Trusted approval path

The trusted release approver uses short-lived federated AWS credentials, not a static access key and not the GitHub OIDC deployment role.

Before writing/replacing the active approved-candidate record, the approver procedure must verify:

1. the public source context is content-addressed and matches the intended frozen platform source SHA;
2. the private evaluator object version/size/SHA-256 matches the public commitment;
3. both referenced S3 object versions exist and are immutable for the release operation;
4. the requested `testBundleId` and evaluator version match the committed release contract;
5. the candidate record contains no private evaluator source bytes or secrets.

Updating the approved-candidate record is a release-approval action and must be auditable.

GitHub can trigger an already-approved candidate but cannot select or rewrite it.

---

# 4. Sensitive CodeBuild project is fixed-input infrastructure

Freeze `fpllm-beta-hidden-evaluator` so caller-controlled `StartBuild` overrides are unnecessary.

Recommended production project form:

```text
source type:          NO_SOURCE
buildspec:            fixed in protected infrastructure configuration
cache:                NO_CACHE
artifacts:            NO_ARTIFACTS
privileged mode:      fixed true only because Docker build requires it
logs:                 fixed dedicated CloudWatch log group
service role:         fixed hidden-evaluator CodeBuild role
timeout:              fixed <= 30 minutes
concurrent builds:    1
```

The fixed buildspec reads only the allowlisted metadata values injected by the protected broker, then:

1. downloads the exact versioned public source-context object;
2. verifies its SHA-256 and platform source identity;
3. downloads the exact versioned private evaluator object;
4. verifies its byte size and committed SHA-256;
5. builds the hidden-evaluator image;
6. pushes only to `fpllm/hidden-evaluator`;
7. records the resulting ECR digest and non-secret provenance;
8. removes normal-path plaintext private material from the ephemeral workspace.

No mutable branch checkout, floating S3 key, caller-supplied buildspec, arbitrary caller environment override, or caller-selected source is part of the production sensitive build path.

---

# 5. Sensitive release infrastructure is a separate protected stack

The GitHub OIDC deployment role must not be able to defeat §1 indirectly by modifying the infrastructure that enforces it.

Therefore the following resources belong to a **protected sensitive-release infrastructure stack** whose create/update/delete authority is held only by a trusted federated AWS operator / dedicated protected CloudFormation execution role:

```text
hidden-evaluator CodeBuild project
CodeBuild service role
release broker Lambda + execution role
private evaluator release-material S3 bucket/prefix policy
release-material KMS key/policy
approved-candidate metadata store and writer/reader policies
hidden-evaluator ECR repository policy where it enforces the sensitive boundary
```

The GitHub OIDC/CDK deployment path may synthesize or inspect committed infrastructure source but cannot apply mutations to this protected stack and cannot assume its CloudFormation execution role.

Normal non-sensitive application infrastructure remains deployable through the previously selected GitHub OIDC/CDK path subject to the existing least-privilege boundaries.

Any protected-stack change follows:

```text
reviewed source change
-> normal CI/review
-> trusted federated operator assumes protected deployment authority
-> deploy exact reviewed source identity
-> retain CloudFormation/change-set and actor evidence
```

This is not console-only infrastructure: the protected stack remains version-controlled IaC, but its apply authority is deliberately outside the GitHub-hosted release session that it protects against.

---

# 6. Required negative authorization tests

P1 must retain explicit evidence that the GitHub OIDC broker/deploy principals cannot:

- start/retry/update/delete the hidden-evaluator CodeBuild project directly;
- mutate the release broker function or its IAM role;
- write the approved-candidate metadata record;
- read the private evaluator S3 object;
- decrypt the private evaluator KMS key;
- push to the hidden-evaluator ECR repository;
- assume the protected sensitive-release CloudFormation execution role;
- update/delete the protected release-material S3/KMS/CodeBuild/broker stack.

P1 must also prove positively that:

- the GitHub deployment role can invoke only the exact release broker function;
- an unknown/oversized broker request is rejected;
- duplicate `requestId` invocation is idempotent;
- broker invocation starts a build only for the currently approved candidate;
- attempts to provide extra caller-selected build inputs cannot alter the candidate or CodeBuild configuration;
- the broker role cannot read/decrypt private evaluator bytes;
- the CodeBuild role can read exactly the approved private object/version and push only the hidden-evaluator image;
- changing the approved candidate requires the trusted federated approver path.

---

# 7. Release evidence additions

The hidden-evaluator release evidence package now binds:

```text
platform source SHA
approved-candidate record version/identity
trusted approver audit identity + approval timestamp
public source-context object version + SHA-256
private evaluator object version + committed SHA-256 + bytes
release-broker invocation/request ID
CodeBuild project + build ID
fixed buildspec/project configuration identity
CodeBuild service-role policy identity
hidden-evaluator ECR digest
protected-stack CloudFormation/source identity
```

GitHub Actions workflow evidence records the broker invocation and resulting release identity, but never private evaluator contents or KMS plaintext.

---

# 8. Review-state boundary

This round closes the sensitive-build invocation authority gap at the **decision/specification** level. It does not claim that the broker, protected stack, candidate metadata, IAM denies, or production CodeBuild path are implemented or verified.

The merge sequence restarts from this correction:

```text
CI/affected gates on the new exact HEAD
-> fresh exhaustive maintainer review of the complete P0 record
-> fix and repeat if any material flaw remains
-> request a fresh Codex review on that exact HEAD
-> disposition all actionable review threads
-> rerun affected gates if the candidate changes
-> final exact-HEAD CI/review/thread check
-> squash merge
```

No earlier maintainer-clean statement or Codex review on an older commit satisfies this restarted gate.

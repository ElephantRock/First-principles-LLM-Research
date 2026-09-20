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

It also receives no IAM or CloudFormation path that can mutate the sensitive CodeBuild project, its service role, its private release-material bucket/KMS key, or the protected release broker defined below.

This prohibition is structural, not merely a workflow convention. P1 must prove the effective AWS authorization denies these operations to the GitHub OIDC broker/deploy principals.

AWS documents that `StartBuild` accepts per-run overrides including buildspec, environment variables, source, artifacts, cache, image, service role, logs, timeout, compute type, and privileged mode. The project therefore does not rely on caller discipline or on an incomplete deny-list of override fields to protect private evaluator material.

Official basis:

- CodeBuild `StartBuild` API: https://docs.aws.amazon.com/codebuild/latest/APIReference/API_StartBuild.html
- AWS CLI `start-build`: https://docs.aws.amazon.com/cli/latest/reference/codebuild/start-build.html

---

# 2. Non-secret hidden-evaluator base image — SELECTED

The earlier design in which sensitive CodeBuild consumes an arbitrary public source-context archive is superseded. The private bundle must never be combined with caller-selected public build scripts.

The GitHub-hosted release runner may build and publish a **non-secret evaluator base image** from the exact frozen platform source SHA:

```text
ECR repository: fpllm/hidden-evaluator-base
region:         eu-west-1
contents:       Python/PyTorch/runtime dependencies and non-secret evaluator runtime only
private tests:  absent
identity:       immutable ECR digest + OCI source-revision/testBundle/runtime labels
```

The GitHub deployment path may push this one additional non-secret repository under the same non-hidden release authority already frozen for web/worker/test-runtime images. It receives no push authority to `fpllm/hidden-evaluator`.

P1 must prove the base image contains no private evaluator bundle/material and that its recorded OCI source revision equals the frozen platform source SHA. The trusted release approver in §3 approves an exact base image digest; a mutable tag is never sufficient.

This split leaves CodeBuild with only one sensitive assembly operation: combine an already-approved base image digest with the already-approved private evaluator bundle using fixed protected build logic.

---

# 3. Approved hidden-evaluator candidate — TRUSTED DYNAMODB AUTHORITY

Use one protected DynamoDB table in `eu-west-1`:

```text
table:           fpllm-beta-sensitive-release
billing mode:    PAY_PER_REQUEST
encryption:      DynamoDB encryption at rest
PITR:            enabled
public endpoint: none exposed by the application; AWS IAM control-plane/data API only
```

The table contains **non-secret release metadata only**. It never stores evaluator source bytes, OAuth/App secrets, database credentials, or KMS plaintext.

Project bounds are deliberately far below DynamoDB's provider envelope:

```text
approved-candidate item <= 16 KiB
broker request/idempotency item <= 4 KiB
release volume: single-digit writes/reads per release, not learner-loop traffic
```

The table is part of the protected sensitive-release stack in §6. GitHub OIDC roles receive no direct read or write permission.

## 3.1 Candidate record

One active approved-candidate record binds at minimum:

```text
approvalId / monotonically unique candidate identity
platform source SHA
hidden-evaluator-base ECR digest
base-image OCI provenance identity
private evaluator S3 bucket/key/version
private evaluator committed SHA-256
private evaluator archive byte size
testBundleId
private evaluator version
approval timestamp
approval actor/audit identity
state = approved | building | succeeded | failed_locked
buildStartCount
resulting hidden-evaluator digest when succeeded
```

## 3.2 Trusted approval path

The candidate writer is a trusted release approver using short-lived federated AWS credentials, not a static access key and not the GitHub OIDC deployment role.

Before creating/replacing the active approved candidate, the approver procedure must verify:

1. the base image digest exists in `fpllm/hidden-evaluator-base` and its OCI source revision is the intended reviewed platform SHA;
2. the base image contains no private evaluator material according to the P1 image-content/provenance gate;
3. the private evaluator object version/size/SHA-256 matches `hidden-tests/phase1/causal-attention/private-bundle-commitment.json`;
4. the private object version exists and is addressable immutably for the release operation;
5. `testBundleId` and evaluator version match the committed release contract;
6. the candidate record contains only non-secret metadata.

Creating a new approval is an auditable release-approval action. GitHub can trigger an already-approved candidate but cannot select, modify, reset, or replace it.

---

# 4. Protected hidden-evaluator release broker — SELECTED

Production hidden-evaluator builds are triggered through a dedicated AWS Lambda:

```text
function:              fpllm-beta-hidden-evaluator-release-broker
region:                eu-west-1
reserved concurrency:  1
timeout:                <= 30 seconds
public Function URL:    disabled
```

The GitHub deployment role may receive only `lambda:InvokeFunction` against this exact function ARN. It cannot update function code/configuration, attach layers, alter environment variables, pass roles, change the function resource policy, or invoke arbitrary Lambda functions.

## 4.1 Caller input is non-authoritative

The broker accepts only a bounded request identity:

```json
{
  "requestId": "opaque-bounded-release-request-id"
}
```

Maximum decoded request body: **4 KiB**. Unknown fields are rejected.

The caller does **not** supply authoritative build inputs such as:

```text
buildspec
source location/type/version
Docker image or base digest
service role
privileged mode
cache/artifact/log configuration
environment variables
platform source SHA
private bundle key/version/hash
```

## 4.2 Durable replay/cost control

The broker uses conditional/transactional DynamoDB writes to make invocation idempotent and candidate-scoped, not merely request-ID-scoped.

Frozen behavior:

```text
one active CodeBuild execution per approvalId
maximum CodeBuild starts per approvalId: 3
successful approvalId: cannot be rebuilt
failed third start: state -> failed_locked
new build after success/failed_locked: requires a new trusted approvalId
requestId replay: returns the existing disposition/build identity
```

Thus a GitHub-controlled caller cannot create unbounded sensitive builds by changing request IDs.

## 4.3 Broker authority

The broker role may:

- read/update only the release-control/idempotency records in `fpllm-beta-sensitive-release` required for the active approved candidate;
- call `codebuild:StartBuild` only on the exact hidden-evaluator project ARN;
- pass only the small allowlisted environment-variable set constructed from the approved candidate record;
- optionally read the status of the resulting build if required by the orchestration path;
- emit bounded structured logs/metrics for release correlation.

The broker cannot read/decrypt the private evaluator object itself and receives no private-bundle S3 content permission or release-material KMS decrypt permission.

---

# 5. Sensitive CodeBuild project is fixed-input infrastructure

Freeze `fpllm-beta-hidden-evaluator` as:

```text
source type:          NO_SOURCE
buildspec:            fixed in protected infrastructure configuration
cache:                NO_CACHE
artifacts:            NO_ARTIFACTS
privileged mode:      fixed true only because Docker build requires it
logs:                 fixed dedicated private CloudWatch log group
S3 build logs:        disabled
service role:         fixed hidden-evaluator CodeBuild role
timeout:              fixed <= 30 minutes
concurrent builds:    1
public build access:  disabled
```

The fixed protected buildspec does **not** execute scripts or a Dockerfile supplied by the GitHub caller or by a mutable public source context.

It receives only allowlisted values from the protected broker, then:

1. pulls the exact approved `fpllm/hidden-evaluator-base@sha256:...` image;
2. verifies the base digest/provenance identity against the approved candidate;
3. downloads the exact approved private evaluator S3 object version;
4. verifies its byte size and committed SHA-256;
5. assembles the final image with a **fixed protected packaging recipe** whose sensitive step only adds the verified private bundle to the approved base image;
6. performs no arbitrary `RUN` command after private material is introduced into the image build context/layer;
7. pushes only to `fpllm/hidden-evaluator`;
8. records the resulting digest and non-secret provenance;
9. removes normal-path plaintext private material from the ephemeral workspace.

The CodeBuild service role may pull only the approved base-image repository, read the private evaluator release-material path/version needed by this build, use only the release-material KMS key required for that object, write its dedicated logs, and push only the final hidden-evaluator repository. It receives no DB, OAuth/App/webhook, learner-evidence, or worker-administration credential.

All round-2 sensitive-build hygiene requirements remain in force, including no cache, no S3 build artifacts/logs, no `set -x`/environment dumps/private-byte logging, and sentinel-secret hygiene evidence.

---

# 6. Sensitive release infrastructure is a separate protected stack

The GitHub OIDC deployment role must not be able to defeat §1 indirectly by modifying the infrastructure that enforces it.

The following resources belong to a **protected sensitive-release infrastructure stack** whose create/update/delete authority is held only by a trusted federated AWS operator / dedicated protected CloudFormation execution role:

```text
hidden-evaluator CodeBuild project + fixed buildspec/packaging recipe
CodeBuild service role
release broker Lambda + execution role
fpllm-beta-sensitive-release DynamoDB table and policies
private evaluator release-material S3 bucket/prefix policy
release-material KMS key/policy
hidden-evaluator ECR repository policy where it enforces the sensitive boundary
```

The GitHub OIDC/CDK deployment path may synthesize or inspect committed infrastructure source but cannot apply mutations to this protected stack and cannot assume its CloudFormation execution role.

The non-secret `fpllm/hidden-evaluator-base` ECR repository may remain in the ordinary non-sensitive release stack. Its GitHub publisher authority is push-only for required release operations and receives no delete/lifecycle-administration authority. Production promotion consumes an immutable digest selected by the trusted candidate approver.

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

# 7. Required authorization and abuse-control tests

P1 must retain explicit evidence that the GitHub OIDC broker/deploy principals cannot:

- start/retry/update/delete the hidden-evaluator CodeBuild project directly;
- mutate the release broker function or its IAM role;
- read/write/reset the approved-candidate or broker-control DynamoDB records directly;
- read the private evaluator S3 object;
- decrypt the private evaluator KMS key;
- push to the final hidden-evaluator ECR repository;
- assume the protected sensitive-release CloudFormation execution role;
- update/delete the protected release-material S3/KMS/CodeBuild/broker/DynamoDB stack.

P1 must also prove positively that:

- the GitHub deployment role can invoke only the exact release broker function;
- an unknown/oversized broker request is rejected;
- duplicate `requestId` invocation is idempotent;
- multiple distinct request IDs cannot create concurrent or unbounded builds for one approval;
- a successful approval cannot be rebuilt and a third failed start locks the approval until trusted reapproval;
- broker invocation starts a build only for the current trusted approved candidate;
- extra caller-selected build inputs cannot alter the base digest, private object, buildspec, service role, cache, logs, artifacts, or privileged mode;
- the broker role cannot read/decrypt private evaluator bytes;
- the CodeBuild role can read the approved private material path, pull the approved base, and push only the final hidden-evaluator image;
- changing/resetting the approved candidate requires the trusted federated approver path;
- the final sensitive packaging step executes no arbitrary source-controlled command after private material is introduced.

---

# 8. Cost, failure, and exit consequences

The protected broker adds one low-volume Lambda and one low-volume on-demand DynamoDB table in `eu-west-1`, plus one non-secret ECR base repository. Their expected beta usage is negligible relative to the existing USD 400–700 planning envelope, but the mandatory pre-create AWS Pricing Calculator/cost review must include them where the calculator supports the service and actual billing evidence must include them after provisioning.

Failure model:

- broker/DynamoDB/CodeBuild unavailable -> new hidden-evaluator release is blocked; already-running production learner services are not rewritten;
- broker invocation replay -> idempotent existing disposition;
- repeated build failure -> at most three starts, then trusted reapproval required;
- approved base/private object missing or hash mismatch -> fail closed before final image promotion;
- protected-stack drift -> release blocked until reconciled through the trusted protected deployment path.

Exit path remains ordinary AWS/IaC replacement: the broker contract is small and the approved-candidate record is non-secret metadata; OCI base/final images and the public commitment remain portable release identities. Replacing Lambda/DynamoDB later requires a P0 amendment because it changes the sensitive-release trust boundary.

---

# 9. Release evidence additions

The hidden-evaluator release evidence package now binds:

```text
platform source SHA
approved-candidate approvalId/state/version
trusted approver audit identity + approval timestamp
non-secret evaluator-base ECR digest + OCI provenance
private evaluator object version + committed SHA-256 + bytes
release-broker request/disposition identity
CodeBuild project + build ID/start count
fixed buildspec/packaging configuration identity
CodeBuild service-role policy identity
final hidden-evaluator ECR digest
protected-stack CloudFormation/source identity
```

GitHub Actions workflow evidence records the broker invocation and resulting release identity, but never private evaluator contents or KMS plaintext.

---

# 10. Review-state boundary

This round closes the sensitive-build invocation authority gap at the **decision/specification** level. It does not claim that the broker, protected stack, DynamoDB release control, IAM denies, evaluator-base split, or production CodeBuild path are implemented or verified.

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

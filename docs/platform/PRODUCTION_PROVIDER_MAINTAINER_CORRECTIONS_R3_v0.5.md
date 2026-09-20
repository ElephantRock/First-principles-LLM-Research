# Platform v0.5 — Maintainer Corrections Round 3 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Reopened review baseline:** `9f806edd5bf41fec4f5890b59b03f226f67f538d`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and why the gate reopened

Final review-thread disposition after the round-2 exact-HEAD maintainer pass exposed two related sensitive-release trust gaps:

1. a GitHub-controlled AWS release session with direct `codebuild:StartBuild` authority over the hidden-evaluator project can supply per-build overrides while the CodeBuild role can read/decrypt the private evaluator bundle;
2. a GitHub-controlled release session that can publish/promote an arbitrary privileged `fpllm/worker` image can indirectly reach the same private material at runtime because the worker controller has host-root-equivalent Docker authority, can pull the hidden-evaluator image, and intentionally has trusted-host HTTPS egress for GitHub/AWS operations.

The second issue was also raised independently by Codex against `9f806edd...` after that head had already been superseded. Both findings are substantive. The prior exact-HEAD maintainer-clean statement for `9f806edd...` is therefore superseded.

Precedence inside the P0 provider/operations record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R3_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion P0 records
```

Non-conflicting decisions remain in force. This round closes the **decision/specification** gaps only; P1 must implement and prove the controls.

---

# 1. GitHub-controlled authority over sensitive/privileged execution releases — PROHIBITED

The GitHub OIDC broker/deployment path must not directly control bytes or mutable configuration that can read the private evaluator material.

It therefore receives **no** direct authority to:

```text
codebuild:StartBuild / StartBuildBatch / RetryBuild
    on fpllm-beta-hidden-evaluator or fpllm-beta-worker

codebuild:UpdateProject / DeleteProject / CreateProject
    for either protected builder

ecr:PutImage / layer-upload actions
    on fpllm/hidden-evaluator or fpllm/worker

mutate the protected release broker, approved-candidate store,
worker ASG/launch template/instance profile/security group,
hidden-evaluator repository policy, worker repository policy,
private release-material S3/KMS policy, or protected builder roles
```

It also receives no IAM/CloudFormation path that can create an equivalent bypass or assume the protected sensitive-release CloudFormation execution role.

AWS documents that `StartBuild` accepts per-run overrides including buildspec, environment variables, source, artifacts, cache, image, service role, logs, timeout, compute type, and privileged mode. The project therefore does not rely on caller discipline or an incomplete deny-list of overrides.

Official basis:

- CodeBuild `StartBuild` API: https://docs.aws.amazon.com/codebuild/latest/APIReference/API_StartBuild.html
- AWS CLI `start-build`: https://docs.aws.amazon.com/cli/latest/reference/codebuild/start-build.html

---

# 2. GitHub-hosted release outputs — NON-SENSITIVE SET ONLY

The GitHub-hosted production release runner may build/publish only the non-sensitive image set:

```text
fpllm/web
fpllm/test-runtime
fpllm/hidden-evaluator-base
```

It does **not** build, push, or promote:

```text
fpllm/worker
fpllm/hidden-evaluator
```

The web image remains normal production application code and receives only its frozen web runtime authorities. `fpllm/test-runtime` remains an untrusted sandbox image constrained by gVisor/network/filesystem/capability/resource controls. Neither receives hidden-evaluator repository read authority.

## 2.1 Non-secret hidden-evaluator base

`fpllm/hidden-evaluator-base` contains only Python/PyTorch/runtime dependencies and non-secret evaluator runtime scaffolding. Private tests are absent.

Identity is:

```text
immutable ECR digest
+ retained release provenance for the exact platform source SHA
+ OCI source-revision/testBundle/runtime labels
```

A mutable tag or OCI label alone is not sufficient promotion evidence. The trusted approver in §4 must match the digest to retained release evidence for the reviewed source SHA and must prove the base contains no private evaluator material.

Before sensitive assembly, the protected hidden-evaluator builder also verifies that the selected base has no Docker `ONBUILD` triggers. This prevents inherited child-build instructions from acting on the private bundle.

---

# 3. Immutable public source context for the protected worker build

The privileged worker is built independently in AWS from an immutable public source context, not from a GitHub-built worker image.

The GitHub release runner may create a deterministic source archive from the frozen reviewed platform SHA and upload it to a **non-secret, versioned, content-addressed release-context S3 path** in `eu-west-1`:

```text
release-context/worker/<platform-source-sha>/<context-sha256>.tar.gz
```

GitHub's release role may `PutObject` only to the non-secret release-context prefix required by the release process. It receives no `DeleteObject`, `DeleteObjectVersion`, bucket-policy, lifecycle, or versioning administration authority for that bucket/prefix.

The trusted release approver independently regenerates or otherwise independently verifies the deterministic context against a clean checkout of the exact reviewed commit and compares its SHA-256/object version before approving it. GitHub-provided metadata alone is not sufficient verification.

The worker context contains public repository source only; it contains no private evaluator material, production secret, database credential, or GitHub App private key.

---

# 4. Approved execution candidate — TRUSTED DYNAMODB AUTHORITY

Use one protected DynamoDB table in `eu-west-1`:

```text
table:           fpllm-beta-sensitive-release
billing mode:    PAY_PER_REQUEST
encryption:      DynamoDB encryption at rest
PITR:            enabled
public endpoint: none exposed by the application; AWS IAM data API only
```

The table contains **non-secret release-control metadata only**. GitHub OIDC roles receive no direct read/write/reset authority.

Project bounds:

```text
approved-candidate item <= 16 KiB
broker request/idempotency item <= 4 KiB
release volume: single-digit control writes/reads per release
```

## 4.1 Candidate identity

One active approved candidate binds at minimum:

```text
approvalId
platform source SHA
worker source-context S3 bucket/key/version + SHA-256
hidden-evaluator-base ECR digest + retained source-provenance identity
private evaluator S3 bucket/key/version
private evaluator committed SHA-256 + archive byte size
testBundleId + private evaluator version
approval timestamp + trusted approver audit identity
worker state/buildStartCount/active build ID/resulting digest
hidden evaluator state/buildStartCount/active build ID/resulting digest
overall state = approved | building | built | promoted | failed_locked
```

## 4.2 Trusted approval path

The candidate writer is a trusted release approver using short-lived federated AWS credentials, not a static access key and not the GitHub OIDC deployment role.

Before creating/replacing the active candidate, the approver procedure verifies:

1. the worker source-context object version/hash independently matches the exact reviewed platform source SHA;
2. the hidden-evaluator-base digest matches retained release evidence for that same reviewed source SHA;
3. the evaluator base contains no private evaluator material, has no Docker `ONBUILD` triggers, and matches the expected runtime/testBundle contract;
4. the private evaluator object version/size/SHA-256 matches `hidden-tests/phase1/causal-attention/private-bundle-commitment.json`;
5. all referenced object versions/digests exist immutably for the release operation;
6. `testBundleId` and evaluator version match the committed release contract;
7. the candidate record contains only non-secret metadata.

Creating a new approval is auditable. GitHub can request execution of an already-approved candidate but cannot select, modify, reset, replace, or promote it.

---

# 5. Protected execution-release broker — SELECTED

Use one dedicated AWS Lambda in `eu-west-1`:

```text
function:              fpllm-beta-execution-release-broker
reserved concurrency:  1
timeout:                <= 30 seconds
public Function URL:    disabled
```

The GitHub deployment role may receive only `lambda:InvokeFunction` against this exact function ARN. It cannot update function code/configuration, attach layers, alter environment variables, pass roles, change its resource policy, or invoke arbitrary Lambda functions.

## 5.1 Caller input is non-authoritative

The broker accepts only:

```json
{
  "requestId": "opaque-bounded-release-request-id"
}
```

Maximum decoded request body: **4 KiB**. Unknown fields are rejected.

The caller cannot supply authoritative build inputs such as a component selector, buildspec, source location, source version/hash, image/base digest, service role, privileged mode, cache/artifact/log configuration, environment variables, platform SHA, worker digest, or private-bundle identity.

## 5.2 Broker orchestration

For the current approved candidate the broker reconciles and, where permitted, starts the two protected builds:

```text
fpllm-beta-worker
fpllm-beta-hidden-evaluator
```

The broker constructs each project's allowlisted environment values only from the approved candidate record.

Per component:

```text
one active CodeBuild execution per approvalId
maximum CodeBuild starts per approvalId/component: 3
successful component: never rebuilt under the same approvalId
third failed start: component -> failed_locked
overall built: only when both protected component digests succeeded
new execution after failed_locked or completed promotion: new trusted approvalId required
```

Different caller request IDs cannot create concurrent or unbounded builds for one candidate.

## 5.3 Build-status reconciliation

On every invocation the broker first checks recorded active build IDs with `codebuild:BatchGetBuilds` and conditionally/transactionally updates DynamoDB before deciding whether a start is legal. A request replay may refresh status but never starts a duplicate concurrent build.

A failed component with start count below three may be retried only after failure is durably reconciled. Successful build digests are recorded into the candidate and become immutable inputs to promotion.

## 5.4 Broker authority

The broker role may:

- read/update only release-control/idempotency records in `fpllm-beta-sensitive-release`;
- `codebuild:StartBuild` only the exact two protected project ARNs;
- `codebuild:BatchGetBuilds` for their recorded build IDs;
- pass only allowlisted environment values derived from the trusted candidate;
- emit bounded structured release logs/metrics.

The broker cannot read/decrypt the private evaluator object, pull the hidden-evaluator image, push either protected ECR repository, mutate worker infrastructure, or alter protected IAM/policies.

---

# 6. Protected privileged-worker builder — SELECTED

Use a second protected CodeBuild project:

```text
project:             fpllm-beta-worker
region:              eu-west-1
source type:         NO_SOURCE
buildspec:           fixed in protected infrastructure configuration
cache:               NO_CACHE unless P1 proves a cache contains no executable/source state across approvals
artifacts:           NO_ARTIFACTS except non-secret release provenance
service role:        fixed worker-builder role
timeout:             <= 30 minutes
concurrent builds:   1
output:              fpllm/worker@sha256:<digest>
private evaluator:   no access
```

The fixed buildspec downloads the exact approved worker source-context S3 object version, verifies its SHA-256/platform identity, builds from that context with the repository lockfile/frozen dependency process, pushes only `fpllm/worker`, and records the resulting digest/provenance.

The worker-builder role may read only the non-secret release context required for the approved build, write its dedicated logs, authenticate to ECR, and push only `fpllm/worker`. It receives:

```text
no private evaluator S3 access
no release-material KMS decrypt
no hidden-evaluator ECR pull/push
no production DB credentials
no GitHub App/OAuth/webhook secrets
no worker-host SSM/instance-profile authority
```

Because this build handles no private evaluator material, it may use the ordinary outbound package-registry access required to reproduce the reviewed lockfile build. P1 must still record the realized egress and dependency integrity controls. A networked worker build is not permission to expose the private evaluator boundary to it.

GitHub Actions cannot push `fpllm/worker`; only this protected builder can.

---

# 7. Sensitive hidden-evaluator CodeBuild — FIXED INPUT + PRIVATE EGRESS

Freeze `fpllm-beta-hidden-evaluator` as:

```text
source type:          NO_SOURCE
buildspec:            fixed in protected infrastructure configuration
cache:                NO_CACHE
artifacts:            NO_ARTIFACTS
privileged mode:      fixed true only because Docker assembly requires it
logs:                 fixed dedicated private CloudWatch log group
S3 build logs:        disabled
service role:         fixed hidden-evaluator CodeBuild role
timeout:              <= 30 minutes
concurrent builds:    1
public build access:  disabled
VPC attachment:       required
Internet/NAT route:   none
```

The fixed protected buildspec does **not** execute scripts or a Dockerfile supplied by the GitHub caller or by a mutable public source context.

It receives only allowlisted approved values from the broker, then:

1. pulls the exact approved `fpllm/hidden-evaluator-base@sha256:...`;
2. verifies digest/provenance and confirms Docker `ONBUILD` is empty;
3. downloads the exact approved private evaluator S3 object version;
4. verifies byte size and committed SHA-256;
5. assembles the final image with a fixed protected packaging recipe whose sensitive step only adds the verified private bundle to the approved base;
6. executes no arbitrary `RUN` command after private material is introduced;
7. pushes only to `fpllm/hidden-evaluator`;
8. records final digest/non-secret provenance;
9. removes normal-path plaintext private material from the ephemeral workspace.

## 7.1 Sensitive-build network boundary

The sensitive builder runs in dedicated private build subnets with no usable Internet-gateway/NAT route and a security group with no ingress.

Required private AWS connectivity:

```text
S3 gateway endpoint             release-material path + ECR image-layer path
ECR API interface endpoint      approved base pull/final push API
ECR DKR interface endpoint      Docker registry pull/push
CloudWatch Logs interface       dedicated sensitive-build log group
AmazonProvidedDNS               VPC endpoint name resolution
```

If P1 proves a direct KMS API call from the build container is required, it may add the regional KMS interface endpoint with a policy limited to the release-material key; this does not authorize general Internet/NAT egress.

Endpoint policies/security groups must narrow resources/traffic to the practical minimum while preserving ECR's documented S3 layer path. A dependency that cannot operate through this private endpoint set reopens P0 before general egress is added.

Official basis:

- CodeBuild VPC/traffic privacy: https://docs.aws.amazon.com/codebuild/latest/userguide/security-traffic-privacy.html
- CodeBuild VPC support: https://docs.aws.amazon.com/codebuild/latest/userguide/vpc-support.html
- ECR VPC endpoints and S3 layer dependency: https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html
- S3 gateway endpoints: https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html

## 7.2 Sensitive-builder authority/hygiene

The hidden-evaluator CodeBuild role may pull only `fpllm/hidden-evaluator-base`, read only the private release-material path/version needed by the approved build, use only the release-material KMS authority required for that object, write its dedicated logs, and push only `fpllm/hidden-evaluator`.

All round-2 hygiene remains in force: no cache, no S3 build artifacts/logs, no `set -x`/environment dumps/private-byte logging, fixed project configuration, and sentinel-secret log/cache hygiene evidence.

---

# 8. Protected ECR policies — DEFENSE IN DEPTH

The two protected repositories use resource-policy guardrails in addition to identity policies.

## 8.1 `fpllm/worker`

- push/layer-upload authority: protected worker-builder role only;
- pull authority: production worker-host instance profile and explicitly required protected verification path only;
- GitHub OIDC/deploy roles: explicit no push/promotion authority;
- no repository/lifecycle-policy mutation through the normal GitHub deployment role.

## 8.2 `fpllm/hidden-evaluator`

The repository policy must enforce an explicit deny for image-content read/push actions to principals outside the allowlisted protected roles. At minimum the allowlist contains:

```text
hidden-evaluator CodeBuild role   push + required verification read
production worker instance role   pull only
```

GitHub OIDC/deploy roles, web task roles, worker-builder role, learner/evaluator containers, and GitHub-hosted runners receive no hidden-evaluator image-content read authority.

P1 must verify the effective policy with negative authorization tests; an identity policy added elsewhere must not silently grant a bypass to the protected repository content.

---

# 9. Privileged worker runtime and promotion — PROTECTED

The worker controller remains host-root-equivalent trusted computing base because it owns the Docker socket. That fact now drives release authority.

The following worker production resources/configuration move under the protected sensitive-release stack or an equivalently protected execution stack:

```text
worker ASG / launch template / bootstrap
worker instance profile
worker security group identity
worker controller image-digest configuration
hidden-evaluator image-digest configuration supplied to worker
worker drain/replacement control required for planned promotion
```

The normal GitHub OIDC/CDK deploy role cannot update those resources or select their image digests.

## 9.1 Promotion

A candidate is eligible for worker promotion only when the protected broker has recorded both:

```text
workerDigest = protected worker-builder output
hiddenEvaluatorDigest = protected sensitive-builder output
```

for the **same approvalId/platform source SHA**.

The trusted federated release operator then promotes those exact digests through the protected IaC/release path, subject to the already-frozen web/worker compatibility matrix and worker-drain procedure. No arbitrary digest supplied by GitHub Actions is accepted.

After promotion, the worker instance profile may still pull `fpllm/worker`, `fpllm/test-runtime`, and `fpllm/hidden-evaluator` as required by the frozen runtime. The accepted trusted-host TCP/443 egress remains, but the bytes controlling Docker authority are now independently approved/built/promoted outside GitHub's direct image-publish authority.

Unexpected worker loss still recovers through durable lease/retry semantics; this correction changes release authority, not learner-evidence semantics.

---

# 10. Protected sensitive-release stack boundary

The protected stack is version-controlled IaC but can be applied only by a trusted federated AWS operator / dedicated protected CloudFormation execution role.

It includes at minimum:

```text
protected worker CodeBuild project + role
protected hidden-evaluator CodeBuild project + fixed packaging recipe + role
execution-release broker Lambda + role
fpllm-beta-sensitive-release DynamoDB table/policies
private release-material S3 bucket/prefix policy + KMS policy
fpllm/worker protected repository policy
fpllm/hidden-evaluator protected repository policy
worker ASG/launch template/instance profile/security group/image configuration
dedicated sensitive-build subnet/endpoint policies where owned by this boundary
```

The GitHub OIDC/CDK path may synthesize/inspect committed source but cannot apply mutations to this protected stack, assume its CloudFormation execution role, pass its roles, or modify its protected resource policies.

The non-secret `fpllm/hidden-evaluator-base` repository and non-secret release-context publisher may remain in the normal release stack, subject to §2–§4 approval before protected use.

Protected-stack change procedure:

```text
reviewed source change
-> normal CI/review
-> trusted federated operator assumes protected deployment authority
-> deploy exact reviewed source identity/change set
-> retain CloudFormation/change-set + actor evidence
```

---

# 11. Required authorization, integrity, network, and abuse-control tests

P1 must retain evidence that GitHub OIDC/deploy principals cannot:

- directly start/retry/update either protected CodeBuild project;
- push `fpllm/worker` or `fpllm/hidden-evaluator`;
- read hidden-evaluator image content;
- mutate broker/DynamoDB approved-candidate state;
- read/decrypt private evaluator material;
- mutate worker ASG/launch template/instance profile/SG/image-digest configuration;
- mutate protected ECR/S3/KMS/IAM/CodeBuild/broker policies;
- assume the protected CloudFormation execution role.

P1 must also prove:

- GitHub can invoke only the exact broker function with the bounded request schema;
- replay and multiple request IDs cannot create concurrent/unbounded builds;
- each component is limited to three starts per approval and successful outputs cannot be rebuilt under that approval;
- the worker source context independently matches the reviewed source SHA before approval;
- the worker builder alone can push the worker repository and cannot access hidden/private material;
- the hidden builder alone can push the hidden repository and cannot reach the public Internet;
- the approved evaluator base has no private bundle/`ONBUILD` trigger;
- sentinel public-Internet exfiltration from the sensitive builder fails while required S3/ECR/Logs operations succeed;
- hidden repository content is unreadable by GitHub/web/worker-builder principals even if an identity policy elsewhere attempts to grant it;
- only protected builder outputs from one approvalId are accepted by the protected worker promotion path;
- an arbitrary GitHub-supplied worker or evaluator digest cannot be promoted;
- planned worker promotion uses drain semantics and abrupt host loss still preserves ordinary lease/retry provenance.

---

# 12. Cost, failure, and exit consequences

This correction adds one low-volume Lambda, one low-volume on-demand DynamoDB table, a protected worker CodeBuild project, one non-secret evaluator-base ECR repository, and private endpoints/dedicated subnet capacity for the sensitive evaluator build. The mandatory pre-create AWS Pricing Calculator/cost review must include all of these resources where supported.

The existing **USD 400–700/month** range remains only a planning target. The already-frozen **USD 900/month stop/review threshold** is authoritative: if the corrected exact topology estimates above it, provisioning stops for explicit cost/architecture review rather than weakening the trust boundary.

Failure model:

- broker/DynamoDB/protected builder unavailable -> new execution-tier release blocked; running production learner services unchanged;
- request replay -> idempotent/reconciled existing disposition;
- repeated protected build failure -> at most three starts/component then trusted reapproval;
- source/base/private-object provenance mismatch -> fail closed before protected output/promotion;
- protected-stack drift or unexpected sensitive-builder Internet reachability -> release blocked;
- protected worker promotion unavailable -> web release follows the compatibility gate and cannot silently deploy an incompatible execution contract.

Exit path remains IaC/OCI/PostgreSQL based. Replacing Lambda/DynamoDB, the independent worker builder, or the private-build network boundary requires a P0 amendment because it changes the privileged/sensitive release trust model.

---

# 13. Release evidence additions

The execution-tier release evidence package now binds:

```text
platform source SHA
approvalId + trusted approver identity/timestamp
worker source-context object version + SHA-256
protected worker CodeBuild project/build ID + output worker digest
non-secret evaluator-base digest + retained source provenance
private evaluator object version + committed SHA-256 + bytes
protected hidden-evaluator CodeBuild project/build ID + final evaluator digest
broker request/disposition/build-start counters
protected ECR effective-policy identities
sensitive-build VPC/subnet/SG/endpoint-policy identity + no-Internet preflight
protected worker ASG/launch-template/image-promotion identity
fixed protected buildspec/packaging identities
protected-stack CloudFormation/source/change-set identity
```

GitHub Actions evidence may reference these non-secret identities, but GitHub-hosted runners never receive private evaluator bytes or direct authority to publish/promote the worker/hidden-evaluator images that can reach them.

---

# 14. Review-state boundary

This round closes the direct CodeBuild-override and privileged-worker indirect-access gaps at the **decision/specification** level. It does not claim that the protected broker, builders, DynamoDB release control, ECR guardrails, protected worker deployment, IAM denies, or private endpoint network are implemented or verified.

The merge sequence restarts from this correction:

```text
CI/affected gates on the new exact HEAD
-> fresh exhaustive maintainer review of the complete P0 record
-> fix and repeat if any material flaw remains
-> request a fresh Codex review on that exact HEAD
-> disposition all actionable review threads
-> rerun affected gates if candidate changes
-> final exact-HEAD CI/review/thread check
-> squash merge
```

No earlier maintainer-clean statement or Codex review on an older commit satisfies this restarted gate.

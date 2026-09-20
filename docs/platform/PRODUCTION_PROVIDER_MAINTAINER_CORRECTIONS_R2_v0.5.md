# Platform v0.5 — Maintainer Corrections Round 2 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Second-review baseline:** `53dbec5f22c9905102a9cfad0c21980862613950`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and review disposition

This document records the findings from the second exhaustive maintainer review of PR #10 after the first correction round.

Precedence inside the P0 provider/operations record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > conflicting text in
      PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
      PRODUCTION_PROVIDER_DECISIONS_v0.5.md
      GITHUB_PROVIDER_LIMITS_v0.5.md
      GITHUB_ACTIONS_WEBHOOK_PROVIDER_v0.5.md
```

Non-conflicting decisions remain in force. This round corrects five residual decision/specification gaps found against `53dbec5f22c9905102a9cfad0c21980862613950`. It does not claim that P1/P2/P3 implementation or production evidence exists.

A new commit containing this delta is still **not maintainer-approved merely because these findings are documented**. The resulting exact HEAD must pass CI and then receive a fresh exhaustive maintainer review before Codex is asked for an independent second opinion.

---

# 1. RDS M8gd regional-availability source — CORRECTED

The M8gd availability decision in the first correction round remains unchanged. Only its stale/incorrect AWS What's New URL is superseded.

The official AWS announcement used for the Europe (Ireland) availability claim is:

- https://aws.amazon.com/about-aws/whats-new/2026/07/amazon-rds-aurora-r8gd-m8gd-regions/

The frozen selection remains Amazon RDS for PostgreSQL 18.6 on `db.m8gd.large` in `eu-west-1`, subject to the already-required live orderable-options check for the exact engine minor, instance class and storage combination before any P1 create action.

P1 must treat the live provider API result as authoritative for actual orderability. A documentation statement or historical availability announcement is not sufficient production admission evidence.

---

# 2. Worker outbound-network posture — EXPLICIT POLICY

The first correction round's phrase “minimum practical outbound paths” is superseded by this explicit v0.5 rule set.

## 2.1 Trust boundary

The broadest egress below applies only to the **trusted EC2 host and trusted worker-controller process**. Learner/public/probe/hidden-evaluator sandboxes remain `--network=none`; this section does not grant learner code any network path.

The worker security group has:

```text
ingress: none

egress:
  TCP 443 -> 0.0.0.0/0
      trusted-host HTTPS only, required for GitHub plus AWS public service endpoints

  TCP 5432 -> production RDS security group
      PostgreSQL only

  no other project-defined Internet egress rules
```

The existing no-NAT/public-IPv4 choice means an EC2 security group cannot robustly restrict HTTPS by DNS name while still reaching GitHub's and AWS services' changing public addresses. v0.5 therefore accepts **TCP/443-to-Internet egress for the trusted host** as an explicit beta risk rather than pretending that the security group provides hostname allowlisting.

The compensating controls are:

- learner/evaluator containers have no network namespace access to the Internet;
- the worker controller is part of the trusted computing base;
- AWS API authority is constrained by the instance profile, not by destination IP alone;
- GitHub authority is constrained to the GitHub App credentials and provider permissions already frozen;
- no inbound worker path exists;
- no SSH key/port exists;
- production workloads use TLS certificate validation and do not disable HTTPS verification;
- CloudWatch/worker telemetry records provider/error metadata without secrets.

## 2.2 DNS

Use `AmazonProvidedDNS` / Route 53 VPC Resolver for the worker. AWS documents that security groups and network ACLs cannot filter traffic to or from the Route 53 Resolver, so the design must not claim a security-group DNS allowlist that AWS cannot enforce.

Route 53 Resolver DNS Firewall is **not selected for the initial v0.5 beta**. The accepted consequence is that a compromise of the trusted worker host/controller is already a trusted-tier security event and DNS is not treated as a separate sandbox-containment boundary. The untrusted execution boundary remains network-disabled.

If later threat modeling requires domain-level egress filtering for the trusted worker, that is a P0 network/cost amendment involving DNS Firewall, AWS Network Firewall, a controlled egress proxy, private endpoints/NAT, or an equivalent reviewed design.

Official basis:

- security-group behavior and Route 53 Resolver limitation: https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html
- AmazonProvidedDNS considerations: https://docs.aws.amazon.com/vpc/latest/userguide/AmazonDNS-concepts.html

---

# 3. ECR least-privilege IAM and repository boundary — FROZEN

The generic statements “may pull required repositories” and “may push the hidden evaluator” are superseded by this explicit role/action split. P1 must generate and review exact account/region repository ARNs from this matrix.

## 3.1 Common registry authentication rule

`ecr:GetAuthorizationToken` cannot be usefully scoped to one repository and is allowed with `Resource: "*"` only for principals that need ECR authentication. That permission does **not** itself grant repository push/pull access.

## 3.2 CodeBuild hidden-evaluator role

The CodeBuild service role for `fpllm-beta-hidden-evaluator` may authenticate to ECR and may push **only** to:

```text
arn:aws:ecr:eu-west-1:<ACCOUNT_ID>:repository/fpllm/hidden-evaluator
```

Repository-scoped actions are limited to those required for a Docker push and release verification:

```text
ecr:BatchCheckLayerAvailability
ecr:InitiateLayerUpload
ecr:UploadLayerPart
ecr:CompleteLayerUpload
ecr:PutImage
ecr:BatchGetImage
ecr:GetDownloadUrlForLayer      # only if the selected build/push path needs layer reads
ecr:DescribeImages              # release-digest verification only
```

It receives no `PutImage`, upload, delete, lifecycle-policy or repository-administration permission for `fpllm/web`, `fpllm/worker`, or `fpllm/test-runtime`.

## 3.3 Worker EC2 instance profile

The worker instance profile may pull only:

```text
fpllm/worker
fpllm/test-runtime
fpllm/hidden-evaluator
```

with repository-scoped read actions:

```text
ecr:BatchCheckLayerAvailability
ecr:BatchGetImage
ecr:GetDownloadUrlForLayer
ecr:DescribeImages              # digest/provenance verification only
```

It has no ECR image upload or `PutImage` permission.

## 3.4 ECS web task execution role

The ECS/Fargate **task execution role**, not the web application task role, may pull only `fpllm/web` using the same required repository-scoped pull actions. The web application task role itself receives no ECR repository mutation permission.

## 3.5 GitHub deployment/CDK roles

The production GitHub deployment path may publish the non-hidden image repositories required by the release workflow, but must have no `PutImage` or layer-upload authority on `fpllm/hidden-evaluator`. Production hidden-evaluator push authority belongs only to the dedicated CodeBuild role.

Repository resource policies and IAM identity policies must not accidentally widen these boundaries. P1 retains the synthesized/effective IAM policy and a negative authorization test proving the GitHub deployment role cannot read private evaluator release material or push the hidden-evaluator repository, and that the CodeBuild role cannot push the non-hidden repositories.

Official basis:

- least-privilege ECR push example: https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html
- ECR actions/resources: https://docs.aws.amazon.com/service-authorization/latest/reference/list_ecr.html
- ECS task execution ECR pull requirements: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html

---

# 4. Sensitive CodeBuild hygiene — FROZEN

The hidden-evaluator production build handles private evaluator material and therefore uses a stricter build configuration than ordinary non-secret image builds.

Freeze:

```text
project cache:           NO_CACHE
local Docker layer cache: disabled
S3 cache:                disabled
build artifacts:         NO_ARTIFACTS for private bundle/build workspace
CloudWatch Logs:         enabled to dedicated private log group
S3 build logs:           disabled
public build access:     disabled
build timeout:           <= 30 minutes
concurrent builds:       1
```

`privilegedMode=true` remains permitted only because the selected Docker build path requires it; it is not permission to retain a reusable Docker-layer cache.

The build must:

1. receive the immutable public source-context object identity and exact private-bundle S3 key/version as explicit release inputs;
2. use `s3:GetObjectVersion`/equivalent version-pinned retrieval semantics where the SDK/CLI path supports it and verify the returned object version and SHA-256 before use;
3. decrypt only through the release-material KMS key required for that object, with service/key conditions narrowed during P1 where supported;
4. never use `set -x`, print environment variables wholesale, echo secret values, or emit private evaluator source/archive bytes to stdout/stderr;
5. materialize private evaluator input only in the ephemeral CodeBuild workspace, verify it against the public commitment, build the image, and remove temporary plaintext files on the normal completion path;
6. publish only the digest-pinned hidden-evaluator image and non-secret release provenance; no private source archive/build context becomes a CodeBuild artifact;
7. retain CloudWatch logs for the same 30-day initial application-log period unless P1 records a stricter dedicated retention;
8. run a P1 hygiene test with non-production sentinel secret material proving the build/log path does not echo the sentinel and that no cache/artifact containing it survives the build.

The private bundle's cryptographic hash and object version are provenance and may be logged; its contents are not.

AWS documents that CodeBuild can be configured with **No cache**, and that local Docker-layer caching is a reusable build cache requiring privileged mode. AWS also permits CloudWatch and/or S3 build logs; this contract deliberately enables only the dedicated CloudWatch log path for the sensitive builder.

Official basis:

- CodeBuild project cache/log configuration: https://docs.aws.amazon.com/codebuild/latest/userguide/create-project.html
- CodeBuild caching behavior: https://docs.aws.amazon.com/codebuild/latest/userguide/build-caching.html

---

# 5. GitHub provider throttling is a deferral, not an execution retry — FROZEN

The first correction round required provider throttling not to consume the normal infrastructure retry budget. This section defines the durable semantics needed to make that statement executable.

## 5.1 Separate counters and states

P1 must separate **queue/lease activity**, **provider deferral**, and **evaluator execution attempts**. Reusing today's single `Job.attemptCount` for all three is not sufficient.

The durable model must represent semantically equivalent state to:

```text
job state:
  queued
  provider_deferred
  leased / preparing_source
  running_public
  running_hidden
  finalizing
  terminal states

provider metadata:
  provider = github
  providerDeferCount
  providerDeferredUntil / nextAttemptAt
  providerReasonCode
  observedRateLimitResetAt / retryAfterSeconds where supplied
  lastProviderStatus

execution attempt accounting:
  evaluatorAttemptCount
```

Exact column/model names may differ, but the separation is mandatory.

## 5.2 Accounting rule

A GitHub rate-limit or retryable provider-throttle condition discovered **before learner/public/hidden evaluator execution starts** releases the work into `provider_deferred` and:

```text
does not increment evaluatorAttemptCount
does not consume the ordinary infrastructure execution-retry budget
records a durable provider-deferral event
sets the next eligibility time from provider guidance
```

Lease acquisition may be counted separately for observability, but it is not an evaluator attempt.

Once a sandbox/evaluator execution has actually begun, an unrelated execution/infrastructure failure follows the normal bounded execution-attempt semantics. Provider deferral must never be used to erase or hide an execution attempt that really occurred.

## 5.3 Scheduling rule

For GitHub REST throttling:

- if `retry-after` is present, do not retry before that interval;
- else if `x-ratelimit-remaining == 0`, do not retry before `x-ratelimit-reset`;
- otherwise, for a secondary limit, wait at least 60 seconds and use exponentially increasing delays on repeated failures;
- never busy-poll or repeatedly lease a job before its durable provider-deferred time;
- capture rate-limit headers/correlation metadata but never tokens or private repository content.

These rules follow GitHub's current documented rate-limit guidance.

## 5.4 Bounded terminal behavior

Provider deferral is not allowed to become indefinite polling. For the initial beta freeze:

```text
maximum provider deferrals for one accepted job: 8
maximum provider-deferred wall-clock horizon:     24 hours from first provider deferral
```

Exceeding either bound produces a terminal **external-dependency/provider** diagnostic, not a learner invariant failure and not an `infrastructure_error` that implies the evaluator itself malfunctioned. The learner may retry through a supported product path after GitHub access/quota recovers.

Permanent authorization loss, repository deletion, installation revocation, or source-envelope rejection bypasses throttle deferral and goes directly to the appropriate learner/action-required or terminal provider diagnostic.

P1/P3 tests must prove that repeated `403`/`429` provider deferrals do not reduce the evaluator execution-retry budget, that a job is not eligible before `providerDeferredUntil`, and that the 8-deferral/24-hour bounds terminate diagnostically.

Official basis:

- GitHub REST rate limits and retry guidance: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GitHub REST best practices: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api

---

# 6. Round-2 P1 evidence additions

In addition to all non-conflicting P1 evidence requirements already frozen, P1 must retain:

1. realized worker security-group rules matching §2, with proof that the 443 Internet rule belongs only to the trusted worker tier and every learner/evaluator sandbox still executes with network disabled;
2. effective ECR IAM/repository policies plus negative authorization tests for the CodeBuild, worker, ECS execution and GitHub deployment roles;
3. CodeBuild project configuration proving `NO_CACHE`, no S3 build logs/artifacts, dedicated CloudWatch logging and sentinel-secret log/cache hygiene;
4. schema/state-transition tests proving GitHub provider deferral is separate from evaluator attempt accounting and terminates under the frozen bounds;
5. the live RDS orderability result, not merely the corrected regional-availability documentation.

---

# 7. Review-state boundary

This round closes maintainer findings FPR2-01 through FPR2-05 raised against `53dbec5f22c9905102a9cfad0c21980862613950` at the **decision/specification** level.

The mandatory next sequence is:

```text
CI/affected gates on the new exact HEAD
-> fresh exhaustive maintainer review of that exact HEAD
-> fix and repeat if any material flaw remains
-> only after maintainer review is clean, request Codex independent review
-> disposition Codex findings and rerun affected gates
-> final exact-HEAD checks
-> squash merge
```

No Codex review is requested merely because this correction file exists, and no merge occurs before the sequence above is complete.

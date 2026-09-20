# Platform v0.5 — Maintainer Corrections to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**First-pass review baseline:** `08fe2e993fd37068a489df6c842d8b90bf3810f7`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and review disposition

This document records the corrections produced by the exhaustive maintainer-first review of PR #10. It is part of the linked Platform v0.5 P0 provider/operations record.

Precedence inside the P0 record is:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in
      PRODUCTION_PROVIDER_DECISIONS_v0.5.md
      GITHUB_PROVIDER_LIMITS_v0.5.md
      GITHUB_ACTIONS_WEBHOOK_PROVIDER_v0.5.md
```

Non-conflicting decisions in the parent/companion records remain in force.

The review found two blocking provider assumptions and twelve additional high/medium/low gaps. This correction delta closes the **decision/specification** gaps only. It does not claim that the corresponding P1/P2/P3 implementation or production evidence exists.

P0 is closed only when this correction delta and its parent records are merged together. If P1 cannot realize any corrected decision below without weakening a frozen security/evidence invariant, P0 reopens by committed amendment.

---

# 1. RDS PostgreSQL instance class — CORRECTED

## 1.1 Superseded decision

The parent record's `RDS PostgreSQL 18.6 + db.t3.small` combination is invalid and is superseded.

AWS's current DB-engine/instance-class support table does not support PostgreSQL 18 on `db.t3.*`. The project cannot downgrade PostgreSQL because the frozen schema/migration baseline relies on PostgreSQL 18 `uuidv7()`.

## 1.2 Corrected selection

Use:

```text
engine:                 Amazon RDS for PostgreSQL 18.6
region:                 eu-west-1
availability:           Single-AZ for initial beta
instance class:         db.m8gd.large
architecture:           AWS Graviton4
vCPU / RAM:             2 vCPU / 8 GiB
optimized-reads NVMe:   provider-managed ephemeral local storage; never learner/evidence authority
RDS durable storage:    gp3, 20 GiB initial
storage autoscale max:  100 GiB
public access:          disabled
encryption at rest:     enabled
backup retention:       7 days
PITR:                   enabled
deletion protection:    enabled
```

AWS documents `db.m8gd.large` as supporting PostgreSQL 18.1 and higher; PostgreSQL 18.6 is therefore inside the supported engine range. AWS has made M8gd available in Europe (Ireland). P1 must still perform a live `eu-west-1` orderable-options check for **the exact engine minor + class + storage combination** before any create action. Failure is a hard P0-reopen condition, not permission to fall back silently.

The local NVMe/Optimized Reads storage on M8gd is performance scratch/cache only. Durable PostgreSQL state, backups, PITR and learner evidence remain on RDS-managed durable storage. No recovery procedure may depend on M8gd local NVMe contents.

This correction supersedes every `db.t3.small`, `2 GiB` and related old RDS cost/sizing reference in the parent record.

Official basis checked at correction freeze:

- supported DB engines/classes: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.Support.html
- PostgreSQL 18.6 RDS release: https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-release-calendar.html
- DB class hardware: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.Summary.html
- M8gd regional availability: https://aws.amazon.com/about-aws/whats-new/2026/07/amazon-rds-postgresql-mysql-mariadb-m8gd-r8gd-additional-regions/

---

# 2. GitHub Actions OIDC subject — CORRECTED

## 2.1 Immutable default subject

The parent GitHub Actions companion's legacy name-only OIDC `sub` is superseded.

This repository was created on 2026-09-18, after GitHub's 2026-07-15 immutable-subject cutoff. The expected default production-environment subject therefore includes immutable owner and repository IDs:

```text
repo:ElephantRock@291361418/First-principles-LLM-Research@1375604193:environment:production
```

The AWS trust policy must use exact `StringEquals` for both:

```text
token.actions.githubusercontent.com:aud = sts.amazonaws.com
token.actions.githubusercontent.com:sub = repo:ElephantRock@291361418/First-principles-LLM-Research@1375604193:environment:production
```

No wildcard owner/repository/environment subject is permitted.

## 2.2 Branch authority is separate from the environment subject

An environment-context `sub` does not encode the source branch. Therefore the production environment and production workflow must both fail closed to `main`:

```text
GitHub environment: production
allowed deployment branch: main only
workflow trigger: workflow_dispatch only
runtime guard: github.ref == refs/heads/main
candidate identity: exact github.sha from main
```

P1 must retain evidence for the environment deployment-branch policy as well as the workflow guard.

## 2.3 Verify actual repository OIDC configuration first

Before creating the AWS IAM trust policy, P1 must read the repository's effective OIDC subject configuration and record it. The immutable subject above is the expected GitHub default for this repository's creation date. If repository/org customization produces another subject, **stop before role creation** and amend P0; do not broaden IAM trust merely to make the workflow pass.

Official basis:

- GitHub OIDC reference / immutable subject claims: https://docs.github.com/en/enterprise-cloud@latest/actions/reference/security/oidc
- GitHub OIDC for AWS: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws

---

# 3. Production hidden-evaluator release chain — COMPLETED DECISION

The production private-evaluator path is frozen as a two-input trusted build. The GitHub-hosted runner may handle the **public/non-secret source context**, but may never read the private evaluator archive or its KMS plaintext.

## 3.1 Private bundle publication

The authoritative private bundle is uploaded to the release-only S3 bucket by a trusted operator using **short-lived federated AWS credentials** (AWS IAM Identity Center or equivalently bounded federation). Static AWS access keys and GitHub Actions are not permitted for private-bundle publication.

Object identity is content addressed:

```text
s3://<release-material-bucket>/private-evaluator/
  phase1-causal-attention@1.0/<archive-sha256>.tar.gz
```

The upload procedure must:

1. verify archive byte size and SHA-256 against `hidden-tests/phase1/causal-attention/private-bundle-commitment.json`;
2. require bucket versioning and SSE-KMS;
3. record S3 object version ID, ETag/size and commitment SHA-256 without recording bundle contents;
4. deny the GitHub OIDC broker/deploy roles `s3:GetObject` and `kms:Decrypt` for this prefix/key;
5. permit only the dedicated CodeBuild service role and the bounded trusted uploader principal to read/write as required.

At the reviewed baseline the public commitment is:

```text
bundle:        phase1-causal-attention@1.0
archive bytes: 4473
archive sha256: 42c57f9fbd7650565c0d5bc6954b732a0cdfd3062388d8b2995f4f58b5ff23f8
```

If the exact committed private archive is no longer available to the trusted release operator, production release stops. A newly generated private bundle requires a reviewed update to the public commitment; its bytes must never be substituted under the old commitment.

## 3.2 Immutable non-secret build context

The release workflow creates a deterministic source archive from the frozen `main` source SHA and uploads it to a separate non-secret release-context prefix/bucket in `eu-west-1`:

```text
release-context/<source-sha>/<context-sha256>.tar.gz
```

The context contains only the reviewed public repository material required to build the hidden-evaluator image (Dockerfile/build scripts/public commitment); it contains no private evaluator source. Its S3 object version and SHA-256 are recorded.

CodeBuild must consume this immutable context, not mutable `main`, a floating branch, or an unpinned repository checkout.

## 3.3 CodeBuild execution mode

Freeze the production hidden-evaluator builder as:

```text
project:            fpllm-beta-hidden-evaluator
region:             eu-west-1
compute:            BUILD_GENERAL1_MEDIUM or current equivalent >= 4 vCPU / 8 GiB
mode:               Linux container
Docker build:       explicitly enabled; privilegedMode=true where required by the selected CodeBuild image
VPC attachment:     none for v0.5 unless a later amendment supplies the required egress/endpoints
job timeout:        <= 30 minutes
concurrent builds:  1 for this release path
output:             private ECR fpllm/hidden-evaluator@sha256:<digest>
```

P1 pins the exact supported CodeBuild image/runtime and proves it can build the current CPU PyTorch evaluator before production use.

The CodeBuild role may read only:

- the exact immutable non-secret context object;
- the exact versioned private-bundle object and its KMS key;
- required ECR auth/repository operations for `fpllm/hidden-evaluator`;
- its own build logs.

It receives no DB, OAuth, GitHub App, webhook, learner evidence or worker administration credential.

## 3.4 Release identity

The hidden-evaluator release record is incomplete unless it binds all of:

```text
platform source SHA
public source-context object version + SHA-256
private evaluator S3 object version + committed SHA-256
CodeBuild project + build ID
Dockerfile/base-image identity
private evaluator version/testBundleId
hidden evaluator ECR digest
```

---

# 4. Trusted EC2 worker execution model — FROZEN

## 4.1 Worker controller container

The selected private ECR `fpllm/worker` image is the trusted worker-controller process and runs on the single `m7i.xlarge` EC2 host. It is **not** a learner sandbox.

The worker controller runs as a non-root process where practical, but it is intentionally granted access to the host Docker socket in order to create learner/evaluator sandboxes. Docker-socket possession is host-root-equivalent authority and is part of the trusted computing base; documentation and telemetry must never describe this controller as host-unprivileged.

Required host/controller mapping:

```text
host /var/run/docker.sock -> worker controller /var/run/docker.sock
host /srv/fpllm/work      -> worker controller /srv/fpllm/work (same absolute path)
```

The same-path work mount is mandatory because sibling sandbox bind mounts are resolved by the **host Docker daemon**, not by the worker controller's container filesystem.

No learner/evaluator container receives the Docker socket.

## 4.2 Worker host storage

Freeze an encrypted gp3 root/work volume of at least **80 GiB** for the initial host. P1 records the exact EBS volume size/IOPS/throughput and alarms on free space/inode pressure. Workspaces are per-execution ephemeral directories and are removed after completion; host disk is never authoritative learner evidence.

Worker replacement or loss may discard the ephemeral workspace because the durable queue/evidence state remains PostgreSQL-owned.

## 4.3 Worker outbound/network posture

The no-NAT beta uses an IPv4 public subnet for the worker with:

```text
public IPv4 association: explicit and required for v0.5 no-NAT outbound path
security-group ingress:  none
SSH/22:                  none
administration:          SSM only
IMDS:                    IMDSv2 required; hop-limit configured for the selected controller topology
```

Security-group egress is restricted to the minimum practical outbound paths for GitHub HTTPS, ECR/STS/CloudWatch/SSM/AWS APIs, RDS and DNS. P1 records the realized egress design. If a later design removes public IPv4, it must provide VPC endpoints/NAT and update the cost/network record before disabling the existing egress path.

## 4.4 ECR pulls

The host instance profile may pull only the required worker/runtime/evaluator ECR repositories and emit logs/metrics/SSM telemetry. Use the ECR Docker credential helper or an equivalently short-lived ECR login flow; no long-lived registry credential is written into the worker image.

Every production image reference remains digest pinned.

---

# 5. Production evaluator/test distribution — CORRECTED

For production, **both** test surfaces are image-baked and digest-versioned:

```text
learner/test-runtime image:
  generic probe
  public Causal Attention test runner/bundle
  no private evaluator material

hidden-evaluator image:
  private evaluator runner/bundle
  no learner repository source
```

Production execution must not depend on either:

```text
FPLLM_PUBLIC_TEST_BUNDLE_ROOT
FPLLM_PRIVATE_TEST_BUNDLE_ROOT
```

as host-mounted test roots.

P1 refactors the production worker runtime and host preflight to use the image-baked paths. The existing mount-based public/private bundle code may remain only behind an explicit non-production/staging mode used by the guarded v0.3 staging harness.

Required P1 tests prove:

- learner runtime image contains the expected public bundle identity and no private bundle files;
- hidden-evaluator image contains the committed private bundle identity;
- learner/public/probe containers have no hidden-evaluator mount/path;
- hidden evaluator has no learner workspace mount and communicates only over the frozen Unix-socket ABI;
- runtime image labels, source SHA, testBundleId and evaluator version agree with release provenance.

---

# 6. GitHub immutable-source admission — PRE-FLIGHT THE WHOLE MANIFEST

The GitHub envelope in `GITHUB_PROVIDER_LIMITS_v0.5.md` remains in force, with this stricter ordering requirement.

Before the first blob GET for a submission, the worker/source client must completely validate the recursive tree response:

1. `truncated === false`;
2. total provider-returned entries <= 2,000, including directories;
3. every materialized entry is a supported regular blob/mode;
4. every repository-relative path passes traversal/control-character/segment checks **and** is <= 512 UTF-8 bytes;
5. each blob size is a safe integer, non-negative and <= 16 MiB;
6. regular materialized files <= 500;
7. summed source size <= 128 MiB using overflow-safe arithmetic;
8. observed GitHub installation rate-limit budget can cover the full blob request estimate plus the frozen operational reserve.

Only after all eight checks pass may blob materialization begin.

P1/P3 regression tests must use a counting fake source client and prove **zero blob reads** when any manifest-level check fails, including an invalid final entry. Provider throttling/defer logic must not consume the ordinary infrastructure retry budget merely because GitHub's reset window has not elapsed.

---

# 7. GitHub installation webhook state — CORRECTED

## 7.1 Explicit authority state

The current `suspendedAt`-only schema is insufficient for deletion/revocation. P1 introduces an explicit persisted installation authority state or semantically equivalent fields that can represent at least:

```text
active
suspended
revoked
```

A `deleted` installation webhook transition maps to `revoked` and preserves the historical installation numeric ID for provenance. It must never upsert a deleted installation back into an active-looking row.

Repository/source authority requires the local installation state to be `active` **and** the live GitHub installation/token/repository operation to succeed. Historical `RepositoryBinding` rows remain evidence/provenance and are not authority by themselves.

## 7.2 Delivery idempotency

P1 persists `X-GitHub-Delivery` under a uniqueness constraint, either in a dedicated `GitHubWebhookDelivery` model or an equivalently durable idempotency record. A duplicate delivery must return a deterministic accepted/no-op response and must not create a second authoritative transition or conflicting audit history.

The transaction that applies installation state and records the delivery must be atomic.

## 7.3 Bounded parsing and allowlist

Before JSON parsing:

```text
maximum raw webhook body: 256 KiB
required event:            installation
required delivery id:      non-empty bounded identifier
required signature:        valid current or bounded previous HMAC secret
```

The handler uses an explicit schema for the fields it needs; it does not deserialize an unbounded `any` payload into authoritative state.

Recognized authority-changing actions are at least:

```text
created      -> active
suspend      -> suspended
unsuspend    -> active
deleted      -> revoked
```

Other signed `installation` actions are either handled explicitly or accepted as a non-authoritative audited no-op. Events other than `installation` are not allowed to mutate installation state and should return a bounded ignored response rather than creating generic authoritative audit state from arbitrary signed payloads.

## 7.4 Secret rollover

The previously frozen <=15-minute dual-secret rotation requirement remains. Tests must cover current secret, previous-within-window, expired previous secret, invalid signature, duplicate delivery, suspend, unsuspend and delete/revoke.

---

# 8. Public write/body bounds — REQUIRED BEFORE EXTERNAL BETA

The no-learner-object-store decision remains valid only if structured evidence/request surfaces are bounded.

P1/P2 freeze these HTTP/application bounds unless a narrower route already applies:

```text
default authenticated JSON write body: 256 KiB
environment-report raw JSON body:        64 KiB
GitHub webhook raw body:                 256 KiB
```

The environment report's nested `report` field must additionally enforce bounded JSON complexity before persistence:

```text
maximum serialized report payload: 48 KiB
maximum nesting depth:               8
maximum object/array members total:   512
maximum individual string value:      8 KiB
```

The exact implementation may be streaming/length-header aware, but it must not rely solely on `Content-Length`; the server must stop reading once the hard byte cap is exceeded.

P1/P2 tests cover oversized chunked bodies, deeply nested JSON, excessive key/member counts and valid boundary-size reports. Rejections are learner/request diagnostics and do not create partial evidence rows.

This section does not authorize arbitrary binary artifacts in PostgreSQL.

---

# 9. ECS Express security-group topology — CORRECTED

AWS documents custom security groups on an Express service as an additional path relative to the Express-managed security-group topology. Therefore any project-owned security group attached to the Express service solely to provide stable RDS source identity must have:

```text
ingress rules: zero
```

The Express-managed ALB/service security-group path remains the only web ingress path.

RDS 5432 may trust a dedicated zero-ingress web identity SG and the worker SG as sources. P1 must inspect the realized service ENIs/security-group graph after provisioning and fail the gate if the task ENIs have any direct public application-port ingress path outside the Express-managed load-balancer route.

If ECS Express cannot support this identity/reference arrangement while retaining zero direct ingress, stop and reopen P0 rather than widening task ingress.

Official basis:

- ECS Express networking/resources: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.html
- CreateExpressGatewayService network configuration: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CreateExpressGatewayService.html

---

# 10. Cost envelope — CORRECTED

The old USD 250–400 planning range is superseded because it was based on the invalid `db.t3.small` choice and did not conservatively include the corrected PostgreSQL 18 class, worker EBS, CodeBuild, release-only S3/KMS and associated telemetry.

Use this **planning-only** initial envelope:

```text
expected planning range:        USD 400–700 per 30-day month
monthly budget alert:           USD 700
mandatory cost review threshold: USD 900
```

This is not an AWS quote and is not permission to provision. Before any P1 create operation, retain a fresh `eu-west-1` AWS Pricing Calculator estimate using the exact corrected RDS class, EC2/EBS, ECS/Fargate/Express/ALB, ECR, CodeBuild, release S3/KMS, Secrets Manager and CloudWatch assumptions.

If the fresh estimate exceeds USD 900/month for the frozen 3–5 learner beta, provisioning stops for an explicit cost/architecture review. Do not silently downsize security/reliability controls to hit the planning range.

---

# 11. Single-worker replacement/drain — FROZEN

Planned worker replacement is different from unexpected host loss.

Before an intentional ASG/AMI/worker-image replacement with ASG 1/1/1:

1. stop leasing new jobs using an explicit worker-drain control;
2. allow the current lease to reach a terminal state for a bounded drain window;
3. if no lease remains, stop the worker controller cleanly and replace the host;
4. if the drain deadline expires, terminate only under the ordinary lease-loss semantics so durable work becomes eligible after lease expiry and the retry event records provenance;
5. start replacement host, run full worker/gVisor/image preflight, then re-enable leasing.

Do not kill a healthy active learner job merely to shorten a compatible deployment.

Unexpected host loss continues to use the existing durable lease-expiry/retry mechanism; no operator DB edits are permitted.

P1/P5 must test both planned drain and abrupt host termination.

---

# 12. gVisor selection must be executable, not documentary

The production sandbox contract requires explicit gVisor execution.

P1 must update learner/public/probe/hidden evaluator Docker invocations to select:

```text
--runtime=runsc
```

or prove an equivalent daemon-level default while still emitting/asserting the resolved runtime identity for every sandbox.

The worker-host preflight must:

- verify `runsc` is installed and registered with Docker;
- run its learner and evaluator sentinels under `runsc`;
- retain runtime identity in the preflight evidence;
- fail if either production sandbox falls back to `runc`/the daemon default unexpectedly.

The existing network/read-only/cap-drop/no-new-privileges/non-root/CPU/RAM/PID/time constraints remain additive to gVisor, not replaced by it.

---

# 13. Release source-of-truth split — CORRECTED

Production image construction is split deliberately:

```text
GitHub-hosted release runner:
  build/publish non-hidden web, worker, learner/test-runtime images
  using exact frozen source SHA

AWS CodeBuild:
  build/publish hidden-evaluator image only
  using exact frozen source context + exact committed private-bundle object
```

The GitHub-hosted runner must not build a production hidden-evaluator image from a secret or a host-mounted private bundle.

Every promoted image records the same platform source SHA in OCI provenance. The hidden evaluator additionally records the private evaluator commitment/object version and CodeBuild ID.

A release cannot combine a web/worker/runtime digest from one source SHA with a hidden-evaluator digest built from another platform source SHA unless a reviewed compatibility record explicitly establishes why that is safe; the normal v0.5 path requires one frozen source SHA.

---

# 14. AWS CDK/ECS Express capability gate

P1 pins the AWS CDK v2 version in the repository. Before provisioning, a clean checkout must successfully synthesize the intended `AWS::ECS::ExpressGatewayService` topology and expose the managed service/security-group/endpoint outputs required by the network and smoke checks.

If the selected CDK/CloudFormation surface is unavailable, materially changed, or cannot express the frozen Express configuration, P1 stops and reopens P0. It must not silently switch to conventional ECS/ALB or console-only infrastructure.

Official basis:

- CloudFormation `AWS::ECS::ExpressGatewayService`: https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-expressgatewayservice.html

---

# 15. Corrected P1 implementation/evidence checklist

In addition to the non-conflicting parent P1 checklist, P1 must now retain evidence for all of the following before external beta:

1. live RDS orderable-options check for PostgreSQL 18.6 + `db.m8gd.large` + selected storage in `eu-west-1`;
2. exact repository OIDC subject configuration, immutable owner/repo IDs, `main`-only production environment and IAM trust;
3. immutable public build context and trusted private-bundle publication with object versions/SHA commitments;
4. CodeBuild Docker-capable hidden-evaluator build and proof GitHub-hosted runners cannot read private material/KMS plaintext;
5. trusted worker-controller container topology, same-path workspace bind, Docker-socket TCB acknowledgement, encrypted worker disk, IMDSv2 and short-lived ECR auth;
6. image-baked public/private test distribution with no production host test-bundle roots;
7. whole-tree source preflight with zero blob reads on any manifest rejection and provider-budget-aware admission;
8. explicit active/suspended/revoked GitHub installation state, atomic webhook-delivery idempotency, bounded webhook parsing and tested dual-secret rollover;
9. bounded HTTP/JSON writes, including environment-report complexity limits;
10. realized ECS Express SG graph proving no direct task ingress;
11. fresh AWS Pricing Calculator estimate under the corrected resource set;
12. planned worker drain + abrupt loss recovery drills;
13. learner and evaluator sentinels running under `runsc` with retained runtime identity;
14. CDK version pin + clean synthesis of the Express resource and required managed outputs;
15. image/release provenance binding all production digests to the same frozen platform source SHA.

P1 is not complete merely because these controls appear in code or CDK. The relevant production/staging gates must exercise and retain evidence for them.

---

# 16. Review-state boundary

This delta closes the maintainership **decision** findings FPR-01 through FPR-14 raised against `08fe2e...`. It does not by itself make a later commit maintainer-approved.

After these corrections are committed:

```text
run CI/affected static gates
-> perform a fresh exhaustive maintainer review of the new exact HEAD
-> fix any maintainer findings and repeat as needed
-> only then request Codex as an independent second opinion
```

No merge occurs before that sequence is complete.
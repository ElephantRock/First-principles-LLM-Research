# Platform v0.5 — Production Provider & Operations Decisions

**Status:** P0 FROZEN / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Baseline:** `aa88e7ccb7f15e9105226ab4b9262c6dbe864f41`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  
**Authority:** this is the linked v0.5 P0 decision record contemplated by the governing contract. It supersedes `PROJECT_DECISIONS_v1.2.md` §1.4 item 4 only with respect to whether v0.5 production-provider selection remains open. It does not supersede any frozen security, evidence, learner, or release-gate invariant.

---

## 0. Gate outcome

Platform v0.5 P0 is **CLOSED by decision** when this record is merged.

This document selects the production provider/operations baseline required before infrastructure implementation. It does **not** claim that any production resource has been provisioned, any credential has been created, any real OAuth/App callback has succeeded, any backup has been restored, or any P1–P7 gate has passed.

The production baseline is deliberately small: one Causal Attention vertical slice for an initial 3–5 learner beta, with at least three independent full-loop completions required by the governing v0.5 contract.

---

## 1. Decision summary

| P0 decision | Frozen selection | Gate status |
|---|---|---|
| Infrastructure provider / region | Amazon Web Services, `eu-west-1` (Europe/Ireland) | CLOSED |
| Web/runtime hosting | Amazon ECS Express Mode on Fargate, service `fpllm-beta-web`, 1 vCPU / 2 GiB per task, min 1 / max 2 tasks | CLOSED |
| PostgreSQL | Amazon RDS for PostgreSQL 18.6, Single-AZ `db.t3.small`, encrypted `gp3`, 20 GiB initial | CLOSED |
| Learner artifact object storage | **Not required for the first v0.5 beta**; bounded authoritative structured evidence remains in PostgreSQL | CLOSED |
| Container registry | Private Amazon ECR repositories; production images referenced by immutable digest | CLOSED |
| Worker host | Amazon EC2 `m7i.xlarge`, one On-Demand x86_64 worker host, desired concurrency 1 | CLOSED |
| Sandbox isolation | Docker Engine + gVisor `runsc`, preserving current network/filesystem/capability/user/resource boundaries | CLOSED |
| Hidden evaluator distribution | Private digest-pinned ECR hidden-evaluator image containing the private evaluator bundle; no hidden bundle in web image or learner mount namespace | CLOSED |
| Observability | Amazon CloudWatch Logs/Metrics/Alarms + AWS X-Ray through OpenTelemetry/ADOT where trace instrumentation is present | CLOSED |
| Secrets | AWS Secrets Manager + KMS, workload IAM roles, no long-lived AWS runtime access keys | CLOSED |
| Canonical production origin | `https://fpllm-beta-web.ecs.eu-west-1.on.aws` | CLOSED |
| DNS/TLS | Initial beta uses the AWS-managed ECS Express `on.aws` hostname and managed certificate; no custom domain | CLOSED |
| Backup/restore | RDS automated backups/PITR, 7-day retention, pre-migration snapshots, restore-to-new-instance drill | CLOSED |
| Release process | GitHub Actions OIDC -> AWS IAM; AWS CDK v2/TypeScript IaC; immutable ECR digests; expand-first migrations; canary web deploy; explicit smoke/rollback gate | CLOSED |

P1 starts from this table. Any change to a row before P7 requires a committed decision amendment that explains why the original assumption failed.

---

## 2. Why AWS and `eu-west-1`

### 2.1 Architecture fit

The frozen platform already separates:

```text
web/control plane
!=
learner-code execution process
```

AWS supports that separation without introducing a second infrastructure provider:

```text
ECS Express/Fargate web
        |
        v
RDS PostgreSQL 18
        |
        v
PostgreSQL durable jobs
        |
        v
EC2 trusted worker host
        |
        v
Docker + gVisor ephemeral sandboxes
```

ECR, Secrets Manager, CloudWatch, X-Ray, IAM, Systems Manager, and the VPC remain in the same account/region and can be permissioned independently.

### 2.2 Region

Primary production compute and data are placed in **`eu-west-1` (Europe/Ireland)** for the first beta.

Implications:

- production RDS data, application logs, ECR images, and AWS-managed secrets are region-scoped to `eu-west-1` unless the service itself uses a documented global control plane;
- GitHub remains a separate external dependency for identity, repository authorization, and source retrieval;
- v0.5 does not claim cross-region disaster recovery or a specific legal data-residency certification;
- moving regions later is an infrastructure migration, not an application-architecture rewrite.

### 2.3 Rejected primary web option

AWS App Runner is not selected. AWS states that App Runner stopped accepting new customers on 2026-03-31 and recommends ECS Express Mode as the migration/successor path for comparable operational simplicity.

---

## 3. Network baseline

P1 must provision one production VPC in `eu-west-1`, nominal CIDR `10.42.0.0/16`, with at least two Availability Zones.

Initial beta network shape:

```text
Internet
   |
   v
ECS Express managed internet-facing ALB
   |
   v
Fargate web tasks in public subnets (2+ AZs)
   |
   +----------------------+
   |                      |
   v                      v
RDS private DB        GitHub / AWS APIs
subnets (2+ AZs)      over outbound HTTPS
   ^
   |
EC2 worker in public subnet
(no inbound rules; outbound only as required)
```

The public-subnet choice for web tasks and the worker is intentional for the small beta: it avoids a continuously billed NAT gateway while retaining security-group control. Public IP assignment is **not** authority to accept arbitrary inbound traffic.

Required security-group policy:

- ALB: public inbound HTTPS only;
- web tasks: inbound application port only from the Express/ALB security group; no direct public application ingress;
- RDS: no public endpoint; PostgreSQL/5432 allowed only from the web and worker security groups;
- worker: no inbound rules; administration through AWS Systems Manager Session Manager only;
- no SSH key or port 22 production access path.

If P1 evidence shows that Express Mode cannot express the required security-group topology without weakening these rules, use standard ECS/Fargate with an ALB in the same AWS region rather than weakening the rules. That is an implementation-mode fallback, not permission to collapse web and worker trust boundaries.

---

## 4. Web/runtime hosting

### 4.1 Product

Use **Amazon ECS Express Mode** backed by AWS Fargate.

Frozen service identity:

```text
service: fpllm-beta-web
region: eu-west-1
cpu: 1 vCPU
memory: 2 GiB
minimum tasks: 1
maximum tasks: 2
container port: 3000
health path: /api/healthz
```

`/api/healthz` is a P1 implementation requirement; it must return success only when the web process is serving and its required control-plane dependencies pass the deliberately defined health policy.

AWS documents that Express Mode provisions a Fargate ECS service, HTTPS load balancing, auto scaling, CloudWatch integration, an AWS-managed application URL, and canary updates with alarm-based rollback.

### 4.2 Production origin and callbacks

The service name is fixed because ECS Express uses it in the application URL.

Canonical origin:

```text
https://fpllm-beta-web.ecs.eu-west-1.on.aws
```

GitHub human OAuth callback:

```text
https://fpllm-beta-web.ecs.eu-west-1.on.aws/auth/github/callback
```

GitHub App user-OAuth callback:

```text
https://fpllm-beta-web.ecs.eu-west-1.on.aws/auth/github-app/callback
```

P1 must configure these exact values in the production GitHub OAuth/GitHub App settings and exercise the real flows at P2. Preview, localhost, and staging callback URLs are not production authority.

### 4.3 Deploy and rollback

The web image is built from a frozen source SHA, pushed to private ECR, and deployed by **digest**, not a mutable tag. ECS Express canary deployment and alarm rollback are the default first line of defense.

Manual rollback means updating the service to the previous recorded ECR digest. A rollback does not alter historical learner evidence.

### 4.4 Limits and failure modes

The v0.5 configured application ceiling is two web tasks. AWS account/service quotas must be inspected and retained as P1 provisioning evidence before beta.

Primary failure modes:

- bad image/configuration -> canary/alarm or manual previous-digest rollback;
- task/AZ failure -> ECS/Fargate replacement and load balancing;
- regional AWS outage -> beta unavailable; cross-region active/standby is explicitly out of scope;
- GitHub outage -> authentication/repository actions fail diagnostically rather than fabricating state.

---

## 5. PostgreSQL

### 5.1 Product and size

Use **Amazon RDS for PostgreSQL 18.6** in `eu-west-1`.

Initial configuration:

```text
engine: PostgreSQL 18.6
deployment: Single-AZ
instance: db.t3.small
vCPU / RAM: 2 vCPU / 2 GiB
storage: gp3, 20 GiB initial
autoscaling ceiling: 100 GiB
public access: disabled
encryption at rest: enabled
backup retention: 7 days
automated backups / PITR: enabled
deletion protection: enabled
final snapshot on destructive teardown: required
```

RDS release notes list PostgreSQL 18.6 support as of 2026-08-25. AWS documents `db.t3.small` as 2 vCPU / 2 GiB. The class is intentionally modest for the 3–5 learner beta and is not a scaling claim.

### 5.2 Single-AZ accepted risk

Multi-AZ is not required for this beta. The accepted consequence is a larger database outage window during instance/AZ failure. The compensating controls are PITR, restore drills, diagnostic job/evidence state, and a small invited cohort.

If P1/P5 evidence shows that this availability level prevents credible independent learner completion, resize or move RDS to Multi-AZ through a recorded operational amendment.

### 5.3 Database roles

P1 must create separate credentials/roles for:

- web application runtime;
- worker runtime;
- migration/release operation.

The migration role must not be a normal web/worker credential. RDS master credentials are break-glass/provisioning authority and are not supplied to application containers.

---

## 6. Learner artifact storage — explicit NO for the first beta

The v0.5 artifact-storage decision is:

> **Do not provision a learner-facing S3/object store for the initial Causal Attention beta.**

The current loop stores bounded structured result/evidence data, hashes, sizes, and metadata in PostgreSQL. Learner source is materialized ephemerally by the worker from an immutable Git commit. The current Causal Attention scientific loop does not require durable binary learner artifacts beyond practical PostgreSQL/request bounds.

This decision must be reopened before P4 if a required artifact cannot be represented safely within the existing bounded structured-evidence path.

If reopened, the required implementation is private Amazon S3 with signed upload/download, SHA-256 and size verification, private-by-default objects, explicit owner/evidence linkage, and no execution of learner uploads.

This decision does **not** prohibit ECR for production container images; ECR is release infrastructure, not learner artifact storage.

---

## 7. Registry and image provenance

Use **private Amazon ECR** in `eu-west-1`.

At minimum maintain separately addressable repositories/images for:

```text
fpllm/web
fpllm/worker
fpllm/test-runtime
fpllm/hidden-evaluator
```

Production references use `@sha256:<digest>` identities. Mutable tags such as a source SHA may be attached for human navigation but are never sufficient release identity.

P7 records the exact digests used by web, worker, learner runtime, and hidden evaluator.

---

## 8. Worker and sandbox

### 8.1 Trusted worker host

Use one On-Demand **Amazon EC2 `m7i.xlarge`** x86_64 instance in `eu-west-1`:

```text
vCPU: 4
RAM: 16 GiB
OS family: Ubuntu 24.04 LTS x86_64
worker desired hosts: 1
submission concurrency per host: 1
inbound network: none
administration: Systems Manager Session Manager
```

The production AMI ID is resolved and pinned during P1, then recorded in P7. An Auto Scaling Group/launch template keeps desired host count at one and replaces a failed host.

The size is driven by the current execution contract: each submission requests 2 CPU, 4096 MiB, 256 PIDs, and a 180-second sandbox timeout; the hidden phase can have a learner probe and hidden evaluator container alive concurrently. Four vCPU / 16 GiB gives the trusted host explicit runtime headroom without introducing a general compute fleet.

### 8.2 Isolation primitive

Production sandboxing uses **Docker Engine with gVisor `runsc`**.

P1 must add/verify `runsc` as the runtime used by learner/public/hidden sandbox containers. The existing restrictions remain mandatory:

```text
network disabled
read-only root filesystem
all Linux capabilities dropped
no-new-privileges
non-root UID
CPU bound
RAM bound
PID bound
wall-clock timeout
bounded logs/evidence
ephemeral workspace
no Docker socket in learner/evaluator containers
```

The existing structural hidden-test rule also remains: private evaluator material is never mounted into the learner sandbox. The learner probe communicates with the hidden evaluator only over the narrow Unix-socket protocol.

Docker/gVisor and the EC2 host are part of the trusted computing base. The fact that the trusted worker can control Docker must not be described as if the worker were unprivileged with respect to its host.

### 8.3 Hidden evaluator distribution

For production, the **private evaluator bundle is built into the private hidden-evaluator image** in a trusted release workflow, and that image is pushed to private ECR.

Consequences:

- the web image/task never receives hidden evaluator code or bundle material;
- the learner runtime image does not contain hidden tests;
- the worker references the hidden evaluator by immutable ECR digest;
- learner sandboxes do not receive ECR credentials or the Docker socket;
- the production worker no longer needs a plaintext host-mounted private bundle as normal execution state.

This requires a P1 worker/runtime refactor because the current v0.4 runtime still accepts `FPLLM_PRIVATE_TEST_BUNDLE_ROOT` as a host mount. P1 must preserve the public commitment/version identity while moving production private material into the evaluator image. Staging may retain its separate materialization harness for release verification if it remains non-production and fail-closed.

### 8.4 Host failure/recovery

The worker is stateless with respect to authoritative learner evidence. PostgreSQL owns durable job/evidence state. A host termination while leasing a job must be recovered by the existing bounded lease/retry semantics and must be exercised at P5.

No failed worker disk is a required backup source.

---

## 9. Observability

Use:

- **Amazon CloudWatch Logs** for structured JSON application/worker logs;
- **CloudWatch Metrics and Alarms** for service/infrastructure health and release alarms;
- **AWS X-Ray through OpenTelemetry/ADOT** as the trace destination when distributed tracing is instrumented.

Initial application log retention: **30 days**.

P1 must make correlation identity traversable across:

```text
web request
-> submission/job
-> worker lease
-> sandbox execution
-> persisted evidence
```

The beta operator view must expose at least:

- web health, latency, ALB 4xx/5xx;
- ECS task/deployment state;
- RDS CPU, connections, free storage and availability;
- EC2 status checks and worker heartbeat/readiness;
- queued job count and oldest queued/leased job age;
- submission/test failure class;
- runtime/evaluator release identities.

Never send OAuth tokens, session bearer tokens, GitHub App private keys, repository-authorization signing secrets, hidden fixtures, or unnecessary learner-private text to logs/traces.

---

## 10. Secrets and IAM

Use **AWS Secrets Manager with KMS encryption** for production application secrets.

Runtime AWS authentication uses IAM roles:

- ECS task execution role for ECR/log bootstrap needs;
- ECS web task role for only the AWS APIs the web process actually needs;
- EC2 worker instance profile for only ECR pull, required secret reads, CloudWatch/SSM, and related worker operations;
- GitHub Actions deployment role assumed through GitHub OIDC;
- separate migration task role.

No static AWS access key is stored in application configuration or GitHub Actions.

Secret groups are separated by consumer. Web-only authority is not supplied to the worker, and worker-only authority is not supplied to the web.

Rotation baseline:

- application/database credentials: rotate at least every 90 days and immediately on suspected compromise; automate through Secrets Manager where the selected credential type supports a tested rotation path;
- GitHub OAuth client secret / GitHub App private key: controlled manual rotation at least every 90 days and immediately on suspected compromise, with new material installed before old material is revoked where the provider permits overlap;
- repository-authorization/session signing secrets: rotate at least every 90 days or on compromise using a documented overlap/invalidation procedure;
- after any rotation, restart/redeploy affected workloads so environment-injected secret values cannot remain indefinitely cached.

P1 must write and exercise the rotation runbook before external beta. A schedule alone is not rotation evidence.

---

## 11. DNS and TLS

The initial beta intentionally uses the AWS-managed ECS Express application domain:

```text
fpllm-beta-web.ecs.eu-west-1.on.aws
```

Therefore:

- no customer-owned DNS zone is required for v0.5;
- AWS owns the `on.aws` DNS namespace;
- ECS Express provisions/manages the HTTPS certificate lifecycle through its managed infrastructure;
- HTTP is not a canonical production origin;
- adding a custom domain is deferred until after the beta because changing origin affects OAuth callbacks, cookies, runbooks, and release evidence.

A future custom domain is a deliberate production-origin migration, not an in-place cosmetic change.

---

## 12. Backup, restore, RPO and RTO

### 12.1 Policy

RDS automated backups and point-in-time recovery remain enabled with **7-day retention**. RDS documentation states that transaction logs are uploaded every five minutes for PITR.

Before a production migration with material schema/data risk, create and record a manual RDS snapshot.

Operational targets for this beta:

```text
RPO target: <= 15 minutes
RTO target: <= 2 hours
```

These are project targets, not AWS SLAs. P1 must measure them with an actual restore drill before external beta.

### 12.2 Restore procedure

A database recovery restores a snapshot/PITR point to a **new RDS instance** rather than overwriting the failed source.

Required drill sequence:

1. select recorded snapshot/PITR time;
2. restore into a clean non-production RDS target with production-equivalent engine/settings;
3. apply required VPC/security groups/parameter settings;
4. verify migration state plus learner/evidence referential relationships;
5. run controlled application smoke checks against the restored database;
6. measure data loss window and recovery elapsed time against RPO/RTO targets;
7. retain restore identities/logs in the v0.5 release record;
8. only for a real incident, rotate/update the database endpoint secret and redeploy web/worker after the restored target is accepted.

Recovery never rewrites historical failed learner evidence merely to create a passing state.

---

## 13. Release, migration, promotion and rollback

### 13.1 Infrastructure as code

P1 production infrastructure is defined with **AWS CDK v2 in TypeScript** inside the repository. Console-only resource creation is not the production source of truth except for bootstrap/account operations that CDK cannot reasonably own; any such operation must be recorded in the runbook.

### 13.2 Deployment identity

GitHub Actions assumes an AWS deployment role through **GitHub OIDC**. The workflow builds source-SHA-attributable images, pushes to private ECR, records their digests, and promotes exact digests.

### 13.3 Promotion sequence

Production promotion order:

```text
CI + review clean
-> freeze source SHA
-> build/publish immutable images
-> record ECR digests
-> pre-migration RDS snapshot when required
-> run version-controlled expand-compatible Prisma migration
-> verify migration
-> deploy web digest through ECS Express canary
-> run production smoke gate
-> deploy/update worker digest + runtime/evaluator digests
-> run queue/worker smoke gate
-> record release identities and evidence
```

Migrations run as a one-off ECS/Fargate migration task in the VPC using the separate migration role. Manual SQL absent from version control is prohibited.

### 13.4 Smoke gate

Before a release is accepted, verify at minimum:

- canonical HTTPS origin and health endpoint;
- production `NODE_ENV=production` and fixture authority impossible;
- database connectivity and expected migration identity;
- real deployment image digests equal the candidate record;
- queue can accept/lease a controlled diagnostic job without fixture-derived learner authority;
- worker host/runtime preflight passes, including gVisor and digest identities;
- no production secret/hidden fixture appears in logs.

P2/P3 real learner/repository/submission evidence remains separate and cannot be replaced by this infrastructure smoke test.

### 13.5 Rollback

Application rollback is previous-digest promotion:

- web: ECS Express automatic alarm rollback or manual previous ECR digest;
- worker: restore previous worker/runtime/evaluator digests and worker launch configuration;
- database: prefer forward-compatible migrations; do not destructively down-migrate evidence. If database recovery is necessary, restore snapshot/PITR to a new instance and follow the restore procedure.

Release PRs must follow the post-PR-#9 process rule: inspect and disposition all human/automated review findings, rerun affected gates, and only then resolve review threads and merge.

---

## 14. Cost envelope and budget controls

For P0 planning, the minimum viable always-on 3–5 learner beta is budgeted at **USD 250–400 per 30-day month**, excluding taxes, unusual data transfer, runaway logs/traces, and learner-owned GPU compute.

Expected cost drivers, in descending order, are the always-on EC2 worker, Fargate/ALB web service, RDS, then EBS/ECR/Secrets Manager/CloudWatch usage.

This number is a planning envelope, **not an AWS quote and not measured spend**. Before P1 creates production resources it must produce and retain a region-specific AWS Pricing Calculator estimate using the exact selected sizes. After provisioning, Cost Explorer/billing data becomes the authoritative spend evidence.

Budget controls:

```text
initial monthly budget alert: USD 450
mandatory cost review threshold: USD 600
```

The review threshold is not an automatic resource kill switch; production must not terminate active learner evidence processing merely to satisfy a budget alarm.

The worker may be scaled to zero only during an explicitly announced beta pause. Independent learner validation otherwise requires the worker to remain available without operator intervention.

---

## 15. Provider failure model and exit path

| Failure | Expected behavior / recovery |
|---|---|
| ECS bad release | canary/alarm rollback or previous digest |
| ECS task/AZ failure | managed task replacement/load balancing |
| RDS instance/AZ failure | service outage accepted for beta; restore/PITR if necessary |
| EC2 worker loss | ASG replaces host; durable lease/retry returns work to diagnosable state |
| ECR unavailable | no new image pull/deploy; currently running workloads continue where possible |
| Secrets Manager unavailable | no new secret retrieval/redeploy; never fall back to embedded secrets |
| CloudWatch/X-Ray impaired | application continues only if core evidence path remains healthy; emit/reconcile telemetry when restored, without inventing learner events |
| GitHub unavailable | auth/repo/source actions fail diagnostically; no synthetic authority |
| `eu-west-1` regional outage | beta unavailable; cross-region DR deferred |

Exit/migration properties are intentionally preserved:

- web/worker are OCI containers;
- durable state is PostgreSQL 18;
- learner object storage is absent initially and, if later added, remains behind an S3-compatible contract;
- source authority remains GitHub App based;
- AWS-specific CDK/IAM/network definitions are isolated infrastructure code rather than application-domain state.

Moving from AWS therefore requires infrastructure replacement and data migration, not a rewrite of learner evidence semantics.

---

## 16. P1 implementation checklist created by this decision

P1 must now implement and verify, without changing P0 silently:

1. AWS account/region bootstrap, GitHub OIDC deployment role, CDK bootstrap and cost budget;
2. production VPC/subnets/security groups with no worker inbound path and private RDS;
3. private ECR repositories and digest-only production promotion;
4. RDS PostgreSQL 18.6, roles, migrations, 7-day PITR and deletion safeguards;
5. ECS Express web service, canonical origin, `/api/healthz`, fail-closed production fixture behavior and CloudWatch alarms;
6. EC2 worker launch template/ASG, SSM-only administration, Docker + gVisor preflight, one-job concurrency;
7. production hidden-evaluator image build that embeds the private evaluator bundle and removes the normal host-mounted private-bundle dependency;
8. Secrets Manager/IAM least privilege plus documented rotation path;
9. structured logs, metrics, correlation/trace plumbing and minimum operator dashboard;
10. release/migration/smoke/rollback automation;
11. clean-environment provisioning test plus backup/restore and rollback drills;
12. retained P1 evidence including quotas, Pricing Calculator estimate, resource identities, image digests, migration identity, restore timings and rollback result.

P1 is not complete until those actions are exercised against the selected production environment. A merged CDK stack alone is not P1 evidence.

---

## 17. Official research basis at decision freeze

Provider/service claims in this P0 record were checked against official sources on 2026-09-20:

- Amazon ECS Express Mode overview: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html
- ECS Express first service / `servicename.ecs.region.on.aws` URL: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-getting-started.html
- ECS Express API, custom service name/network/health/resource settings: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CreateExpressGatewayService.html
- ECS Express resources/network defaults: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.html
- ECS Express canary/alarm rollback: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-update-full.html
- AWS App Runner availability change: https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html
- RDS PostgreSQL release history (18.6): https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/doc-history.html
- RDS DB class hardware: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.Summary.html
- RDS automated backups/retention: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html
- RDS point-in-time restore: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html
- EC2 M7i hardware: https://aws.amazon.com/ec2/instance-types/general-purpose/
- EC2 instance families by region: https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html
- gVisor Docker runtime quick start: https://gvisor.dev/docs/user_guide/quick_start/docker/
- gVisor installation: https://gvisor.dev/docs/user_guide/install/
- Secrets Manager rotation schedules: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html
- Amazon Fargate pricing: https://aws.amazon.com/fargate/pricing/
- Amazon RDS for PostgreSQL pricing: https://aws.amazon.com/rds/postgresql/pricing/
- Amazon EC2 On-Demand pricing: https://aws.amazon.com/ec2/pricing/on-demand/
- Amazon ECR pricing: https://aws.amazon.com/ecr/pricing/
- Amazon CloudWatch pricing: https://aws.amazon.com/cloudwatch/pricing/

Service availability, quotas and prices can change. P1 must re-check the selected region immediately before provisioning and record the observed values; that re-check does not reopen the architectural decision unless a required product/feature is no longer available.

# Platform v0.5 — Production Provider & Operations Decisions

**Status:** P0 FROZEN / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Baseline:** `aa88e7ccb7f15e9105226ab4b9262c6dbe864f41`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  
**Authority:** linked v0.5 P0 decision record contemplated by the governing contract. It supersedes `PROJECT_DECISIONS_v1.2.md` §1.4 item 4 only with respect to whether v0.5 production-provider selection remains open. It does not supersede any frozen security, evidence, learner, or release-gate invariant.

---

## 0. Gate outcome and evidence boundary

Platform v0.5 P0 is **CLOSED by decision when this record is merged**.

This record selects the production provider/operations baseline required before infrastructure implementation. It does **not** claim that production resources exist, credentials have been created, real OAuth/App callbacks have succeeded, backups have been restored, or any P1–P7 gate has passed.

The production baseline remains deliberately small: one complete Causal Attention vertical slice for an initial 3–5 learner beta, with at least three independent full-loop external completions required by the governing v0.5 contract.

P0 closes provider selection against the published provider envelope recorded below. Account-specific applied quotas are not publicly inferable, so P1 starts with a **no-create quota/availability admission check**. If an applied quota is below the frozen minimum and cannot be raised without changing the selected architecture, production provisioning stops and P0 is reopened by committed amendment. No silent provider/hosting fallback is permitted.

---

## 1. Frozen decision summary

| P0 decision | Frozen selection | Status |
|---|---|---|
| Infrastructure provider / region | Amazon Web Services, `eu-west-1` (Europe/Ireland) | CLOSED |
| Web/runtime hosting | Amazon ECS Express Mode on Fargate, service `fpllm-beta-web`, 1 vCPU / 2 GiB per task, min 1 / max 2 tasks | CLOSED |
| PostgreSQL | Amazon RDS for PostgreSQL 18.6, Single-AZ `db.t3.small`, encrypted `gp3`, 20 GiB initial | CLOSED |
| Learner artifact object storage | **Not required for the first v0.5 beta**; bounded structured evidence remains in PostgreSQL | CLOSED |
| Container registry | Private Amazon ECR; production images referenced by immutable digest | CLOSED |
| Worker host | Amazon EC2 `m7i.xlarge`, one On-Demand x86_64 worker host, ASG min/desired/max = 1/1/1 | CLOSED |
| Sandbox isolation | Docker Engine + gVisor `runsc`, preserving the frozen network/filesystem/capability/user/resource boundaries | CLOSED |
| Hidden evaluator distribution | Private digest-pinned ECR evaluator image containing the private evaluator bundle; no hidden bundle in web image or learner mount namespace | CLOSED |
| Observability | CloudWatch Logs/Metrics/Alarms + AWS X-Ray through OpenTelemetry/ADOT where trace instrumentation exists | CLOSED |
| Secrets | AWS Secrets Manager + KMS, workload IAM roles, no long-lived AWS runtime access keys | CLOSED |
| Canonical production origin | `https://fpllm-beta-web.ecs.eu-west-1.on.aws` | CLOSED |
| DNS/TLS | AWS-managed ECS Express `on.aws` hostname and managed certificate; no custom domain for v0.5 | CLOSED |
| Backup/restore | RDS automated backups/PITR, 7-day retention, pre-migration snapshots, restore-to-new-instance drill | CLOSED |
| Release process | GitHub Actions OIDC -> AWS IAM; AWS CDK v2/TypeScript; immutable ECR digests; expand-first migrations; protocol-compatibility gate; canary web deploy; smoke/rollback gate | CLOSED |

Any change to a CLOSED row before P7 requires a committed decision amendment explaining the failed assumption and all consequential changes.

---

## 2. Provider and region

### 2.1 Why AWS

The frozen platform requires:

```text
web/control plane != learner-code execution process
```

The selected topology keeps those trust domains separate while using one infrastructure provider:

```text
ECS Express / Fargate web
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

ECR, Secrets Manager, CloudWatch, X-Ray, IAM, Systems Manager, and the VPC remain separately permissionable services in the same AWS account/region.

AWS App Runner is not selected. AWS documents that it stopped accepting new customers on 2026-03-31 and points comparable users toward ECS Express Mode.

### 2.2 Region

Primary production compute and data are placed in **`eu-west-1`**.

Implications:

- RDS data, application logs, ECR images, and AWS-managed secrets are region-scoped to `eu-west-1` unless a service has a documented global control plane;
- GitHub remains an external dependency for identity, repository authorization, and source retrieval;
- v0.5 does not claim cross-region disaster recovery or a specific legal data-residency certification;
- moving regions later is an infrastructure/data migration, not a rewrite of learner evidence semantics.

---

## 3. Provider limits and P1 admission envelope

The governing P0 contract requires hard provider limits that can affect the learner loop. The following published limits/default quotas and v0.5 consumption envelope are therefore part of the frozen decision.

Published defaults are **not equivalent to the account's applied quotas**. P1 must query the actual account before creating resources. If a minimum below is not available, resource creation is blocked until an approved quota increase succeeds or a P0 amendment is merged.

| Service / limit | Published default or hard limit checked at freeze | v0.5 requirement / minimum |
|---|---:|---:|
| Fargate On-Demand vCPU quota per region | 6 vCPU default, adjustable | Applied quota **>= 6 vCPU** before web/migration provisioning |
| Fargate On-Demand sustained launch rate in `eu-west-1` | 20 tasks/sec, adjustable | Far above beta launch demand |
| ECS services per cluster | 5,000, non-adjustable | 1 Express web service |
| ECS tasks per service | 5,000, non-adjustable | max 2 steady-state web tasks; canary overlap must remain within applied Fargate quota |
| Security groups per ECS `awsvpcConfiguration` | 5, non-adjustable | <= 5; target design uses the minimum required set |
| Subnets per ECS `awsvpcConfiguration` | 16, non-adjustable | 2+ web subnets, never >16 |
| Application Load Balancers per region | 50 default, adjustable | 1 Express-managed ALB |
| VPCs per region | 5 default, adjustable | 1 production VPC |
| Subnets per VPC | 200 default | at least 4 production subnets |
| Running On-Demand Standard EC2 vCPUs | 5 vCPU default, adjustable | Applied quota **>= 4 vCPU** for one `m7i.xlarge` |
| RDS DB instances per region | 40 default, adjustable | max 2 simultaneously during restore drill: production + restored target |
| RDS manual DB snapshots | 100 default, adjustable | bounded release/drill snapshots, <<100 |
| RDS total storage across DB instances | 100,000 GiB default, adjustable | <=200 GiB if production and restored instance are both at the frozen 100 GiB autoscaling ceiling |
| RDS DB subnets per subnet group | 20, non-adjustable | 2+ private DB subnets |

### 3.1 Fargate quota interpretation

The steady web ceiling is 2 vCPU because there are at most two 1-vCPU tasks. Canary replacement can temporarily increase task count, and the migration task also consumes Fargate capacity. Therefore the frozen admission minimum is **6 applied Fargate On-Demand vCPU**, and the release process must not intentionally schedule a migration task concurrently with a canary if doing so would exceed the observed applied quota.

P1 records both the AWS-published default and the actual account-applied Fargate quota before creating ECS resources.

### 3.2 EC2 quota interpretation

One `m7i.xlarge` consumes 4 Standard On-Demand vCPUs. The published default Standard On-Demand quota is 5 vCPU, so the initial worker Auto Scaling Group is deliberately frozen at:

```text
min = 1
desired = 1
max = 1
```

At that default, worker image/AMI replacement must be **terminate-then-launch**, accepting a brief worker-unavailable interval while durable PostgreSQL jobs remain queued/retryable. Zero-downtime overlap of two `m7i.xlarge` hosts is not permitted unless the applied Standard On-Demand quota is first raised to at least 8 vCPU and the operational change is recorded.

P1 must verify actual applied Standard On-Demand vCPU quota >=4 before creating the worker.

### 3.3 Quota failure rule

The first P1 production action is a read-only quota/availability report covering Fargate, EC2, RDS, ALB/VPC requirements and selected-region product availability. A failed minimum is a **hard provisioning stop**, not permission to substitute another provider/product. If the selected service cannot meet the frozen requirement, P0 is reopened and amended before implementation continues.

---

## 4. Network baseline

P1 provisions one VPC in `eu-west-1`, nominal CIDR `10.42.0.0/16`, spanning at least two Availability Zones.

Initial topology:

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

Public subnets are used for the small beta to avoid a continuously billed NAT gateway. Public IP assignment is not authority to accept arbitrary inbound traffic.

Required security policy:

- ALB: public inbound HTTPS only;
- web tasks: application-port inbound only from the Express/ALB path; no direct application ingress;
- RDS: no public endpoint; PostgreSQL/5432 only from the web and worker security groups;
- worker: no inbound rules; administration through Systems Manager Session Manager only;
- no production SSH key or port-22 path.

### 4.1 Express network incompatibility rule

If P1 proves ECS Express Mode cannot satisfy the mandatory network/security-group topology without weakening a frozen invariant, **stop and reopen P0 before provisioning the replacement web stack**.

Standard ECS/Fargate with a conventional ALB may be evaluated, but it is **not a transparent implementation fallback**. A replacement decision must explicitly freeze, at minimum:

- replacement canonical HTTPS origin;
- DNS ownership and TLS certificate lifecycle;
- both GitHub OAuth/GitHub App callback URLs;
- ingress/subnet/security-group topology;
- deployment/canary and rollback behavior;
- observability consequences;
- revised cost/limit envelope.

No P1 implementation may proceed under another hosting mode until that amendment is merged.

---

## 5. Web/runtime hosting

Use **Amazon ECS Express Mode backed by Fargate**.

Frozen service configuration:

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

`/api/healthz` is a P1 implementation requirement. Its exact dependency semantics must be defined deliberately so a health check neither hides required dependency failure nor causes cascading restarts for an unrelated external outage.

AWS documents ECS Express as provisioning a Fargate ECS service with HTTPS load balancing, autoscaling, CloudWatch integration, an AWS-managed application URL, and canary updates with alarm-based rollback.

### 5.1 Production origin and callbacks

Canonical origin:

```text
https://fpllm-beta-web.ecs.eu-west-1.on.aws
```

Human GitHub OAuth callback:

```text
https://fpllm-beta-web.ecs.eu-west-1.on.aws/auth/github/callback
```

GitHub App user-OAuth callback:

```text
https://fpllm-beta-web.ecs.eu-west-1.on.aws/auth/github-app/callback
```

P1 configures these exact production callback values; P2 must exercise the real flows. Preview, localhost, fixture, and staging callbacks are not production evidence.

### 5.2 Deploy and rollback

Web images are built from a frozen source SHA, pushed to private ECR, and deployed by digest. ECS Express canary deployment plus alarm rollback is the first line of defense. Manual rollback selects the previous recorded ECR digest. Rollback never rewrites historical learner evidence.

Primary failure modes:

- bad image/configuration -> canary/alarm or previous-digest rollback;
- task/AZ failure -> managed task replacement/load balancing;
- regional outage -> beta unavailable; cross-region active/standby is out of scope;
- GitHub outage -> affected identity/repository actions fail diagnostically without fabricated state.

---

## 6. PostgreSQL

Use **Amazon RDS for PostgreSQL 18.6** in `eu-west-1`.

Frozen initial configuration:

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

RDS release notes list PostgreSQL 18.6 support as of 2026-08-25. AWS documents `db.t3.small` as 2 vCPU / 2 GiB. The class is intentionally modest for a 3–5 learner beta and is not a scaling claim.

### 6.1 Single-AZ accepted risk

Multi-AZ is not required for the first beta. The accepted consequence is a larger outage window during instance/AZ failure. Compensating controls are PITR, restore drills, durable evidence/job state, and a small invited cohort.

If P1/P5 evidence shows that this availability level prevents credible independent learner completion, resizing or moving to Multi-AZ requires a recorded operations amendment.

### 6.2 Database authority separation

P1 creates separate credentials/roles for:

- web runtime;
- worker runtime;
- migration/release operation.

Migration authority is not a normal web/worker credential. RDS master credentials are provisioning/break-glass authority and are not supplied to application containers.

---

## 7. Learner artifact storage — explicit NO for first beta

**Do not provision learner-facing S3/object storage for the initial Causal Attention beta.**

The current loop stores bounded structured result/evidence data, hashes, sizes, and metadata in PostgreSQL. Learner source is materialized ephemerally from an immutable Git commit. The current Causal Attention scientific loop does not require durable binary learner artifacts beyond practical PostgreSQL/request bounds.

This decision must be reopened before P4 if a required artifact cannot be represented safely within the bounded structured-evidence path.

If reopened, the implementation must use private S3-compatible storage with signed upload/download, SHA-256 and size verification, private-by-default objects, owner/evidence linkage, and no execution of learner uploads.

ECR is release infrastructure and is not learner artifact storage.

---

## 8. Registry and image provenance

Use **private Amazon ECR** in `eu-west-1` for separately addressable images/repositories at least for:

```text
fpllm/web
fpllm/worker
fpllm/test-runtime
fpllm/hidden-evaluator
```

Production identities use `@sha256:<digest>`. Mutable tags may aid navigation but are never sufficient release identity. P7 records exact web/worker/runtime/evaluator digests.

---

## 9. Worker and sandbox

### 9.1 Trusted worker host

Use one On-Demand **EC2 `m7i.xlarge`** x86_64 instance:

```text
region: eu-west-1
vCPU: 4
RAM: 16 GiB
OS family: Ubuntu 24.04 LTS x86_64
ASG min/desired/max: 1/1/1
submission concurrency: 1
inbound network: none
administration: Systems Manager Session Manager
```

The production AMI ID is resolved/pinned during P1 and recorded at P7.

The size follows the current execution contract: each submission requests 2 CPU, 4096 MiB, 256 PIDs, and a 180-second sandbox timeout; the hidden phase can keep learner-probe and hidden-evaluator containers alive concurrently. Four vCPU / 16 GiB gives the trusted host headroom without creating a general compute fleet.

### 9.2 Sandbox primitive

Production sandboxing uses **Docker Engine with gVisor `runsc`**. P1 must add/verify `runsc` for learner/public/hidden containers while preserving:

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

Private evaluator material is structurally absent from the learner sandbox. Learner probe and hidden evaluator communicate only through the frozen narrow Unix-socket protocol.

Docker/gVisor and the EC2 host are part of the trusted computing base. The trusted worker's Docker authority must not be described as host-unprivileged.

### 9.3 Hidden evaluator distribution

For production, the **private evaluator bundle is built into the private hidden-evaluator image** in a trusted release workflow and pushed to private ECR.

Consequences:

- web image/task never receives hidden evaluator code/material;
- learner runtime image contains no hidden tests;
- worker references evaluator by immutable digest;
- learner sandboxes receive neither ECR credentials nor the Docker socket;
- normal production execution no longer requires a plaintext host-mounted private bundle.

This is a P1 runtime refactor because the v0.4 worker still accepts `FPLLM_PRIVATE_TEST_BUNDLE_ROOT` as a host mount. P1 must preserve the public commitment/version identity while moving production private material into the evaluator image. Non-production staging may retain its separate committed materialization harness if it remains fail-closed.

### 9.4 Host recovery

Authoritative learner state remains in PostgreSQL, not worker disk. Host termination while leasing a job must recover through bounded lease/retry semantics and must be exercised at P5. No failed worker disk is a required backup source.

---

## 10. Observability

Use:

- **CloudWatch Logs** for structured JSON web/worker logs;
- **CloudWatch Metrics and Alarms** for service/infrastructure/release health;
- **AWS X-Ray through OpenTelemetry/ADOT** as trace destination where tracing is instrumented.

Initial application-log retention: **30 days**.

P1 must make correlation identity traversable across:

```text
web request -> submission/job -> worker lease -> sandbox execution -> persisted evidence
```

The operator view must expose web health/latency/5xx, ECS deployment state, RDS availability/connections/storage, EC2/worker readiness, queued job count and oldest job age, submission/test failure class, and runtime/evaluator identities.

Never send OAuth/session tokens, GitHub App private keys, repository-authorization signing secrets, hidden fixtures, or unnecessary learner-private text to telemetry.

---

## 11. Secrets and IAM

Use **AWS Secrets Manager with KMS encryption**.

Runtime AWS authentication uses IAM roles:

- ECS task execution role for ECR/log bootstrap;
- ECS web task role for only required web APIs;
- EC2 worker instance profile for required ECR/secret/CloudWatch/SSM operations;
- GitHub Actions deployment role assumed through GitHub OIDC;
- separate migration task role.

No static AWS access key is stored in application config or GitHub Actions.

Web-only authority is not supplied to the worker and worker-only authority is not supplied to web.

Rotation baseline:

- application/database credentials: at least every 90 days and immediately on suspected compromise, automated where a tested Secrets Manager rotation path exists;
- GitHub OAuth secret / GitHub App private key: controlled rotation at least every 90 days and on compromise, overlapping old/new material where provider behavior permits;
- repository-authorization/session signing secrets: at least every 90 days or on compromise with documented overlap/invalidation semantics;
- redeploy/restart affected workloads after rotation when secrets are environment-injected.

P1 writes and exercises the rotation runbook before external beta. A schedule alone is not rotation evidence.

---

## 12. DNS and TLS

Initial beta uses:

```text
fpllm-beta-web.ecs.eu-west-1.on.aws
```

Therefore:

- no customer-owned DNS zone is required for v0.5;
- AWS owns the `on.aws` namespace;
- ECS Express manages HTTPS certificate lifecycle for its managed application endpoint;
- HTTP is not the canonical production origin;
- adding a custom domain is deferred because changing origin affects callbacks, cookies, runbooks, and release evidence.

A future custom domain requires a deliberate production-origin amendment/migration.

---

## 13. Backup, restore, RPO and RTO

RDS automated backups/PITR use **7-day retention**. Before a material production migration, create and record a manual RDS snapshot.

Project targets:

```text
RPO target: <= 15 minutes
RTO target: <= 2 hours
```

These are project targets, not AWS SLAs. P1 must measure them in a real restore drill. AWS documentation states that RDS transaction logs are uploaded every five minutes for PITR, but the stricter project RPO is still verified empirically.

Restore procedure:

1. select recorded snapshot/PITR time;
2. restore into a **new** non-production RDS instance with production-equivalent engine/settings;
3. apply required VPC/security/parameter settings;
4. verify migration state and learner/evidence referential relationships;
5. run controlled smoke checks against restored data;
6. measure data-loss window and elapsed recovery time;
7. retain restore resource identities/logs;
8. for a real incident only, update/rotate the database endpoint secret and redeploy web/worker after accepting the restored target.

Recovery never rewrites historical failed learner evidence merely to create a passing result.

---

## 14. Release, migration, promotion and rollback

### 14.1 Infrastructure as code

Use **AWS CDK v2 in TypeScript** inside the repository. Console-only production resource creation is not source of truth except account/bootstrap operations CDK cannot reasonably own; exceptions must be recorded in runbooks.

### 14.2 Deployment identity

GitHub Actions assumes an AWS deployment role via **GitHub OIDC**. Workflows build source-SHA-attributable images, push to private ECR, record digests, and promote exact digests.

### 14.3 Web/worker protocol compatibility gate

The web and worker are independently deployable, but they share durable contracts: job payload schema, test/evaluator identity, persisted state transitions, and any protocol fields consumed by `assertSandboxJob` or equivalent validation. Independent deployment is therefore permitted only across a **verified compatibility window**.

Before any production promotion, CI/release evidence must record a compatibility matrix proving, as applicable:

```text
new web -> old worker: accepted
old web -> new worker: accepted
new web -> new worker: accepted
rollback web -> currently deployed worker: accepted
rollback worker -> currently deployed web/queued jobs: accepted
```

A release that changes a durable job payload, schema version, evaluator protocol, or required state semantics must either preserve enough backward/forward compatibility for the matrix above or use the coordinated breaking-change procedure below.

This gate specifically prevents a new web release from creating submissions that an old worker rejects and retries as infrastructure failures.

### 14.4 Normal compatible promotion order

When the compatibility matrix passes:

```text
CI + review clean
-> freeze source SHA
-> build/publish immutable images
-> record ECR digests
-> verify web/worker compatibility matrix
-> pre-migration RDS snapshot when required
-> version-controlled expand-compatible Prisma migration
-> verify migration
-> ECS Express canary web deploy
-> production web smoke gate
-> worker/runtime/evaluator digest update
-> queue/worker smoke gate
-> record release identities/evidence
```

Migrations run as a one-off Fargate task in the VPC using the separate migration role. Manual SQL absent from version control is prohibited.

### 14.5 Breaking protocol/schema promotion

If old/new web and worker versions cannot safely coexist, the release is **coordinated**, not rolling:

1. put submission creation into an explicit maintenance/drain mode while preserving read access to existing learner evidence;
2. allow all leased and queued submission-test jobs to reach a terminal state, or deliberately cancel only through a versioned/diagnostic product path that preserves evidence provenance;
3. verify the durable queue is drained and no old-contract job remains eligible for lease;
4. apply only expand-compatible database migration steps required by both sides of the coordinated release;
5. replace worker/runtime/evaluator to the new contract while submissions remain paused;
6. deploy the new web digest while submissions remain paused;
7. run web + queue + worker compatibility/smoke checks using the new contract;
8. reopen submission creation only after the checks pass and record the maintenance window/evidence.

A breaking release must not consume learner retry budgets merely because components were temporarily protocol-incompatible.

### 14.6 Smoke gate

At minimum verify:

- canonical HTTPS origin and health endpoint;
- `NODE_ENV=production` and production fixture authority impossible;
- DB connectivity and expected migration identity;
- deployed image digests equal candidate record;
- compatibility matrix or coordinated-release evidence matches the chosen release path;
- queue accepts/leases a controlled diagnostic job without fixture-derived learner authority;
- worker host/runtime preflight passes, including gVisor and digest identities;
- no production secret/hidden fixture appears in logs.

P2/P3 real learner/repository/submission evidence remains separate and cannot be replaced by infrastructure smoke tests.

### 14.7 Rollback compatibility

Rollback is permitted independently only when the recorded compatibility matrix proves the rollback pair can safely consume all currently queued/durable work.

- web: ECS Express alarm rollback or previous ECR digest **only if** that web digest is compatible with the deployed worker and current durable job/state contract;
- worker: previous worker/runtime/evaluator digests **only if** they accept all durable jobs that may have been created by the deployed web;
- incompatible rollback: pause submissions, drain/terminalize work under supported product semantics, then perform a coordinated web+worker rollback and smoke gate;
- database: forward-compatible migrations preferred; no destructive evidence down-migration. If recovery is necessary, restore snapshot/PITR to a new instance.

Release PRs follow the post-PR-#9 process rule: inspect/disposition all automated/human findings, rerun affected gates, then resolve review threads and merge.

---

## 15. Cost envelope and budget controls

P0 planning envelope for an always-on 3–5 learner beta: **USD 250–400 per 30-day month**, excluding taxes, unusual transfer, runaway telemetry, and learner-owned GPU compute.

Expected main drivers are the EC2 worker, Fargate/ALB web path, RDS, then EBS/ECR/Secrets Manager/CloudWatch.

This is a planning envelope, **not an AWS quote or measured spend**. Before P1 creates resources, retain a region-specific AWS Pricing Calculator estimate using the frozen sizes. After provisioning, AWS billing/Cost Explorer is the authoritative spend evidence.

Budget controls:

```text
monthly budget alert: USD 450
mandatory cost review threshold: USD 600
```

The review threshold is not an automatic resource kill switch. Active learner evidence processing is not terminated solely to satisfy a budget alarm. Worker scale-to-zero is allowed only during an explicitly announced beta pause.

---

## 16. Provider failure model and exit path

| Failure | Expected response |
|---|---|
| ECS bad release | canary/alarm rollback or previous digest, subject to §14.7 compatibility |
| ECS task/AZ failure | managed task replacement/load balancing |
| RDS instance/AZ failure | beta outage accepted; restore/PITR if necessary |
| EC2 worker loss | ASG replaces host; durable lease/retry returns work to diagnosable state |
| ECR unavailable | no new image pull/deploy; running workloads continue where possible |
| Secrets Manager unavailable | no fallback to embedded secrets |
| CloudWatch/X-Ray impaired | core evidence path may continue if healthy; never invent telemetry/learner events |
| GitHub unavailable | auth/repository/source actions fail diagnostically; no synthetic authority |
| `eu-west-1` outage | beta unavailable; cross-region DR deferred |

Exit properties are preserved:

- web/worker remain OCI containers;
- durable state remains PostgreSQL 18;
- learner object storage is absent initially and, if later added, remains behind an S3-compatible contract;
- source authority remains GitHub App based;
- AWS-specific CDK/IAM/network definitions remain infrastructure code rather than learner-domain state.

Moving from AWS therefore requires infrastructure replacement/data migration, not a rewrite of learner evidence semantics.

---

## 17. P1 implementation checklist created by P0

P1 must implement and verify, without silently changing P0:

1. no-create quota/availability admission report proving all minimums in §3;
2. AWS account/region bootstrap, GitHub OIDC deployment role, CDK bootstrap and cost budget;
3. VPC/subnets/security groups with no worker inbound path and private RDS;
4. private ECR repositories and digest-only production promotion;
5. RDS PostgreSQL 18.6, separate roles, migrations, PITR and deletion safeguards;
6. ECS Express web service, canonical origin, `/api/healthz`, fail-closed fixture behavior and alarms;
7. EC2 ASG 1/1/1, SSM-only administration, Docker + gVisor preflight, one-job concurrency;
8. hidden-evaluator image build that embeds private evaluator material and removes the normal production host-mounted private-bundle dependency;
9. Secrets Manager/IAM least privilege plus exercised rotation runbook;
10. structured logs/metrics/correlation/trace plumbing and minimum operator dashboard;
11. release/migration/smoke/rollback automation including the §14 web/worker compatibility matrix and breaking-change drain path;
12. clean-environment provisioning test, backup/restore drill and rollback drill;
13. retained P1 evidence: quotas, Pricing Calculator estimate, resource IDs, image digests, migration ID, compatibility evidence, restore timings and rollback result.

P1 is not complete until those operations are exercised against the selected production environment. A merged CDK stack alone is not P1 evidence.

---

## 18. Official research basis at decision freeze

Provider/service claims were checked against official sources on 2026-09-20:

- ECS Express overview: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html
- ECS Express first service / `servicename.ecs.region.on.aws`: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-getting-started.html
- ECS Express create API / network, health, resource settings: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CreateExpressGatewayService.html
- ECS Express resources/network defaults: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.html
- ECS Express canary/alarm rollback: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-update-full.html
- App Runner availability change: https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html
- ECS endpoints and quotas, including Fargate defaults/rates and ECS hard limits: https://docs.aws.amazon.com/general/latest/gr/ecs-service.html
- ECS quota management / default versus applied quota inspection: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-quotas-manage.html
- RDS PostgreSQL release history (18.6): https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/doc-history.html
- RDS DB class hardware: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.Summary.html
- RDS quotas: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html
- RDS automated backups/retention: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html
- RDS point-in-time restore: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html
- EC2 M7i hardware: https://aws.amazon.com/ec2/instance-types/general-purpose/
- EC2 instance families by region: https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html
- EC2 On-Demand instance quotas: https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html
- ALB quotas: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-limits.html
- VPC quotas: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
- gVisor Docker runtime quick start: https://gvisor.dev/docs/user_guide/quick_start/docker/
- gVisor installation: https://gvisor.dev/docs/user_guide/install/
- Secrets Manager rotation schedules: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html
- Fargate pricing: https://aws.amazon.com/fargate/pricing/
- RDS PostgreSQL pricing: https://aws.amazon.com/rds/postgresql/pricing/
- EC2 On-Demand pricing: https://aws.amazon.com/ec2/pricing/on-demand/
- ECR pricing: https://aws.amazon.com/ecr/pricing/
- CloudWatch pricing: https://aws.amazon.com/cloudwatch/pricing/

Service availability, applied account quotas, and prices can change. P1 must re-check the selected account/region immediately before provisioning and retain the observed values. That check does not authorize architecture substitution; a requirement that cannot be met reopens P0 by amendment.

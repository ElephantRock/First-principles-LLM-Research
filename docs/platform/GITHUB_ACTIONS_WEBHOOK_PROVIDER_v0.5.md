# Platform v0.5 — GitHub Actions & Webhook Provider Contract

**Status:** P0 FROZEN COMPANION / IMPLEMENTATION NOT YET VERIFIED  
**Date checked:** 2026-09-20  
**Parent decisions:** `PRODUCTION_PROVIDER_DECISIONS_v0.5.md`; `GITHUB_PROVIDER_LIMITS_v0.5.md`  
**Purpose:** close the remaining GitHub external-provider boundary for production release orchestration and GitHub App installation lifecycle webhooks.

---

## 0. Evidence boundary

This record freezes provider/product, trust, permissions, limits, data-region, cost, failure, and exit decisions. It does **not** claim that the production GitHub environment, AWS OIDC provider/roles, CodeBuild project, webhook secret, or GitHub App webhook configuration has been created or exercised.

Those are P1/P2 implementation/evidence requirements.

---

## 1. GitHub Actions — selected release-orchestration provider

### 1.1 Runner model

Use **standard GitHub-hosted `ubuntu-24.04` runners** for normal CI and the production-release orchestration job.

Do not run a persistent self-hosted GitHub Actions runner for v0.5. The initial beta does not need another always-on privileged host, and the production worker EC2 instance must not double as a CI runner.

Frozen production-release execution envelope:

```text
workflow trigger:       workflow_dispatch only
source branch:          main
GitHub environment:     production
runner:                 ubuntu-24.04 (standard GitHub-hosted)
release concurrency:    1
cancel in progress:     false
job timeout:            <= 60 minutes
AWS auth:               GitHub OIDC -> short-lived AWS role session
long-lived AWS keys:    forbidden
```

`pull_request`, `pull_request_target`, fork-originated workflows, and arbitrary branch workflows are not production deployment authority.

### 1.2 Published runner limits used by this beta

GitHub documents the current standard public-repository Linux runner as **4 vCPU, 16 GB RAM, 14 GB SSD**. Standard GitHub-hosted runners are free and unlimited for public repositories. GitHub documents a **6-hour maximum per hosted job**; the v0.5 release job imposes the much smaller 60-minute project limit. GitHub's lowest listed standard-runner account concurrency is 20 jobs for the Free plan; v0.5 requires only one production release job at a time.

If the repository ceases to be public, larger runners become necessary, or GitHub changes these terms so the release cannot fit the frozen envelope, record a P0 amendment before relying on a new runner/billing model.

### 1.3 Data/region implications

GitHub documents standard Ubuntu hosted runners as GitHub-managed VMs hosted in **Microsoft Azure**. They do not provide the AWS `eu-west-1` data-residency guarantee selected for the application infrastructure, and their outbound IP ranges are dynamic/shared.

Consequences:

- public repository source, workflow metadata, logs, and retained Actions artifacts are processed on GitHub/GitHub-hosted infrastructure rather than inside the production AWS VPC;
- the runner is not permitted direct network access to private RDS or the EC2 worker control plane;
- production AWS operations occur through authenticated AWS public control-plane APIs;
- the runner receives only short-lived AWS role credentials via OIDC and never an AWS access-key secret;
- **private hidden-evaluator source material must not be exposed to the GitHub-hosted runner in the production release path.**

### 1.4 Sensitive hidden-evaluator build boundary

Production hidden-evaluator image assembly runs in **AWS CodeBuild in `eu-west-1`**, started by the release workflow after OIDC authentication.

Frozen build identity:

```text
CodeBuild project: fpllm-beta-hidden-evaluator
region:            eu-west-1
output:            private ECR fpllm/hidden-evaluator image by immutable digest
```

The private evaluator bundle is stored in a dedicated **release-only S3 bucket** in `eu-west-1`, with Block Public Access, versioning, SSE-KMS, and no learner-facing API. This bucket is release infrastructure and does not reopen the decision that v0.5 has no learner artifact object store.

The CodeBuild service role may read only the versioned private-evaluator input prefix, decrypt only its release-material KMS key, write build logs, and push only to the hidden-evaluator ECR repository. The GitHub Actions roles are explicitly denied `s3:GetObject` on that release-material bucket and are not granted `kms:Decrypt` for that key.

The release record must bind:

```text
platform source SHA
private evaluator input object version + SHA-256 commitment
CodeBuild build ID
hidden evaluator ECR digest
public test bundle/version identity
```

This replaces the staging-only pattern in which a private evaluator bundle can be materialized from a GitHub Actions secret. Staging may retain its existing guarded harness; production does not promote that secret-distribution pattern.

---

## 2. Exact GitHub OIDC trust boundary

### 2.1 Federated identity

AWS IAM OIDC provider:

```text
issuer:   https://token.actions.githubusercontent.com
audience: sts.amazonaws.com
```

Production federated role:

```text
role name: fpllm-beta-github-oidc
```

The role trust policy must require **both**:

```text
token.actions.githubusercontent.com:aud == sts.amazonaws.com
token.actions.githubusercontent.com:sub == repo:ElephantRock/First-principles-LLM-Research:environment:production
```

No wildcard repository, organization, branch, or environment subject is accepted. The production workflow therefore must declare `environment: production`; GitHub environment protection/approval rules are part of the P1 release gate.

The workflow grants `id-token: write` only to the production deployment job and `contents: read` to checkout the frozen source. Production deployment does not require a GitHub package-write permission because images go to private ECR.

### 2.2 OIDC broker permissions

`fpllm-beta-github-oidc` is a **broker role**, not a general deployment/runtime role. Its AWS permissions are limited to:

```text
sts:GetCallerIdentity
sts:AssumeRole -> arn:aws:iam::<ACCOUNT_ID>:role/fpllm-beta-cdk-deploy
```

It receives no Secrets Manager read authority, no RDS data access, no S3 release-material read authority, no EC2 instance administration, and no permission to assume unrelated roles.

### 2.3 Production deployment role

`fpllm-beta-cdk-deploy` trusts only the broker role above. It may:

1. assume the dedicated CDK v2 bootstrap **lookup, deploy, file-publishing, and image-publishing roles** for the project bootstrap qualifier in `eu-west-1`;
2. start and inspect only CodeBuild project `fpllm-beta-hidden-evaluator`;
3. read deployment/provenance state required for smoke verification from the selected FPLLM CloudFormation/ECS/ECR/RDS resources;
4. publish only non-hidden build assets required by the FPLLM CDK stacks/ECR repositories.

It may **not** read the private evaluator release-material object/KMS key, application secrets, GitHub App private keys, OAuth client secrets, database credentials, learner evidence rows, or worker-host shell/SSM sessions.

The CDK CloudFormation execution roles are AWS-internal deployment authority, not GitHub runner credentials. P1 must generate/review their policy and permissions boundary in version control and constrain them to the selected FPLLM stacks/resources; attaching account-wide `AdministratorAccess` as the production steady-state execution policy is not permitted.

### 2.4 OIDC session and workflow protections

Production AWS sessions are short-lived and set to at most one hour. The release workflow must use a single production concurrency group so two releases cannot race migrations or deployment state.

A release is authorized only after:

```text
PR merged to main
+ exact main/source SHA frozen
+ CI green
+ review findings dispositioned
+ production environment approval
+ OIDC subject/audience match
```

Manual AWS console changes are not a substitute for this path except a documented break-glass incident action, which must be reconciled back into CDK and the release/incident record.

---

## 3. Actions cost, failure model, and exit path

### 3.1 Cost

Because the repository is public and uses standard GitHub-hosted runners, the P0 planning assumption is **USD 0/month incremental GitHub Actions compute cost**. Larger runners are not selected.

AWS CodeBuild/S3/KMS/ECR costs for the sensitive evaluator build are AWS infrastructure costs and must be included in the fresh P1 AWS Pricing Calculator/billing estimate.

### 3.2 Failure behavior

GitHub Actions outage/queue failure blocks **new releases** but must not stop an already-running production web/worker deployment. A failed workflow does not mutate learner evidence into success.

If Actions fails after an AWS operation starts, P1 release automation must reconcile actual CloudFormation/ECS/CodeBuild state before retrying. Re-running a workflow may not blindly repeat non-idempotent migration or release steps.

The production release workflow may be re-run only against the same frozen candidate or a new explicitly frozen candidate. Provider failure never authorizes a console-only release that omits provenance.

### 3.3 Exit/migration

GitHub Actions is an orchestration layer, not the owner of production state. CDK source, buildspecs, Dockerfiles, migrations, and release scripts remain in version control; AWS owns the deployed resources/images/evidence.

Moving later to another CI orchestrator requires replacement of workflow/OIDC glue and a committed provider amendment, but does not require a rewrite of the platform application, PostgreSQL evidence model, OCI images, or CDK stacks.

---

## 4. GitHub App webhook — production configuration

### 4.1 Canonical endpoint

Enable the GitHub App webhook with:

```text
active:       true
URL:          https://fpllm-beta-web.ecs.eu-west-1.on.aws/api/v1/github/webhooks
content type: application/json
TLS verify:   enabled
```

The webhook endpoint belongs to the web/control plane and never invokes learner code.

### 4.2 Event subscription

For v0.5 subscribe only to the GitHub App **`installation` lifecycle event** required by the existing installation-state contract. GitHub documents that all GitHub Apps receive the `installation` event by default.

Do not subscribe the production App to push, pull-request, issue, workflow, or other repository-content events merely for future use. If another event becomes required, add the minimum associated GitHub App permission through a reviewed decision/security amendment.

P1 must make the handler correctly and idempotently handle installation lifecycle actions relevant to authority, including installation creation, suspension/unsuspension, and deletion/revocation. A deleted or suspended installation must not remain usable merely because a historical database row exists; normal repository/source operations also continue to fail closed against live GitHub installation authority.

### 4.3 Webhook secret

Generate a cryptographically random webhook secret of at least **32 bytes** and store it in AWS Secrets Manager for the **web workload only**.

Runtime variable:

```text
GITHUB_WEBHOOK_SECRET
```

The worker, learner sandbox, GitHub Actions OIDC/deploy roles, and CodeBuild hidden-evaluator role do not receive this secret.

The endpoint validates `X-Hub-Signature-256` over the **raw request body before JSON processing**. Invalid/missing signatures are rejected without applying installation state.

### 4.4 Rotation

Rotate the webhook secret at least every 90 days and immediately on suspected compromise. Because the current implementation accepts one secret, P1 must add a bounded dual-secret rollover path before external beta:

```text
current secret
+ optional previous secret for <= 15 minutes
```

Rotation order:

1. generate/store new current secret while retaining previous;
2. update GitHub App webhook secret;
3. verify a signed delivery against the new value;
4. remove previous acceptance within 15 minutes;
5. record the rotation evidence without recording either secret value.

This avoids requiring the platform to accept unsigned deliveries during rotation.

### 4.5 Delivery identity and persistence

Use `X-GitHub-Delivery` as the webhook idempotency identity. P1 must make repeat deliveries safe: the same delivery may not produce conflicting installation state or duplicate authoritative transitions.

Persist only the minimum lifecycle evidence required for audit/state:

```text
delivery ID
event
action
installation numeric ID
account identity metadata needed by the binding model
suspended/revoked state
timestamp/correlation ID
```

Do not persist the full webhook body by default, and do not emit raw payloads or secrets to logs.

### 4.6 Webhook failure handling

A transient webhook failure does not create repository authority. Repository binding and worker source retrieval still resolve through live GitHub App installation authority and fail closed if access is gone.

After remediation, an operator may use GitHub's supported delivery/redelivery controls to replay a delivery; idempotency must make replay safe. Persistent webhook failure is observable operational debt and must be corrected before P2 can be called complete.

---

## 5. External-provider secrets and permissions inventory

| Provider surface | Secret/credential seen | Permissions/authority | Forbidden material |
|---|---|---|---|
| Human GitHub OAuth web flow | OAuth client secret + transient user token | `read:user` only | AWS creds, worker creds, hidden evaluator |
| GitHub App web repo proof/bind | App client secret; App private key; transient user token | App `Metadata: read`, `Contents: read`; no writes | learner sandbox credentials |
| GitHub App worker source retrieval | App private key -> installation token | App `Metadata: read`, `Contents: read`; no writes | human OAuth secret/token, webhook secret |
| GitHub App webhook endpoint | webhook HMAC secret | installation lifecycle notifications only | App private key, AWS deploy creds |
| GitHub-hosted production Actions runner | GitHub job token + OIDC token + short-lived broker/deploy AWS session | checkout public source; assume only selected release roles | application secrets, DB creds, App private key, webhook secret, private evaluator bundle |
| AWS CodeBuild hidden-evaluator build | CodeBuild service role | exact S3 release input/KMS decrypt + hidden-evaluator ECR push + logs | DB creds, OAuth/App/webhook secrets, learner evidence |

---

## 6. P1 verification created by this contract

P1 must retain evidence that:

- the production GitHub environment and workflow protections match this record;
- OIDC `aud` and exact `sub` conditions are applied and an untrusted/non-production subject cannot assume the role;
- broker/deploy roles have no secret/private-release-material read authority;
- standard runner/release concurrency and job timeout match the frozen envelope;
- the hidden-evaluator production build executes in CodeBuild and the GitHub-hosted runner never receives the private bundle;
- the release-material S3 bucket is private, versioned, KMS-encrypted, and unreadable by GitHub deployment roles;
- the webhook URL/event/secret/TLS configuration matches this record;
- invalid webhook signatures fail closed, duplicate delivery IDs are idempotent, and suspend/delete lifecycle changes revoke effective authority;
- Actions and webhook provider failures terminate/recover diagnostically without direct learner-evidence mutation.

---

## 7. Official research basis at decision freeze

Checked 2026-09-20:

- GitHub-hosted runner specifications, hosting/IP model: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- GitHub Actions limits: https://docs.github.com/en/actions/reference/limits
- GitHub Actions billing/public-repository standard-runner policy: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- GitHub OIDC concepts: https://docs.github.com/en/actions/concepts/security/openid-connect
- GitHub OIDC for AWS (`token.actions.githubusercontent.com`, `sts.amazonaws.com`): https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
- GitHub App webhooks, URL and webhook secret: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps
- GitHub webhook event payloads / `installation` event / delivery headers: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- GitHub App webhook configuration: https://docs.github.com/en/rest/apps/webhooks
- AWS CodeBuild project/role model: https://docs.aws.amazon.com/codebuild/latest/userguide/create-project.html
- AWS CodeBuild Docker/ECR build examples: https://docs.aws.amazon.com/codebuild/latest/userguide/sample-docker.html

Provider products, limits, pricing, and permissions can change. P1 must re-check them immediately before provisioning; any change that invalidates this trust/cost/limit envelope reopens the affected P0 decision.
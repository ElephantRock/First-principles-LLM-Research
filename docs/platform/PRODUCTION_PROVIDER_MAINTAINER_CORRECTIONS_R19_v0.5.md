# Platform v0.5 — Maintainer Corrections Round 19 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Maintainer review baseline:** `ba249726082dba378d9cb59c1851f55eff0bf666`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and maintainer finding

The final provider-limit pass found one remaining P0 completeness gap introduced by the protected release architecture itself:

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| FPR19-01 | HIGH | The original provider-limit table covered the web/worker/database network but later correction rounds added three protected CodeBuild projects, three reserved-concurrency Lambdas, DynamoDB release-control state, and private VPC endpoints without freezing their material service quotas/consumption envelope. Earlier Codex review already established that provider limits capable of stopping the learner/release loop belong in P0 rather than being discovered only after provisioning starts. | Freeze one x86 Linux CodeBuild compute class and globally serialize the three protected builds so the beta requires only one concurrent CodeBuild slot; record the published CodeBuild project/VPC limits, the exact Lambda reserved-concurrency admission requirement, the bounded DynamoDB table/throughput envelope, and the sensitive-build interface-endpoint count. Extend the first P1 read-only admission report to these services. Any unmet minimum is a hard stop; no silent compute/provider substitution is allowed. |

Precedence is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R19_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R18_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R17_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R16_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R15_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R14_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R13_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R12_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R11_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R10_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R9_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R8_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R7_v0.5.md
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

# 1. Protected CodeBuild compute and concurrency envelope — FROZEN

All three protected image-build projects use the same on-demand x86 Linux compute class in `eu-west-1`:

```text
environment type: LINUX_CONTAINER
compute type:     BUILD_GENERAL1_LARGE
memory:           up to 16 GiB
vCPU:             up to 8
build timeout:    <= 30 minutes
privileged mode:  only where the frozen Docker build requires it
```

The projects are:

```text
fpllm-beta-worker
fpllm-beta-hidden-evaluator-base
fpllm-beta-hidden-evaluator
```

AWS documents `BUILD_GENERAL1_LARGE` for `LINUX_CONTAINER` as up to 16 GiB memory and 8 vCPUs. CodeBuild is available in Europe (Ireland), `eu-west-1`.

Official basis:

- https://docs.aws.amazon.com/codebuild/latest/APIReference/API_ProjectEnvironment.html
- https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-compute-types.html
- https://docs.aws.amazon.com/general/latest/gr/codebuild.html

## 1.1 Global protected-build serialization

The existing per-component one-active-build rule is strengthened for the initial beta:

```text
maximum protected CodeBuild executions running at once across
worker + evaluator-base + hidden-evaluator = 1
```

The execution-release broker schedules the three component builds sequentially. The final hidden-evaluator build still cannot start before the evaluator-base digest is canonical. Worker and evaluator-base may be built in either deterministic broker-selected order, but not concurrently.

This intentionally trades release latency for a smaller, deterministic quota requirement. Release build speed is not part of the learner-facing latency SLO.

The broker's durable candidate/build state remains authoritative; a CodeBuild queue/throttle response does not consume an additional logical build attempt unless the provider actually accepted the frozen `StartBuild` request under the existing R10–R12 semantics.

## 1.2 Published CodeBuild limits used by v0.5

AWS's published default/service limits currently include:

```text
build projects / Region:                         5,000 adjustable
Linux/Large concurrently running builds:        published default 1, adjustable
build timeout:                                   5..2,160 minutes hard bounds
security groups under one CodeBuild VPC config:  5 hard
subnets under one CodeBuild VPC config:          16 hard
concurrent build-information requests:           100 hard
```

AWS also notes that concurrent-build defaults can be affected by internal/account metrics. Therefore the published default is not treated as evidence that this specific account has one usable slot.

v0.5 consumption/minimum is:

```text
protected projects required:             3
concurrent protected build slots needed: 1 Linux/Large
hidden-builder VPC security groups:       <= 1 project SG set, below 5
hidden-builder VPC subnets:               <= 3 selected private subnets, below 16
```

The first P1 read-only admission report must verify the account's **applied** Linux/Large concurrent-build quota is at least 1 and that `LINUX_CONTAINER + BUILD_GENERAL1_LARGE` is usable in `eu-west-1` before any protected project is provisioned or relied on.

If the applied quota is zero, the selected compute class is unavailable, or the frozen Docker/private-VPC configuration cannot run on this class, provisioning stops. P1 must not silently switch compute type, region, concurrency model, GitHub-built bytes, or builder provider. Any material substitution reopens P0.

Official quota basis:

- https://docs.aws.amazon.com/codebuild/latest/userguide/limits.html

---

# 2. Protected Lambda concurrency envelope — FROZEN

The protected control plane now contains exactly three normal v0.5 Lambda functions with reserved concurrency 1:

```text
fpllm-beta-sensitive-release-admit       reserved concurrency = 1
fpllm-beta-execution-release-broker      reserved concurrency = 1
fpllm-beta-promotion-controller          reserved concurrency = 1
```

No superseded separate recovery Lambda is provisioned.

AWS documents a default Regional Lambda account concurrency of 1,000 and requires at least 100 concurrency units to remain unreserved when assigning reserved concurrency. The exact account value is adjustable and must be read rather than assumed.

For this project, P1 admission requires that after considering existing account reservations/allocations, the account can reserve **three additional units** while preserving AWS's required 100-unit unreserved pool. Equivalently, the relevant account state must expose at least three allocatable reserved-concurrency units for these functions; a nominal account limit alone is not enough if other workloads already consume the reservable pool.

The project does not require provisioned concurrency for these low-volume operator/control paths.

If the three one-unit reservations cannot be created, P1 stops. Do not remove reserved concurrency, merge trust-separated functions, or raise function concurrency as an undocumented workaround.

Official basis:

- https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html
- https://docs.aws.amazon.com/lambda/latest/api/API_PutFunctionConcurrency.html

---

# 3. DynamoDB release-control envelope — FROZEN

The protected release-control state remains DynamoDB on-demand/PAY_PER_REQUEST.

The preferred topology is one table:

```text
fpllm-beta-sensitive-release
```

R15 permits a separately permissioned worker-drain acknowledgement namespace/table if needed to make worker IAM separation mechanically provable. Therefore the maximum v0.5 protected release-control table count is:

```text
2 tables
```

Neither table uses DynamoDB Streams for the initial beta unless a later reviewed implementation requirement explicitly proves it is necessary without weakening the authority model.

Expected release-control traffic is single-digit/low-double-digit operations around human-paced release actions and worker drain heartbeats, orders of magnitude below the provider limit. AWS documents an initial on-demand table-level quota of 40,000 read request units and 40,000 write request units per second and an initial account table quota of 2,500 tables.

P1 must verify the account can create the required one or two tables and that no account/table override has been configured below the bounded project requirement. A provider throttle remains diagnostic infrastructure state; it cannot be reclassified as learner/evaluator failure.

Official basis:

- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html
- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode-max-throughput.html

---

# 4. Sensitive-build VPC endpoint envelope — FROZEN

The sensitive hidden-evaluator builder's no-Internet topology from R3 requires the following interface endpoints in the selected VPC:

```text
ECR API
ECR DKR
CloudWatch Logs
```

and may add:

```text
KMS interface endpoint
```

only if P1 proves the build container requires a direct KMS API call. S3 remains a gateway endpoint and therefore does not consume the interface/Gateway Load Balancer endpoint quota counted here.

Maximum v0.5 interface-endpoint consumption attributable to this sensitive-build path is therefore:

```text
4 interface endpoints
```

AWS documents a default quota of 50 interface + Gateway Load Balancer endpoints per VPC, adjustable. P1 must inspect the selected VPC's existing endpoint usage and prove at least four slots remain if the optional KMS endpoint is required, or at least three otherwise. An exhausted endpoint quota is a hard pre-provisioning stop; general Internet/NAT egress is not an allowed substitute for the sensitive builder.

Official basis:

- https://docs.aws.amazon.com/general/latest/gr/vpc-service.html
- https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html
- https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html

---

# 5. First P1 quota/availability report — EXTENDED HARD ADMISSION GATE

The already-frozen first P1 action remains a **read-only, no-create** quota/availability report. It now covers the complete corrected topology, including at minimum:

```text
Fargate applied vCPU quota and Express capability
EC2 Standard On-Demand vCPU quota + m7i.xlarge availability
RDS PostgreSQL 18.6 / db.m8gd.large orderability + DB/storage quotas
ALB/VPC/subnet/security-group quotas already recorded

CodeBuild:
  BUILD_GENERAL1_LARGE availability in eu-west-1
  applied Linux/Large concurrent-build quota >= 1
  project-count headroom >= 3
  hidden-build VPC SG/subnet limits

Lambda:
  account concurrency
  existing reserved/provisioned allocations relevant to reservation
  ability to reserve 1 for each of the three protected functions while leaving 100 unreserved

DynamoDB:
  table-count headroom >= 2
  no table/account override below the tiny release-control envelope

VPC endpoints:
  endpoint count/headroom for 3 required + optional KMS interface endpoint
```

The retained report records actual observed account values, region, timestamp, identity used for the read-only check, and the frozen minimum beside each observation.

Any failed minimum stops provisioning. P1 may request an ordinary adjustable quota increase and re-run the report, but may not provision a substitute architecture while the report is red. If a frozen service/class is unavailable or a required quota cannot reasonably be obtained, reopen P0 and record the architectural amendment.

---

# 6. Cost consequence

Global protected-build serialization does not add an always-on resource and should reduce accidental concurrent CodeBuild spend. Selecting `BUILD_GENERAL1_LARGE` does increase per-build compute cost relative to smaller classes, but release builds are human-paced and bounded by the existing three-start-per-component control.

The existing planning envelope and authoritative USD 900/month stop/review threshold remain unchanged. The fresh P1 AWS Pricing Calculator estimate must include the selected Linux/Large CodeBuild runtime, three low-volume Lambda functions, one or two DynamoDB on-demand tables, and the realized private interface endpoints.

---

# 7. Required P1 evidence additions

P1 must prove, in addition to every earlier gate:

1. all three protected CodeBuild projects use `LINUX_CONTAINER + BUILD_GENERAL1_LARGE` in `eu-west-1` with the frozen timeout/privilege/network distinctions;
2. at most one protected CodeBuild execution is running at a time across all three projects;
3. the account has at least one usable applied Linux/Large concurrent-build slot before protected build provisioning/use;
4. a CodeBuild quota/throttle condition fails diagnostically without bypassing logical-attempt accounting or private-build isolation;
5. the three protected Lambda functions each have reserved concurrency 1 and the account still satisfies the 100-unit unreserved requirement;
6. no superseded recovery Lambda or undocumented direct mutation function is deployed;
7. release-control DynamoDB uses at most two on-demand tables and remains far below any configured maximum-throughput override;
8. the sensitive build has sufficient VPC endpoint quota without adding Internet/NAT egress;
9. the complete read-only quota/availability report is retained before resource creation and every failed minimum causes a hard stop or explicit P0 amendment.

---

# 8. Review-state boundary

Round 19 closes FPR19-01 at the decision/specification level. It does not claim applied AWS quotas, selected compute availability, Lambda reservations, DynamoDB capacity, VPC endpoint headroom, pricing, or production AWS evidence have been verified.

The exact resulting HEAD must now:

```text
pass CI/affected gates
-> receive a fresh exhaustive maintainer exact-HEAD re-review
-> receive a fresh exact-HEAD Codex second opinion
-> disposition every actionable review thread
-> pass final exact-HEAD CI/review/thread checks
-> squash merge
```

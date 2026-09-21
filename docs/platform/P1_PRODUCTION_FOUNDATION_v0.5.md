# Platform v0.5 — P1 Production Foundation

**Status:** P1 IN PROGRESS / PRE-PROVISION ADMISSION TOOLING ONLY  
**Date:** 2026-09-20  
**P0 baseline:** `fc46a2843ac79cef23b82b08cc08dba5a1a1b095`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §15  
**Authoritative provider/security decisions:** `PRODUCTION_PROVIDER_DECISIONS_v0.5.md` plus correction precedence through `PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R31_v0.5.md`

---

## 0. Purpose and evidence boundary

P1 is the production-foundation gate:

```text
clean production provision
+ migrations
+ backup/restore
+ rollback
+ retained runbook/drill evidence
```

This document starts P1. It does **not** claim that any AWS resource has been created or that P1 has passed.

The first P1 action remains the P0-frozen **read-only, no-create quota/availability/topology admission report**. Provisioning remains blocked until:

```text
live no-create admission report is green
+ controlled evidence is dispositioned by the maintainer
+ fresh exact-topology cost estimate remains below the USD 900/month stop/review threshold
```

The report is therefore a necessary admission input, not stand-alone authority to create resources.

Repository CI validates the collector with fixtures and mocked read-only AWS responses only. CI is not production-account evidence and a fixture result can never be classified as a live admission pass.

---

## 1. Frozen P0 inputs carried into P1

The implementation must preserve the authoritative corrected baseline, including:

```text
AWS region: eu-west-1
web: ECS Express / Fargate
worker: one m7i.xlarge trusted host
RDS: PostgreSQL 18.6, db.m8gd.large, gp3, Single-AZ
protected builds: 3 CodeBuild projects, LINUX_CONTAINER + BUILD_GENERAL1_LARGE
protected build concurrency: 1 globally across the three projects
protected control Lambdas: 6, reserved concurrency 1 each
protected release-control: DynamoDB on-demand, at most 2 tables
mutatingEmergencyRepairProfiles: []
incident mediator: existing protected incident broker, VPC-attached, no NAT/Internet
incident DB identity: fpllm_incident_fence via RDS IAM database authentication
```

The authoritative correction chain, not stale text in an earlier parent record, governs when values conflict.

---

## 2. Pre-create topology plan

The nominal production VPC remains:

```text
10.42.0.0/16
```

P1 selects six non-overlapping `/24` subnets before create:

```text
public-a:              10.42.0.0/24
public-b:              10.42.1.0/24
private-app-control-a: 10.42.16.0/24
private-app-control-b: 10.42.17.0/24
private-db-a:          10.42.32.0/24
private-db-b:          10.42.33.0/24
```

The actual two Availability Zone names are **not hard-coded**. The admission report requires at least two enabled AZs that support the exact RDS configuration and requires `m7i.xlarge` to be offered in at least one of those selected AZs. The initial topology contains one worker host, so requiring the worker instance type in both selected AZs would be a stronger constraint than P0 requires.

The collector requires the reviewed private application/control CIDRs rather than accepting arbitrary caller-supplied topology. It proves that the complete six-subnet plan is inside `10.42.0.0/16` and non-overlapping.

The `/24` private application/control subnets deliberately exceed the collector's conservative pre-create margin of 32 usable IPv4 addresses per subnet. That margin, plus the regional security-group and ENI headroom checks, are P1 implementation safety checks rather than new P0 provider decisions.

No NAT gateway is selected for the initial beta.

---

## 3. Endpoint plan

Required private service paths are:

```text
interface endpoints:
  ECR API
  ECR DKR
  CloudWatch Logs

optional interface endpoint:
  KMS — only if implementation proves a direct KMS API call from the sensitive builder is required

gateway endpoints:
  S3
  DynamoDB
```

The sensitive final-evaluator build retains no Internet/NAT path. The VPC-attached incident mediator reaches protected DynamoDB state through the DynamoDB gateway endpoint and reaches only the exact production RDS primary over the selected security-group TCP/5432 path.

The no-create collector checks the applicable provider quota and current regional gateway-endpoint consumption. KMS is queried and required only when the implementation explicitly selects the optional KMS interface endpoint.

A future unplanned AWS API dependency that would require another interface endpoint must be added to topology/cost/quota admission before provisioning rather than silently enabling NAT.

---

## 4. Read-only admission collector

The repository entry point is:

```text
scripts/ops/p1_readonly_admission.py
```

Example execution under a short-lived read-only/federated AWS identity:

```bash
python scripts/ops/p1_readonly_admission.py \
  --region eu-west-1 \
  --private-subnet-cidr 10.42.16.0/24 \
  --private-subnet-cidr 10.42.17.0/24 \
  --output .artifacts/p1/aws-readonly-admission.json
```

If the sensitive-build implementation requires a direct KMS endpoint, add:

```bash
--require-kms-interface-endpoint
```

The collector has an explicit read-only AWS-operation allowlist. It gathers account identity, account-applied adjustable quotas, recent Fargate/EC2 vCPU consumption from CloudWatch `AWS/Usage`, current regional resource consumption, exact RDS orderability/capability, regional VPC endpoint-service availability, a regional CodeBuild curated Linux-container capability observation, Lambda account concurrency and existing reserved/provisioned allocations, and the AZ/topology information needed by the reviewed plan. It performs no create/update/delete operation.

For adjustable account quotas that can stop provisioning, the collector requires an account-applied value and refuses to substitute the provider default when Service Quotas does not expose one. Non-adjustable hard limits already frozen in P0 are evaluated as provider constraints against the reviewed topology instead of being misrepresented as account-applied values.

Fargate and Standard On-Demand EC2 admission is based on **remaining headroom**, not merely the nominal applied quota. The collector reads CloudWatch `AWS/Usage` `ResourceCount` for the quota-corresponding `vCPU` resource and retains the complete recent measurement window in controlled evidence. An empty window is unknown, not zero. The collector also requires the latest datapoint to be no older than five minutes; absent or stale telemetry leaves the admission check red.

R19 separately requires the selected CodeBuild environment to be usable in `eu-west-1`, not merely to have a nominal concurrency quota. The collector therefore combines three read-only/provider facts before this surface can pass:

```text
1. account-applied Linux/Large concurrent-build quota >= 1
2. regional CodeBuild ListCuratedEnvironmentImages succeeds and returns
   at least one Linux curated Docker image on the eu-west-1 endpoint
3. the P0-frozen provider mapping remains
   LINUX_CONTAINER + BUILD_GENERAL1_LARGE, with the recorded VPC limits
```

This is the strongest pre-create read-only capability proof available without provisioning or starting a protected build. It is deliberately not represented as proof that a future project has executed successfully. The created protected projects must still prove the exact private-VPC/Docker configuration after provisioning and before production reliance.

ECS Express capability is checked by a real read-only `DescribeExpressGatewayService` call against a deliberately nonexistent service ARN. A documented `ResourceNotFoundException` or equivalent service/cluster-not-found response proves that the regional API recognizes the operation. A documented `UnsupportedFeatureException` is classified as regional unsupported. A local CLI command model alone is not accepted as regional evidence.

Lambda concurrency collection is deliberately repeated rather than treated as one atomic API snapshot. Each attempt brackets the full function/reserved/provisioned inventory with `GetAccountSettings` before and after the inventory. The account concurrency fields must be unchanged across that bracket, and **two consecutive bracketed samples must be byte-equivalent after canonicalization of the relevant account and function allocation state**. The function set is part of the fingerprint. The collector allows at most three attempts; failure to obtain two consecutive identical samples is a hard collection failure rather than a best-effort estimate.

The collector records:

- `evidenceSource=fixture` or `evidenceSource=live-aws`;
- the committed collector revision and script SHA-256;
- AWS CLI v2 version, resolved executable path, and executable SHA-256 for live collection;
- the recent Fargate On-Demand and EC2 Standard On-Demand vCPU usage windows, freshness metadata, and maxima used in free-capacity calculations;
- the regional CodeBuild curated Linux-container observation used with the account-applied Linux/Large quota and frozen provider mapping;
- every currently enumerated Lambda function's reserved concurrency plus each provisioned-concurrency configuration, using the maximum of requested/allocated/available values as the conservative claim while a configuration may be converging;
- Lambda snapshot-verification metadata, including the two-consecutive-bracketed-sample method, attempts used, relevant account concurrency values, and a SHA-256 of the stabilized allocation fingerprint;
- the exact incident-database user and account/region-bound `rds-db:connect` ARN and policy templates with only the future DBI resource ID left as a placeholder;
- a SHA-256 companion for the complete controlled report.

Only a live report may set `liveAdmissionPassed=true`. Even a green live report leaves `productionResourceCreationAuthorizedByThisReport=false` because the cost and maintainer-evidence gates remain separate requirements.

The complete report and its digest companion are written atomically with owner-only (`0600`) permissions on POSIX systems.

---

## 5. Admission checks

The report must be green at minimum for the frozen P0 thresholds and the explicitly documented P1 safety margins:

| Surface | Admission requirement |
|---|---|
| Region | `eu-west-1` enabled |
| Fargate | account-applied On-Demand vCPU quota minus recent maximum observed `AWS/Usage` On-Demand Fargate vCPU consumption leaves **>=6 free vCPU**; telemetry must contain a sufficiently recent datapoint |
| EC2 worker | account-applied Standard On-Demand vCPU quota minus recent maximum observed `AWS/Usage` Standard On-Demand EC2 vCPU consumption leaves **>=4 free vCPU**; telemetry must contain a sufficiently recent datapoint; `m7i.xlarge` is offered in at least one selected RDS-capable AZ |
| RDS exact selection | PostgreSQL 18.6 + `db.m8gd.large` + `gp3` orderable; VPC, encryption, storage autoscaling and IAM DB authentication supported; 20 GiB initial / >=100 GiB max support |
| RDS AZ topology | at least two enabled AZs support the exact RDS configuration; one of the selected AZs also offers `m7i.xlarge` |
| RDS capacity | >=2 DB-instance slots and >=200 GiB headroom after existing instances' configured autoscaling ceilings |
| RDS backup/topology | >=2 free manual DB-snapshot slots; P0-recorded DB subnet-group hard limit permits the two reviewed DB subnets |
| ALB/VPC | >=1 ALB and >=1 VPC headroom |
| Network safety margin | >=8 free regional security groups and >=32 free regional ENI slots before create |
| CodeBuild | account-applied Linux/Large concurrency >=1; >=3 project headroom; regional curated-environment read returns Linux Docker capability; P0-frozen `LINUX_CONTAINER + BUILD_GENERAL1_LARGE` mapping and VPC limits cover one build SG and two private app/control subnets |
| Lambda snapshot coherence | bracket every full allocation inventory with account concurrency reads; require two consecutive identical canonical snapshots, including function-set stability, within three attempts or fail collection |
| Lambda inventory | enumerate every current function's reserved concurrency and provisioned-concurrency configs; account `ConcurrentExecutions - UnreservedConcurrentExecutions` must equal the enumerated reserved total or the report fails closed as a raced/incomplete inventory |
| Lambda protected reservations | deduct provisioned concurrency on functions without reserved concurrency from account `UnreservedConcurrentExecutions`, then require enough effective unreserved capacity to add six one-unit protected reservations while still preserving >=100 unreserved |
| DynamoDB | >=2 table headroom; initial beta remains PAY_PER_REQUEST |
| DynamoDB throughput semantics | P0's 40k/40k initial per-table on-demand envelope is a provider baseline, not a fictitious account-level on-demand throughput quota; the created tables' explicit maximum-throughput configuration is verified post-create |
| VPC endpoints | account quota plus current gateway-endpoint headroom and service availability for required endpoint types |
| Private app/control subnets | reviewed `/24` CIDRs and >=32 usable IPv4 addresses each as a conservative P1 margin |
| Incident mediator | VPC attachment shape fits Lambda limits, no NAT/Internet egress is selected, DynamoDB gateway access is planned, and RDS path is TCP/5432 |
| Incident DB authority | IAM DB authentication selected for exact user `fpllm_incident_fence`; report binds `arn:aws:rds-db:eu-west-1:<account>:dbuser:<DBI_RESOURCE_ID>/fpllm_incident_fence` and an allow policy containing only `rds-db:connect` to that resource template; created DBI resource ID/effective policy remain post-create proof |
| Incident DB budget | exact planned maximum of one concurrent `fpllm_incident_fence` session; live RDS `max_connections`/headroom proof remains required post-create before incident use |

Any failed frozen minimum is a hard provisioning stop. A normal adjustable quota increase may be requested and the report re-run. A provider/class/region/topology substitution requires an explicit P0 amendment.

---

## 6. Compute-vCPU headroom evidence boundary

The P0 minima of 6 Fargate On-Demand vCPU and 4 Standard On-Demand EC2 vCPU are capacity minima for this production slice. A nominal account quota at exactly those values is insufficient if another workload is already consuming the quota.

AWS publishes quota-corresponding `ResourceCount` usage metrics in the `AWS/Usage` namespace. For this admission report the collector reads:

```text
Fargate:
  Service = Fargate
  Type = Resource
  Resource = vCPU
  Class = Standard/OnDemand

EC2:
  Service = EC2
  Type = Resource
  Resource = vCPU
  Class = Standard/OnDemand
```

The collector requests a 15-minute read-only window at one-minute resolution and uses the window's `Maximum` value only when the response contains a sufficiently recent datapoint. The latest datapoint must be no more than five minutes old. The calculations are:

```text
free Fargate On-Demand vCPU
= applied Fargate On-Demand vCPU quota
- recent maximum observed Fargate On-Demand vCPU usage

free Standard On-Demand EC2 vCPU
= applied Standard On-Demand EC2 vCPU quota
- recent maximum observed Standard On-Demand EC2 vCPU usage
```

Admission requires:

```text
fresh usage telemetry exists
free Fargate On-Demand vCPU >= 6
free Standard On-Demand EC2 vCPU >= 4
```

A 15-minute maximum is deliberately conservative relative to a single instantaneous sample: recently released capacity is not immediately assumed free for the gate. **An empty datapoint window is not interpreted as zero usage.** Empty or stale telemetry is retained as controlled evidence with `telemetryComplete=false` and `maximumObservedVcpu=null`, which makes the corresponding headroom check fail. This prevents delayed/missing metrics from being converted into false free capacity.

This evidence is still a point-in-time admission observation, not a reservation of quota. A later account-state change can consume headroom, so provisioning/release operations remain responsible for ordinary provider errors and must not reinterpret them as learner failures.

---

## 7. CodeBuild pre-create capability boundary

R19 freezes all three protected projects to:

```text
environment type: LINUX_CONTAINER
compute type:     BUILD_GENERAL1_LARGE
region:           eu-west-1
concurrency:      one protected build globally
```

The first P1 report must not infer environment usability from a generic CodeBuild service response or a published default quota. The pre-create proof combines:

```text
live/account evidence:
  account-applied Linux/Large concurrent-build quota >= 1
  eu-west-1 ListCuratedEnvironmentImages call succeeds
  returned regional catalog contains at least one Linux curated Docker image

frozen provider evidence from P0/R19:
  LINUX_CONTAINER maps to BUILD_GENERAL1_LARGE
  Linux/Large supplies the frozen 16 GiB / 8-vCPU class
  CodeBuild VPC config admits the reviewed SG/subnet counts
```

The curated-image observation is not treated as proof about the eventual protected image contents, project IAM, VPC routing, Docker privilege, or build execution. Those are post-create verification surfaces. It is a read-only regional capability signal paired with the exact account-applied Linux/Large slot, rather than a fabricated assertion that quota alone proves the selected environment exists.

If the regional CodeBuild read is unavailable, malformed, or exposes no Linux curated Docker image, the admission report remains red. P1 does not silently select another compute type or region.

---

## 8. Lambda concurrency evidence boundary

R19 requires the first P1 report to consider existing **reserved and provisioned** concurrency allocations, not merely the nominal Regional concurrency limit.

The collector therefore combines two distinct views:

```text
GetAccountSettings:
  ConcurrentExecutions
  UnreservedConcurrentExecutions

per-function inventory:
  current function set
  ReservedConcurrentExecutions
  all ProvisionedConcurrencyConfigs
```

The Lambda APIs do not provide one transactionally atomic read across those surfaces. The collector therefore constructs a fail-closed stable observation:

```text
attempt N:
  GetAccountSettings (before)
  enumerate complete function set
  for every function:
    GetFunctionConcurrency
    ListProvisionedConcurrencyConfigs
  GetAccountSettings (after)

accept an attempt only when:
  relevant account concurrency before == after

accept the overall Lambda observation only when:
  two consecutive accepted attempts have identical canonical
  account + function-set + reserved/provisioned allocation state
```

At most three attempts are made. If the state continues to change, collection fails rather than selecting one raced sample. Function order and provisioned-configuration order are canonicalized before comparison so provider ordering alone does not create a false race. The retained report records the stabilized snapshot fingerprint and verification metadata.

`UnreservedConcurrentExecutions` already reflects reserved concurrency. The collector independently enumerates the reserved total and requires it to match `ConcurrentExecutions - UnreservedConcurrentExecutions`; disagreement is treated as a race or incomplete observation and fails closed.

Provisioned concurrency that belongs to a function with reserved concurrency is already covered by that function's reserved allocation and is not deducted again. Provisioned concurrency on a function without reserved concurrency consumes the shared account pool, so the conservative pre-create calculation is:

```text
effective unreserved
= UnreservedConcurrentExecutions
- provisioned concurrency not covered by function reserved concurrency
```

The admission minimum is then:

```text
effective unreserved >= 100 + 6
```

where six is the number of one-unit protected reservations frozen by the corrected topology. For a provisioned-concurrency configuration in transition, the collector uses the maximum of its requested, allocated, and available values rather than assuming the smallest transient value is safe.

---

## 9. Live parser/provider-contract regression boundary

The fixture suite exercises the pure admission evaluator, but the P1 collector also depends on nontrivial live AWS response classification and merging. CI therefore includes mocked read-only AWS response coverage for the live parsing layer, including:

```text
ECS Express:
  ResourceNotFoundException => regional API recognized
  UnsupportedFeatureException => regional API unsupported

Service Quotas:
  applied account value overrides same-code provider default
  default-only entries remain explicitly tagged aws-default

CloudWatch AWS/Usage:
  fresh ResourceCount datapoints retain the maximum used for headroom
  empty or stale telemetry remains unknown and fails admission

CodeBuild:
  regional curated Linux catalog is parsed as a capability observation
  malformed or absent Linux capability cannot satisfy the environment gate

Lambda:
  two stable bracketed allocation samples are accepted
  changing provisioned concurrency across samples fails closed
```

These tests prove collector behavior against representative provider contracts; they are not a substitute for the live no-create run against the intended production account.

---

## 10. DynamoDB on-demand boundary

The initial protected release-control tables remain DynamoDB `PAY_PER_REQUEST`. The P0 record captured AWS's initial 40,000 read-request-unit and 40,000 write-request-unit per-table on-demand envelope.

AWS does not apply an account-level read/write throughput quota to on-demand tables. Therefore the pre-create collector must not invent an account-level throughput value merely to make the report look more comprehensive. Before the tables exist, the collector proves table-count headroom and retains the frozen provider baseline. After creation, P1 must prove the exact tables are `PAY_PER_REQUEST` and that no configured table-level maximum is below the bounded release-control requirement.

---

## 11. Evidence handling

The complete admission JSON contains AWS account identity and current infrastructure inventory. It is controlled operational evidence and must not be blindly committed to this public repository.

The public P1/release record may retain a redacted summary plus the report SHA-256. No secret value or credential is written by the collector.

A green fixture run or repository CI run proves only collector behavior. The live admission condition becomes green only after the collector runs against the intended AWS account under an attributable read-only identity and the retained live report passes. Resource creation remains blocked until the fresh exact-topology cost estimate and maintainer evidence disposition also pass.

---

## 12. What remains after pre-create admission

A green live no-create report is one required input to the next P1 implementation slice; it does not independently authorize provisioning and does not complete P1. Subsequent evidence must include, at minimum:

1. fresh exact-topology cost evidence below the USD 900/month stop/review threshold before creation;
2. clean infrastructure provisioning from committed IaC after the complete pre-create gate is green;
3. production migrations with the frozen expand-compatible discipline;
4. exact IAM, ECR, CodeBuild, Lambda, DynamoDB, VPC endpoint, security-group and database-role negative-authority proofs;
5. RDS IAM authentication enabled on the created primary and exact `rds-db:connect` identity/effective policy after replacing the DBI resource ID placeholder;
6. live RDS connection headroom, including the <=1 incident-mediator session budget;
7. real subnet available-IP/ENI capacity and VPC attachment evidence;
8. realized DynamoDB `PAY_PER_REQUEST` configuration and table-level maximum-throughput evidence;
9. the real protected CodeBuild projects successfully execute the frozen `LINUX_CONTAINER + BUILD_GENERAL1_LARGE` private-VPC/Docker configuration before production reliance;
10. migration, backup/PITR, restore-to-clean-target and rollback runbooks/drills;
11. retained production evidence separating design intent from verified state.

Only after those requirements and the governing P1 acceptance evidence are satisfied may P1 be marked complete.

---

## 13. Current state

```text
P0: CLOSED and merged at fc46a2843ac79cef23b82b08cc08dba5a1a1b095
P1 admission collector: implementation/review in progress
live AWS read-only admission report: NOT YET RUN / NOT YET VERIFIED
fresh exact-topology cost estimate: NOT YET VERIFIED
AWS production resources created by this P1 slice: NONE
P1 gate: OPEN
```

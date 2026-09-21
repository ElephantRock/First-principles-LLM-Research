# Platform v0.5 — P1 Production Foundation

**Status:** P1 IN PROGRESS / PRE-PROVISION ADMISSION TOOLING ONLY  
**Date:** 2026-09-21  
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

The report is therefore a necessary admission input, not stand-alone authority to create resources. Repository CI validates the collector with fixtures and mocked read-only AWS responses only. CI is not production-account evidence and a fixture result can never be classified as a live admission pass.

Even a green live report retains:

```text
productionResourceCreationAuthorizedByThisReport = false
```

---

## 1. Frozen P0 inputs carried into P1

The implementation preserves the authoritative corrected baseline, including:

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

The actual two Availability Zone names are not hard-coded. The admission report requires at least two enabled AZs that support the exact RDS configuration and requires `m7i.xlarge` to be offered in at least one of those selected AZs. The initial topology contains one worker host, so requiring the worker instance type in both selected AZs would strengthen P0 unnecessarily.

The collector requires the reviewed private application/control CIDRs rather than accepting arbitrary caller-supplied topology. The full six-subnet plan must fit inside `10.42.0.0/16` without overlap. The private application/control `/24`s exceed the conservative pre-create margin of 32 usable IPv4 addresses per subnet.

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

---

## 4. Read-only admission collector

The repository entry point is:

```text
scripts/ops/p1_readonly_admission.py
```

The stable entry point loads the reviewed implementation core from:

```text
scripts/ops/p1_readonly_admission_core.py
```

The split is deliberate. The core retains the reviewed fail-closed collector while the small entry point contains the final provider-accounting corrections for future-dated EC2 Capacity Reservation commitments and exclusion of `InstanceLifecycle=capacity-block` instances from Standard On-Demand vCPU usage. Live evidence provenance binds **both** files to the same Git revision and records a SHA-256 and tracked-working-tree cleanliness result for each. A live run fails if either tracked collector file differs from the committed checkout.

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

The collector has an explicit read-only AWS-operation allowlist. It performs no create, update, delete, start, stop, reservation, or quota-change operation.

For adjustable account quotas that can stop provisioning, the collector requires an account-applied value and refuses to substitute a provider default. Non-adjustable hard limits already frozen in P0 are represented as provider constraints rather than fabricated account observations.

### 4.1 Compute-vCPU evidence is metric plus direct inventory

Fargate On-Demand and EC2 Standard On-Demand admission is based on **remaining headroom**, not nominal quota.

CloudWatch `AWS/Usage` remains the quota-corresponding historical observation:

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

The collector requests a 15-minute window at one-minute resolution. Empty telemetry is unknown, not zero; the newest datapoint must be no more than five minutes old.

Fresh CloudWatch data alone is not sufficient because a task, running instance, or quota-counting Capacity Reservation can become relevant after the newest metric sample. The collector therefore brackets both CloudWatch reads with direct read-only account inventory:

```text
direct ECS/EC2 inventory A
  -> Fargate AWS/Usage read
  -> EC2 AWS/Usage read
  -> direct ECS/EC2 inventory B
```

The two direct inventories must canonicalize to the same fingerprint. If they differ, the complete bracket is retried, up to three attempts. If no stable bracket is obtained, collection fails closed.

For the accepted bracket:

```text
effective Fargate usage
= max(recent CloudWatch maximum, direct ECS Fargate On-Demand inventory)

effective Standard EC2 usage
= max(recent CloudWatch maximum, direct Standard On-Demand quota inventory)
```

Admission then requires:

```text
applied Fargate On-Demand quota - effective Fargate usage >= 6 vCPU
applied Standard On-Demand quota - effective Standard EC2 usage >= 4 vCPU
```

The direct EC2 quota inventory counts only `running` non-Spot instances in the Standard A/C/D/H/I/M/R/T/Z family bucket; `pending`, `stopping`, `stopped`, and `hibernated` instances do not consume the On-Demand Instance vCPU quota. It also counts **owned** non-Capacity-Block Capacity Reservations in provider quota-counting states (`assessing`, `scheduled`, `pending`, `active`, or `delayed`), including unused reserved capacity. Running instances covered by one of those owned reservations remain in the evidence record but are not added again to the reservation's already-counted vCPU claim. Instance and reservation types are resolved read-only through `DescribeInstanceTypes` to their current `DefaultVCpus`. Capacity Blocks are excluded because AWS gives them a separate quota surface and instances in a Capacity Block do not count against On-Demand Instance limits.

Future-dated Capacity Reservations require one additional provider-state rule. AWS can expose a scheduled/future-dated reservation with `TotalInstanceCount == 0` before delivered capacity exists while `CommitmentInfo.CommittedInstanceCount` already represents committed capacity that counts against the owner's On-Demand quota. For every provider-documented quota-counting non-Capacity-Block reservation, the collector therefore uses:

```text
quotaInstanceCount
= max(TotalInstanceCount, CommitmentInfo.CommittedInstanceCount when present)

reservation quota vCPU
= quotaInstanceCount * DefaultVCpus(instance type)
```

When the committed count increases the effective quota count, the report retains the reservation ID/state, provider-reported total, committed count, and resulting quota count. A malformed negative committed count fails closed. This closes the future-dated reservation false-green case without changing the existing covered-instance de-duplication rule.

Shared Capacity Reservations are intentionally not modeled exactly in this first admission slice. A consumer account using capacity shared by another owner can therefore be treated conservatively as ordinary running On-Demand usage against the consumer's applied quota. That may cause a false-negative admission stop, but it cannot manufacture free headroom or create a false-positive admission pass. Exact shared-reservation accounting remains outside this initial no-create collector.

The direct Fargate inventory enumerates both `desiredStatus=RUNNING` and `desiredStatus=STOPPED`, deduplicates task ARNs, and retains On-Demand Fargate tasks while their `lastStatus` remains non-terminal (`PROVISIONING`, `PENDING`, `ACTIVATING`, `RUNNING`, `DEACTIVATING`, `STOPPING`, or `DEPROVISIONING`). `FARGATE_SPOT` and terminal `lastStatus=STOPPED` tasks are excluded. Task CPU is derived from the task or task definition. Because the Fargate quota can also be consumed by EKS and this first collector does not enumerate Kubernetes pods, the presence of any EKS cluster is a hard fail-closed collection condition rather than an assumption of zero non-ECS Fargate use.

This is still a point-in-time observation, not a capacity reservation. It closes the specific metric-lag false-pass where quota-consuming state existed before the final inventory but after the latest metric datapoint; it does not claim that a later account-state change cannot consume quota.

Official EC2 provider basis:

- <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-on-demand-instances.html>
- <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-capacity-reservations.html>
- <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/cr-concepts.html>
- <https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CapacityReservationCommitmentInfo.html>
- <https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeCapacityReservations.html>
- <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-capacity-blocks.html>

### 4.2 VPC security-group quota uses the documented regional scope

Current AWS VPC quota documentation names this adjustable quota **`VPC security groups per Region`**. The collector therefore combines the account-applied quota with a live read-only `DescribeSecurityGroups` count and requires:

```text
account-applied VPC security groups per Region
- current regional security-group count
>= 8 free security groups
```

A default-only quota entry is not accepted where the account-applied value is required. This is intentionally a regional headroom check; a fabricated `Security groups per VPC` quota is not accepted.

### 4.3 CodeBuild pre-create capability

R19 requires the selected protected-build environment to be usable in `eu-west-1`, not merely to have a nominal slot. The collector combines:

```text
1. account-applied Linux/Large concurrent-build quota >= 1
2. regional ListCuratedEnvironmentImages succeeds and returns >=1 Linux curated Docker image
3. frozen provider mapping remains LINUX_CONTAINER + BUILD_GENERAL1_LARGE
4. frozen CodeBuild VPC SG/subnet limits cover the reviewed shape
```

This remains a pre-create read-only capability proof. It is not proof that a future protected project has executed its private-VPC/Docker configuration; that stays post-create evidence.

### 4.4 ECS Express capability

ECS Express capability is checked by a real read-only `DescribeExpressGatewayService` call against a deliberately nonexistent service ARN. `ResourceNotFoundException` (or equivalent service/cluster-not-found response) proves that the regional API recognizes the operation. `UnsupportedFeatureException` is classified as regional unsupported. Access denial and unclassified errors fail closed.

### 4.5 Lambda concurrency coherence

Each Lambda snapshot attempt brackets the full function/reserved/provisioned inventory with `GetAccountSettings`. Account concurrency fields must be unchanged across the bracket, and two consecutive bracketed snapshots must have the same canonical fingerprint, including the function set. The collector allows at most three attempts.

The accepted observation retains every current function's reserved concurrency and each provisioned-concurrency configuration. The conservative provisioned claim is the maximum of requested, allocated, and available values. Provisioned concurrency on functions without reserved concurrency is deducted separately from effective unreserved capacity.

### 4.6 Controlled evidence publication is one atomic generation

The controlled evidence output is a **single self-verifying envelope**, not a report plus detached checksum sidecar:

```json
{
  "envelopeVersion": "1",
  "kind": "fpllm-controlled-evidence-envelope",
  "reportSha256": "<sha256 of canonical nested report payload>",
  "report": { "...": "..." }
}
```

The envelope is written to an owner-only (`0600`) temporary file, file contents are `fsync`ed, and one `os.replace()` publishes the generation. The parent directory is then `fsync`ed where supported. Temporary names contain a random nonce, so concurrent writers cannot collide on staging files.

There is deliberately **no detached `.sha256` file**. Therefore a crash or concurrent writer cannot leave a new report paired with an old checksum, or vice versa. Before the one atomic replace, readers see the prior complete envelope; after it, readers see the new complete envelope. Tests cover simulated replacement interruption and concurrent writers.

The report retains collector Git revision plus SHA-256/cleanliness evidence for both the stable entry point and reviewed core, AWS CLI version/executable SHA-256 for live collection, compute metric and direct-inventory evidence, Lambda snapshot-verification metadata, the exact incident DB identity/policy templates, and all admission checks.

---

## 5. Admission checks

The report must be green at minimum for the frozen P0 thresholds and the explicitly documented P1 safety margins:

| Surface | Admission requirement |
|---|---|
| Region | `eu-west-1` enabled |
| Fargate | account-applied On-Demand vCPU quota minus `max(fresh AWS/Usage maximum, stable direct ECS Fargate On-Demand inventory)` leaves **>=6 free vCPU**; direct inventory includes non-terminal On-Demand tasks even when `desiredStatus=STOPPED`; empty/stale telemetry or raced direct inventory fails closed; any EKS cluster fails closed until that consumption domain is explicitly supported |
| EC2 worker | account-applied Standard On-Demand vCPU quota minus `max(fresh AWS/Usage maximum, stable direct Standard On-Demand quota inventory)` leaves **>=4 free vCPU**; direct inventory counts running non-Spot Standard-family instances plus owned quota-counting On-Demand Capacity Reservations, including future-dated committed counts, without double-counting covered instances, and excludes Capacity Blocks/non-running instances; `m7i.xlarge` is offered in at least one selected RDS-capable AZ |
| Compute snapshot coherence | direct ECS/EC2 inventory before and after the metric reads must have the same fingerprint within three attempts |
| RDS exact selection | PostgreSQL 18.6 + `db.m8gd.large` + `gp3` orderable; VPC, encryption, storage autoscaling and IAM database authentication supported; 20 GiB initial / >=100 GiB max support |
| RDS AZ topology | at least two enabled AZs support the exact RDS configuration; one selected AZ also offers `m7i.xlarge` |
| RDS capacity | >=2 DB-instance slots and >=200 GiB headroom after existing instances' configured autoscaling ceilings |
| RDS backup/topology | >=2 free manual DB-snapshot slots; P0 DB-subnet-group hard limit admits two reviewed DB subnets |
| ALB/VPC | >=1 ALB and >=1 VPC headroom |
| Security groups | account-applied **VPC security groups per Region** minus current regional `DescribeSecurityGroups` count leaves **>=8 free** |
| ENI | >=32 free regional network-interface slots |
| CodeBuild | account-applied Linux/Large concurrency >=1; >=3 project headroom; regional curated Linux Docker capability; frozen `LINUX_CONTAINER + BUILD_GENERAL1_LARGE` mapping and VPC limits |
| Lambda snapshot coherence | bracket full allocation inventory with account concurrency reads; require two consecutive identical canonical snapshots within three attempts |
| Lambda inventory | enumerated reserved total must equal account `ConcurrentExecutions - UnreservedConcurrentExecutions`; disagreement fails closed |
| Lambda protected reservations | after deducting provisioned-only allocation, enough capacity remains for six one-unit protected reservations plus >=100 unreserved |
| DynamoDB | >=2 table headroom; initial beta remains PAY_PER_REQUEST |
| DynamoDB throughput semantics | P0 40k/40k initial per-table on-demand envelope remains provider baseline, not a fictitious account-level throughput quota |
| VPC endpoints | account quota/headroom and service availability cover required endpoint types |
| Private app/control subnets | reviewed `/24` CIDRs and >=32 usable IPv4 addresses each |
| Incident mediator | VPC attached, no NAT/Internet, DynamoDB gateway path, RDS TCP/5432 path |
| Incident DB authority | IAM DB auth selected for exact user `fpllm_incident_fence`; account/region-bound `rds-db:connect` ARN/policy template retained; created DBI resource ID/effective policy remain post-create proof |
| Incident DB budget | exactly one planned concurrent fence-only DB session; live RDS connection headroom remains post-create proof |

Any failed frozen minimum is a hard provisioning stop. A normal adjustable quota increase may be requested and the report re-run. A provider/class/region/topology substitution requires an explicit P0 amendment.

---

## 6. Read-only authority surface

The allowlist contains descriptive/list/get operations only. The compute-race and regional-SG corrections add only read operations:

```text
EC2:
  DescribeCapacityReservations
  DescribeInstances
  DescribeInstanceTypes
  DescribeSecurityGroups

ECS:
  ListClusters
  ListTasks
  DescribeTasks
  DescribeTaskDefinition

EKS:
  ListClusters
```

No `RunInstances`, `StartTask`, `RunTask`, `Create*`, `Update*`, `Delete*`, quota-request, reservation, or capacity mutation is permitted by the collector wrapper. Any operation not in the explicit allowlist raises `AdmissionError` before subprocess execution.

---

## 7. Evidence custody and verification

The complete live envelope may contain AWS account identity, inventory, ARNs, quota values, and topology observations. It is controlled operational evidence and must not be committed blindly to the public repository.

Verification of one envelope is deterministic:

```text
1. read envelope.report
2. canonicalize as sorted compact JSON plus trailing newline
3. SHA-256 those bytes
4. require result == envelope.reportSha256
```

Live collector provenance additionally retains:

```text
scriptPath / scriptSha256 / scriptWorkingTreeClean
  = scripts/ops/p1_readonly_admission.py

coreScriptPath / coreScriptSha256 / coreScriptWorkingTreeClean
  = scripts/ops/p1_readonly_admission_core.py
```

Both source files are bound to the same `gitCommit`; either tracked file being dirty is a hard live-evidence failure. This prevents the small provider-accounting entry point from changing live semantics while the evidence proves only the underlying core.

A fixture-generated envelope can prove collector behavior only. Only `evidenceSource=live-aws` plus a green report may set `liveAdmissionPassed=true`, and even then resource-creation authority remains false until the separate maintainer and cost gates are satisfied.

---

## 8. Post-create evidence still required

A green pre-create report does not prove realized resources. P1 must later retain evidence for at least:

```text
RDS IAM database authentication enabled on the created primary
exact DBI resource ID substituted into the rds-db:connect ARN/effective policy
live RDS max_connections/headroom including <=1 incident-mediator session
actual subnet available-IP counts and Lambda/CodeBuild ENI attachment
actual endpoint policies and route-table associations
DynamoDB PAY_PER_REQUEST plus realized maximum-throughput configuration
protected CodeBuild projects executing the frozen private-VPC/Docker configuration
backup/restore and rollback drills
```

---

## 9. Current P1 stopping point

This PR remains a **pre-provision admission slice**. It may be merged only after exact-head CI, fresh exhaustive maintainer exact-head review, fresh independent exact-head second opinion, actionable-thread disposition, and final exact-head checks.

After merge, the next operational action is still not unconditional provisioning. The next action is to execute the collector under an attributable short-lived read-only/federated production-account identity, retain the controlled envelope, perform maintainer disposition, and refresh the exact-topology cost estimate under the USD 900/month stop/review threshold.
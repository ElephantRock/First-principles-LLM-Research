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

This PR implements only the first P1 action: the P0-frozen **read-only, no-create quota/availability/topology admission report**. It does not claim that production AWS resources have been created or that P1 has passed.

Provisioning remains blocked until all of the following are true:

```text
live no-create admission report is green
+ controlled live evidence is dispositioned by the maintainer
+ fresh exact-topology cost estimate remains below the USD 900/month stop/review threshold
```

Repository CI validates collector behavior with fixtures and mocked read-only provider responses only. CI is not production-account evidence. Even a green live report retains:

```text
productionResourceCreationAuthorizedByThisReport = false
```

---

## 1. Frozen P0 inputs carried into P1

The implementation preserves the corrected P0 baseline:

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

When an earlier parent record conflicts with a later maintainer correction, the correction precedence chain governs.

---

## 2. Pre-create topology plan

The nominal production VPC remains `10.42.0.0/16`. P1 selects six non-overlapping `/24` subnets:

```text
public-a:              10.42.0.0/24
public-b:              10.42.1.0/24
private-app-control-a: 10.42.16.0/24
private-app-control-b: 10.42.17.0/24
private-db-a:          10.42.32.0/24
private-db-b:          10.42.33.0/24
```

Availability Zone names are not hard-coded. Admission requires at least two enabled AZs supporting the exact RDS shape, with `m7i.xlarge` available in at least one selected AZ. The private application/control subnets each exceed the conservative pre-create margin of 32 usable IPv4 addresses. No NAT gateway is selected for the initial beta.

Required private service paths are:

```text
interface endpoints:
  ECR API
  ECR DKR
  CloudWatch Logs

optional interface endpoint:
  KMS — only if a direct KMS API dependency is explicitly selected

gateway endpoints:
  S3
  DynamoDB
```

The incident mediator reaches protected DynamoDB state through the DynamoDB gateway endpoint and the exact production RDS primary over TCP/5432. It has no selected Internet/NAT path.

---

## 3. Read-only admission collector

Repository entry point:

```text
scripts/ops/p1_readonly_admission.py
```

Representative live invocation under a short-lived read-only/federated identity:

```bash
python scripts/ops/p1_readonly_admission.py \
  --region eu-west-1 \
  --private-subnet-cidr 10.42.16.0/24 \
  --private-subnet-cidr 10.42.17.0/24 \
  --output .artifacts/p1/aws-readonly-admission.json
```

If the implementation explicitly selects a KMS interface endpoint, add `--require-kms-interface-endpoint`.

The collector has an explicit descriptive/list/get operation allowlist. It performs no create, update, delete, start, stop, reservation, capacity mutation, or quota-change operation. Adjustable quota checks that can stop provisioning require an account-applied value and refuse to substitute an AWS default.

The report retains collector Git revision/script SHA-256, AWS CLI v2 version/resolved executable SHA-256 for live collection, exact account identity, all observations/checks, the planned incident DB authority templates, and the evidence boundary.

---

## 4. Compute-vCPU admission: metric plus direct inventory

Fargate and EC2 admission is based on **remaining headroom**, not nominal quota.

CloudWatch `AWS/Usage` supplies the recent quota-corresponding historical observation:

```text
Fargate: Service=Fargate, Type=Resource, Resource=vCPU, Class=Standard/OnDemand
EC2:     Service=EC2,     Type=Resource, Resource=vCPU, Class=Standard/OnDemand
```

The collector requests a 15-minute window at one-minute resolution. Empty telemetry is unknown, not zero, and the newest datapoint must be no older than five minutes.

CloudWatch alone is insufficient because provider state can change after the latest metric sample. The collector therefore brackets both metric reads with direct account inventory:

```text
direct ECS/EC2 inventory A
  -> Fargate AWS/Usage read
  -> EC2 AWS/Usage read
  -> direct ECS/EC2 inventory B
```

The two direct inventories must canonicalize to the same fingerprint. A changed inventory retries the complete bracket, up to three attempts; failure to stabilize is a hard collection failure.

For an accepted bracket:

```text
effective Fargate usage
= max(recent CloudWatch maximum, stable direct Fargate quota inventory)

effective Standard EC2 usage
= max(recent CloudWatch maximum, stable direct Standard On-Demand quota inventory)
```

Admission requires at least 6 free Fargate On-Demand vCPU and 4 free Standard On-Demand EC2 vCPU after subtracting those effective observations from the exact account-applied quotas.

### 4.1 EC2 Standard On-Demand direct inventory

AWS documents the Standard On-Demand quota as a running-instance vCPU quota for the A/C/D/H/I/M/R/T/Z family bucket. Instances in `pending`, `stopping`, `stopped`, and `hibernated` do not consume that quota. AWS also documents that On-Demand Capacity Reservations in `assessing`, `scheduled`, `pending`, `active`, and `delayed` states consume the owner's On-Demand quota, including unused reserved capacity.

The collector therefore combines:

```text
owned quota-counting On-Demand Capacity Reservations
+ running non-Spot Standard-family instances not already covered by those reservations
```

Each observed instance/reservation type is resolved to its current `DefaultVCpus`. A running instance covered by an owned quota-counting Capacity Reservation is retained in evidence but is not added again to the reservation's already-counted vCPU claim. Capacity Blocks are excluded because AWS gives them a separate quota surface and documents that instances in a Capacity Block do not count against On-Demand Instance limits.

Provider basis:

- <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-on-demand-instances.html>
- <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-capacity-reservations.html>
- <https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeCapacityReservations.html>
- <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-capacity-blocks.html>

### 4.2 Fargate direct inventory

The ECS direct inventory enumerates both desired-status domains that can expose relevant lifecycle state:

```text
desired RUNNING
desired STOPPED
```

Task ARNs are deduplicated and described. On-Demand Fargate tasks are retained while `lastStatus` is non-terminal, including `PROVISIONING`, `PENDING`, `ACTIVATING`, `RUNNING`, `DEACTIVATING`, `STOPPING`, and `DEPROVISIONING`. `FARGATE_SPOT` is excluded. A task with `desiredStatus=STOPPED` can therefore still count while its `lastStatus` remains non-terminal; terminal `STOPPED` tasks do not count.

Because the same Fargate On-Demand quota can also be consumed through EKS and this initial collector does not enumerate Kubernetes pod-level Fargate consumption, the presence of any EKS cluster fails closed rather than assuming zero non-ECS usage.

Provider basis:

- <https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ListTasks.html>
- <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html>

This compute evidence remains point-in-time admission evidence, not a reservation of future quota.

---

## 5. Other admission surfaces

The report must also remain green for the following frozen thresholds and P1 safety checks:

| Surface | Admission requirement |
|---|---|
| Region | `eu-west-1` enabled |
| RDS exact selection | PostgreSQL 18.6 + `db.m8gd.large` + `gp3`; VPC, encryption, storage autoscaling and IAM DB auth supported; 20 GiB initial / >=100 GiB max support |
| RDS AZ topology | >=2 enabled RDS-capable AZs; one selected AZ also offers `m7i.xlarge` |
| RDS capacity | >=2 DB-instance slots and >=200 GiB headroom after existing configured autoscaling ceilings |
| RDS backup/topology | >=2 free manual snapshot slots; P0 DB-subnet-group hard limit covers two DB subnets |
| ALB/VPC | >=1 ALB and >=1 VPC headroom |
| Security groups | account-applied `VPC security groups per Region` minus current `DescribeSecurityGroups` inventory leaves >=8 free |
| ENI | >=32 free regional network-interface slots |
| CodeBuild | account-applied Linux/Large concurrency >=1; >=3 project headroom; successful regional curated Linux Docker read; frozen `LINUX_CONTAINER + BUILD_GENERAL1_LARGE` mapping/VPC limits |
| Lambda snapshot coherence | bracket full allocation inventory with account concurrency reads; require two consecutive identical canonical snapshots within three attempts |
| Lambda inventory | enumerated reserved total must equal account `ConcurrentExecutions - UnreservedConcurrentExecutions`; disagreement fails closed |
| Lambda protected reservations | after existing provisioned-only allocation, enough capacity remains for six one-unit protected reservations plus >=100 unreserved |
| DynamoDB | >=2 table headroom; initial beta remains PAY_PER_REQUEST |
| VPC endpoints | required quota/headroom and regional service availability |
| Private app/control subnets | reviewed `/24` CIDRs and >=32 usable IPv4 addresses each |
| ECS Express | a real regional read-only `DescribeExpressGatewayService` probe is recognized; unsupported/unclassified/access-denied results fail closed |
| Incident mediator | VPC-attached, no NAT/Internet selected, DynamoDB gateway path, exact RDS TCP/5432 path |
| Incident DB authority | IAM DB auth for exact user `fpllm_incident_fence`; account/region-bound `rds-db:connect` ARN and allow-policy template retained |
| Incident DB budget | exactly one planned concurrent fence-only session; live `max_connections` headroom remains post-create proof |

AWS currently documents `VPC security groups per Region` as an adjustable regional quota, so the collector treats it as a regional headroom surface and subtracts current regional security-group inventory.

Provider basis: <https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html>

Any failed frozen minimum is a hard provisioning stop. An ordinary adjustable quota increase may be requested and the report rerun. A provider/class/region/topology substitution requires an explicit P0 amendment.

---

## 6. Controlled evidence publication

The controlled output is one self-verifying envelope:

```json
{
  "envelopeVersion": "1",
  "kind": "fpllm-controlled-evidence-envelope",
  "reportSha256": "<sha256 of canonical nested report payload>",
  "report": { "...": "..." }
}
```

The envelope is written to an owner-only (`0600`) temporary file, file contents are `fsync`ed, and one `os.replace()` publishes the new generation. The parent directory is then `fsync`ed where supported. Temporary names contain a random nonce.

There is deliberately no detached `.sha256` sidecar. A crash or concurrent writer therefore cannot pair a report from one generation with the checksum of another generation. Regression tests cover interrupted replacement and concurrent writers.

Verification is deterministic: canonicalize `envelope.report` as sorted compact JSON plus one trailing newline, SHA-256 those bytes, and require equality with `envelope.reportSha256`.

The live envelope can contain account identity, inventory, ARNs, quota values and topology observations. It is controlled operational evidence and must not be committed blindly to a public repository.

---

## 7. Post-create evidence still required

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

## 8. Current stopping point

This PR remains a **pre-provision admission slice**. It may be merged only after:

```text
exact-head CI
-> fresh exhaustive maintainer exact-head review
-> fresh independent exact-head second opinion
   (Codex when available; quota-fallback independent review otherwise)
-> actionable-thread disposition
-> final exact-head checks
-> squash merge
```

After merge, the next operational action is still not unconditional provisioning. The collector must first be run under an attributable short-lived read-only/federated production-account identity, the resulting controlled envelope must be dispositioned by the maintainer, and the exact-topology cost estimate must be refreshed under the USD 900/month stop/review threshold.

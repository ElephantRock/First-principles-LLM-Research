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

Repository CI validates the collector with fixtures only. CI is not production-account evidence and a fixture result can never be classified as a live admission pass.

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

The collector has an explicit read-only AWS-operation allowlist. It gathers account identity, account-applied adjustable quotas, current regional consumption, exact RDS orderability/capability, regional VPC endpoint-service availability, Lambda account concurrency, and the AZ/topology information needed by the reviewed plan. It performs no create/update/delete operation.

For adjustable account quotas that can stop provisioning, the collector requires an account-applied value and refuses to substitute the provider default when Service Quotas does not expose one. Non-adjustable hard limits already frozen in P0 are evaluated as provider constraints against the reviewed topology instead of being misrepresented as account-applied values.

ECS Express capability is checked by a real read-only `DescribeExpressGatewayService` call against a deliberately nonexistent service ARN. A recognized service/cluster-not-found response proves that the regional API understands the operation; a local CLI command model alone is not accepted as regional evidence.

The collector records:

- `evidenceSource=fixture` or `evidenceSource=live-aws`;
- the committed collector revision and script SHA-256;
- AWS CLI v2 version, resolved executable path, and executable SHA-256 for live collection;
- the exact incident-database user and account/region-bound `rds-db:connect` ARN template with only the future DBI resource ID left as a placeholder;
- a SHA-256 companion for the complete controlled report.

Only a live report may set `liveAdmissionPassed=true`. Even a green live report leaves `productionResourceCreationAuthorizedByThisReport=false` because the cost and maintainer-evidence gates remain separate requirements.

The complete report and its digest companion are written atomically with owner-only (`0600`) permissions on POSIX systems.

---

## 5. Admission checks

The report must be green at minimum for the frozen P0 thresholds and the explicitly documented P1 safety margins:

| Surface | Admission requirement |
|---|---|
| Region | `eu-west-1` enabled |
| Fargate | account-applied On-Demand vCPU quota >= 6 |
| EC2 worker | account-applied Standard On-Demand vCPU quota >= 4; `m7i.xlarge` offered in at least one selected RDS-capable AZ |
| RDS exact selection | PostgreSQL 18.6 + `db.m8gd.large` + `gp3` orderable; VPC, encryption, storage autoscaling and IAM DB authentication supported; 20 GiB initial / >=100 GiB max support |
| RDS AZ topology | at least two enabled AZs support the exact RDS configuration; one of the selected AZs also offers `m7i.xlarge` |
| RDS capacity | >=2 DB-instance slots and >=200 GiB headroom after existing instances' configured autoscaling ceilings |
| RDS backup/topology | >=2 free manual DB-snapshot slots; P0-recorded DB subnet-group hard limit permits the two reviewed DB subnets |
| ALB/VPC | >=1 ALB and >=1 VPC headroom |
| Network safety margin | >=8 free regional security groups and >=32 free regional ENI slots before create |
| CodeBuild | account-applied Linux/Large concurrency >=1; >=3 project headroom; P0-recorded non-adjustable VPC limits cover one build SG and two private app/control subnets |
| Lambda | enough currently unreserved concurrency to reserve six one-unit protected functions while preserving >=100 unreserved |
| DynamoDB | >=2 table headroom; initial beta remains PAY_PER_REQUEST |
| DynamoDB throughput semantics | P0's 40k/40k initial per-table on-demand envelope is a provider baseline, not a fictitious account-level on-demand throughput quota; the created tables' explicit maximum-throughput configuration is verified post-create |
| VPC endpoints | account quota plus current gateway-endpoint headroom and service availability for required endpoint types |
| Private app/control subnets | reviewed `/24` CIDRs and >=32 usable IPv4 addresses each as a conservative P1 margin |
| Incident mediator | VPC attachment shape fits Lambda limits, no NAT/Internet egress is selected, DynamoDB gateway access is planned, and RDS path is TCP/5432 |
| Incident DB authority | IAM DB authentication selected for exact user `fpllm_incident_fence`; report binds `arn:aws:rds-db:eu-west-1:<account>:dbuser:<DBI_RESOURCE_ID>/fpllm_incident_fence`; created DBI resource ID/effective policy remain post-create proof |
| Incident DB budget | exact planned maximum of one concurrent `fpllm_incident_fence` session; live RDS `max_connections`/headroom proof remains required post-create before incident use |

Any failed frozen minimum is a hard provisioning stop. A normal adjustable quota increase may be requested and the report re-run. A provider/class/region/topology substitution requires an explicit P0 amendment.

---

## 6. DynamoDB on-demand boundary

The initial protected release-control tables remain DynamoDB `PAY_PER_REQUEST`. The P0 record captured AWS's initial 40,000 read-request-unit and 40,000 write-request-unit per-table on-demand envelope.

AWS does not apply an account-level read/write throughput quota to on-demand tables. Therefore the pre-create collector must not invent an account-level throughput value merely to make the report look more comprehensive. Before the tables exist, the collector proves table-count headroom and retains the frozen provider baseline. After creation, P1 must prove the exact tables are `PAY_PER_REQUEST` and that no configured table-level maximum is below the bounded release-control requirement.

---

## 7. Evidence handling

The complete admission JSON contains AWS account identity and current infrastructure inventory. It is controlled operational evidence and must not be blindly committed to this public repository.

The public P1/release record may retain a redacted summary plus the report SHA-256. No secret value or credential is written by the collector.

A green fixture run or repository CI run proves only collector behavior. The live admission condition becomes green only after the collector runs against the intended AWS account under an attributable read-only identity and the retained live report passes. Resource creation remains blocked until the fresh exact-topology cost estimate and maintainer evidence disposition also pass.

---

## 8. What remains after pre-create admission

A green live no-create report is one required input to the next P1 implementation slice; it does not independently authorize provisioning and does not complete P1. Subsequent evidence must include, at minimum:

1. fresh exact-topology cost evidence below the USD 900/month stop/review threshold before creation;
2. clean infrastructure provisioning from committed IaC after the complete pre-create gate is green;
3. production migrations with the frozen expand-compatible discipline;
4. exact IAM, ECR, CodeBuild, Lambda, DynamoDB, VPC endpoint, security-group and database-role negative-authority proofs;
5. RDS IAM authentication enabled on the created primary and exact `rds-db:connect` identity/effective policy after replacing the DBI resource ID placeholder;
6. live RDS connection headroom, including the <=1 incident-mediator session budget;
7. real subnet available-IP/ENI capacity and VPC attachment evidence;
8. realized DynamoDB `PAY_PER_REQUEST` configuration and table-level maximum-throughput evidence;
9. migration, backup/PITR, restore-to-clean-target and rollback runbooks/drills;
10. retained production evidence separating design intent from verified state.

Only after those requirements and the governing P1 acceptance evidence are satisfied may P1 be marked complete.

---

## 9. Current state

```text
P0: CLOSED and merged at fc46a2843ac79cef23b82b08cc08dba5a1a1b095
P1 admission collector: implementation/review in progress
live AWS read-only admission report: NOT YET RUN / NOT YET VERIFIED
fresh exact-topology cost estimate: NOT YET VERIFIED
AWS production resources created by this P1 slice: NONE
P1 gate: OPEN
```

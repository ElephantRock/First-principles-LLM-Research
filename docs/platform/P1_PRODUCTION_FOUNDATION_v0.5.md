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

The first P1 action remains the P0-frozen **read-only, no-create quota/availability/topology admission report**. Provisioning is forbidden until that report is green against the exact selected architecture and the fresh exact-topology cost estimate remains below the existing USD 900/month stop/review threshold.

Repository CI validates the collector itself with fixtures only. CI is not production account evidence.

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

The actual two Availability Zone names are **not hard-coded**. The admission report selects the first two common enabled AZs in which both `m7i.xlarge` and the exact selected RDS configuration are available. If fewer than two common AZs are observed, provisioning stops.

The `/24` private application/control subnets deliberately exceed the collector's conservative pre-create margin of 32 usable IPv4 addresses per subnet. That 32-address threshold is a P1 implementation safety margin, not a new P0 provider contract.

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

The collector has an explicit read-only AWS-operation allowlist. It gathers account identity, applied/default quotas, current regional consumption, selected service availability/orderability, regional endpoint-service availability, Lambda account concurrency state, and the common-AZ intersection needed by the planned topology. It performs no resource-create/update/delete operation.

The collector fails closed when a required quota cannot be resolved uniquely or an AWS read fails.

---

## 5. Admission checks

The report must be green at minimum for the frozen P0 thresholds:

| Surface | Admission requirement |
|---|---|
| Region | `eu-west-1` enabled |
| Fargate | applied On-Demand vCPU quota >= 6 |
| EC2 worker | Standard On-Demand vCPU quota >= 4; `m7i.xlarge` offered in >=2 common selected AZs |
| RDS | exact PostgreSQL 18.6 + `db.m8gd.large` + `gp3` orderable; VPC, encryption, storage autoscaling and IAM DB authentication supported; 20 GiB initial / >=100 GiB max support |
| RDS capacity | >=2 DB-instance slots and >=200 GiB storage headroom for production + restore target |
| ALB/VPC | >=1 ALB and >=1 VPC headroom |
| CodeBuild | Linux/Large concurrency >=1; >=3 project headroom |
| Lambda | enough currently unreserved concurrency to reserve six one-unit protected functions while preserving >=100 unreserved |
| DynamoDB | >=2 table headroom |
| VPC endpoints | quota and service availability for the required interface/gateway endpoints |
| Private app/control subnets | >=32 usable IPv4 addresses each as a conservative P1 margin |
| Incident DB budget | topology permits at most one concurrent `fpllm_incident_fence` mediator session; live RDS connection-headroom proof is still required post-create before incident use |

The collector also applies conservative P1 headroom checks for regional security groups and network interfaces. Those margins are implementation safety checks and do not silently amend P0.

Any failed frozen minimum is a hard provisioning stop. A normal adjustable quota increase may be requested and the report re-run. A provider/class/region/topology substitution requires an explicit P0 amendment.

---

## 6. Evidence handling

The complete admission JSON contains AWS account identity and current infrastructure inventory. It should be retained as controlled operational evidence, not blindly committed to this public repository.

The public P1/release record may retain a redacted summary plus a cryptographic digest of the controlled report. No secret value or credential is written by the collector.

A green fixture run or repository CI run proves only collector behavior. The P1 pre-create gate becomes green only after the collector runs against the intended AWS account under an attributable read-only identity and the retained live report passes.

---

## 7. What remains after pre-create admission

A green no-create report authorizes the next P1 implementation slice; it does not complete P1. Subsequent evidence must include, at minimum:

1. clean infrastructure provisioning from committed IaC;
2. production migrations with the frozen expand-compatible discipline;
3. exact IAM, ECR, CodeBuild, Lambda, DynamoDB, VPC endpoint, security-group and database-role negative-authority proofs;
4. RDS IAM authentication enabled on the created primary and exact `rds-db:connect` identity/effective policy;
5. live RDS connection headroom, including the <=1 incident-mediator session budget;
6. real subnet/ENI/IP capacity and VPC attachment evidence;
7. migration, backup/PITR, restore-to-clean-target and rollback runbooks/drills;
8. retained production evidence separating design intent from verified state;
9. a fresh exact-topology cost estimate with the USD 900/month stop/review threshold enforced.

Only after those requirements and the governing P1 acceptance evidence are satisfied may P1 be marked complete.

---

## 8. Current state

```text
P0: CLOSED and merged at fc46a2843ac79cef23b82b08cc08dba5a1a1b095
P1 admission collector: implementation in progress
live AWS read-only admission report: NOT YET RUN / NOT YET VERIFIED
AWS production resources created by this P1 slice: NONE
P1 gate: OPEN
```

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

REGION = "eu-west-1"
SCHEMA_VERSION = "1"
VPC_CIDR = "10.42.0.0/16"
PLANNED_PUBLIC_CIDRS = ("10.42.0.0/24", "10.42.1.0/24")
PLANNED_PRIVATE_CONTROL_CIDRS = ("10.42.16.0/24", "10.42.17.0/24")
PLANNED_PRIVATE_DB_CIDRS = ("10.42.32.0/24", "10.42.33.0/24")
PLANNED_SUBNET_CIDRS = PLANNED_PUBLIC_CIDRS + PLANNED_PRIVATE_CONTROL_CIDRS + PLANNED_PRIVATE_DB_CIDRS

PROTECTED_LAMBDA_COUNT = 6
INCIDENT_DB_USER = "fpllm_incident_fence"
INCIDENT_MEDIATOR_MAX_DB_SESSIONS = 1

MIN_SECURITY_GROUP_HEADROOM = 8
MIN_ENI_HEADROOM = 32
MIN_PRIVATE_CONTROL_USABLE_IPV4 = 32
MIN_RDS_MANUAL_SNAPSHOT_HEADROOM = 2

# Frozen provider/hard-limit values recorded by the P0 decision chain.
CODEBUILD_VPC_SECURITY_GROUP_LIMIT = 5
CODEBUILD_VPC_SUBNET_LIMIT = 16
RDS_DB_SUBNET_GROUP_SUBNET_LIMIT = 20
ECS_SERVICES_PER_CLUSTER_LIMIT = 5000
ECS_TASKS_PER_SERVICE_LIMIT = 5000
ECS_AWSVPC_SECURITY_GROUP_LIMIT = 5
ECS_AWSVPC_SUBNET_LIMIT = 16
LAMBDA_VPC_SECURITY_GROUP_LIMIT = 5
LAMBDA_VPC_SUBNET_LIMIT = 16
DYNAMODB_ON_DEMAND_TABLE_READ_WRITE_DEFAULT = 40000

READ_ONLY_AWS_OPERATIONS = {
    ("sts", "get-caller-identity"),
    ("ec2", "describe-regions"),
    ("ec2", "describe-availability-zones"),
    ("ec2", "describe-instance-type-offerings"),
    ("ec2", "describe-vpcs"),
    ("ec2", "describe-network-interfaces"),
    ("ec2", "describe-security-groups"),
    ("ec2", "describe-vpc-endpoints"),
    ("ec2", "describe-vpc-endpoint-services"),
    ("elbv2", "describe-load-balancers"),
    ("service-quotas", "list-service-quotas"),
    ("service-quotas", "list-aws-default-service-quotas"),
    ("rds", "describe-orderable-db-instance-options"),
    ("rds", "describe-db-instances"),
    ("rds", "describe-db-snapshots"),
    ("codebuild", "list-projects"),
    ("lambda", "get-account-settings"),
    ("dynamodb", "list-tables"),
    ("ecs", "describe-express-gateway-service"),
}


class AdmissionError(RuntimeError):
    pass


@dataclass(frozen=True)
class Check:
    id: str
    status: str
    observed: Any
    required: Any
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status,
            "observed": self.observed,
            "required": self.required,
            "detail": self.detail,
        }


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def quota_entry(
    quotas: Iterable[dict[str, Any]],
    *names_or_substrings: str,
    require_applied: bool = False,
) -> dict[str, Any]:
    needles = tuple(normalize_name(item) for item in names_or_substrings)
    exact = [q for q in quotas if normalize_name(str(q.get("QuotaName", ""))) in needles]
    matches = exact
    if not matches:
        matches = []
        for quota in quotas:
            name = normalize_name(str(quota.get("QuotaName", "")))
            if any(needle in name for needle in needles):
                matches.append(quota)
    if len(matches) != 1:
        found = sorted(str(item.get("QuotaName")) for item in matches)
        raise AdmissionError(f"quota lookup ambiguous/missing for {names_or_substrings!r}: {found}")
    match = matches[0]
    value = match.get("Value")
    if not isinstance(value, (int, float)):
        raise AdmissionError(f"quota value is not numeric for {match.get('QuotaName')!r}: {value!r}")
    if require_applied and match.get("fpllmValueSource") != "applied":
        raise AdmissionError(
            "account-applied quota is unavailable; refusing to substitute the AWS default "
            f"for {match.get('QuotaName')!r}"
        )
    return match


def quota_value(
    quotas: Iterable[dict[str, Any]],
    *names_or_substrings: str,
    require_applied: bool = False,
) -> float:
    return float(quota_entry(quotas, *names_or_substrings, require_applied=require_applied)["Value"])


def count_list(doc: dict[str, Any], key: str) -> int:
    value = doc.get(key)
    if not isinstance(value, list):
        raise AdmissionError(f"expected list at {key}")
    return len(value)


def usable_ipv4(cidr: str) -> int:
    network = ipaddress.ip_network(cidr, strict=True)
    if network.version != 4:
        raise AdmissionError(f"subnet must be IPv4: {cidr}")
    return max(0, network.num_addresses - 5)


def validate_topology(private_subnet_cidrs: list[str]) -> dict[str, int]:
    if tuple(sorted(private_subnet_cidrs)) != tuple(sorted(PLANNED_PRIVATE_CONTROL_CIDRS)):
        raise AdmissionError(
            "private application/control CIDRs must match the reviewed P1 topology: "
            f"{PLANNED_PRIVATE_CONTROL_CIDRS!r}"
        )
    vpc = ipaddress.ip_network(VPC_CIDR, strict=True)
    planned = [ipaddress.ip_network(cidr, strict=True) for cidr in PLANNED_SUBNET_CIDRS]
    for subnet in planned:
        if subnet.version != 4 or not subnet.subnet_of(vpc):
            raise AdmissionError(f"planned subnet is outside {VPC_CIDR}: {subnet}")
    for index, left in enumerate(planned):
        for right in planned[index + 1 :]:
            if left.overlaps(right):
                raise AdmissionError(f"planned subnets overlap: {left} and {right}")
    return {cidr: usable_ipv4(cidr) for cidr in private_subnet_cidrs}


def rds_db_connect_resource_template(account: str) -> str:
    if not re.fullmatch(r"\d{12}", account):
        raise AdmissionError(f"AWS account ID is not a 12-digit value: {account!r}")
    return f"arn:aws:rds-db:{REGION}:{account}:dbuser:<DBI_RESOURCE_ID>/{INCIDENT_DB_USER}"


def planned_topology(account: str) -> dict[str, Any]:
    return {
        "vpcCidr": VPC_CIDR,
        "publicSubnetCidrs": list(PLANNED_PUBLIC_CIDRS),
        "privateApplicationControlSubnetCidrs": list(PLANNED_PRIVATE_CONTROL_CIDRS),
        "privateDbSubnetCidrs": list(PLANNED_PRIVATE_DB_CIDRS),
        "natGatewaySelected": False,
        "web": {"services": 1, "maxTasks": 2, "securityGroups": 1, "subnets": 2},
        "incidentMediator": {
            "vpcAttached": True,
            "subnets": 2,
            "securityGroups": 1,
            "rdsPort": 5432,
            "internetNatEgress": False,
            "dynamodbGatewayEndpoint": True,
            "rdsIamDatabaseAuthentication": True,
            "dbUser": INCIDENT_DB_USER,
            "maxConcurrentDbSessions": INCIDENT_MEDIATOR_MAX_DB_SESSIONS,
            "rdsDbConnectResourceTemplate": rds_db_connect_resource_template(account),
        },
    }


def _select_azs(enabled: set[str], rds_azs: set[str], worker_azs: set[str]) -> tuple[list[str], list[str]]:
    rds_enabled = sorted(enabled & rds_azs)
    worker_enabled = sorted(enabled & worker_azs)
    if len(rds_enabled) < 2:
        return [], worker_enabled
    worker_in_rds = [az for az in rds_enabled if az in worker_azs]
    if not worker_in_rds:
        return [], worker_enabled
    first = worker_in_rds[0]
    second = next(az for az in rds_enabled if az != first)
    return [first, second], worker_enabled


def evaluate(
    observed: dict[str, Any],
    private_subnet_cidrs: list[str],
    require_kms_endpoint: bool,
) -> tuple[list[Check], dict[str, Any]]:
    subnet_capacity = validate_topology(private_subnet_cidrs)
    identity = observed.get("identity") or {}
    account = identity.get("Account")
    if not isinstance(account, str):
        raise AdmissionError("caller identity is missing an AWS account ID")
    topology = planned_topology(account)
    region = observed.get("region") or {}
    quotas = observed.get("quotas") or {}
    usage = observed.get("usage") or {}
    lambda_settings = observed.get("lambdaAccountSettings") or {}
    enabled_azs = set(observed.get("enabledAvailabilityZones") or [])
    worker_offerings = set(observed.get("m7iOfferings") or [])
    rds_options = observed.get("rdsOrderableOptions") or []
    endpoint_services = set(observed.get("endpointServices") or [])

    checks: list[Check] = []

    def add(check_id: str, ok: bool, observed_value: Any, required: Any, detail: str) -> None:
        checks.append(Check(check_id, "PASS" if ok else "FAIL", observed_value, required, detail))

    add(
        "identity.account",
        bool(re.fullmatch(r"\d{12}", account)),
        account,
        "12-digit AWS account ID",
        "Caller identity must be attributable and usable in exact IAM resource construction.",
    )
    add(
        "region.eu-west-1-enabled",
        region.get("RegionName") == REGION
        and region.get("OptInStatus") in {"opt-in-not-required", "opted-in"},
        region,
        {"region": REGION, "optInStatus": ["opt-in-not-required", "opted-in"]},
        "Production region is frozen to Europe (Ireland).",
    )

    def applied(service: str, *names: str) -> float:
        return quota_value(quotas[service], *names, require_applied=True)

    fargate = applied("fargate", "Fargate On-Demand vCPU resource count")
    add("quota.fargate-ondemand-vcpu", fargate >= 6, fargate, ">= 6 applied vCPU", "Frozen Fargate admission minimum.")

    ec2 = applied("ec2", "Running On-Demand Standard")
    add("quota.ec2-standard-ondemand-vcpu", ec2 >= 4, ec2, ">= 4 applied vCPU", "One m7i.xlarge requires four Standard On-Demand vCPUs.")

    alb_quota = applied("elasticloadbalancing", "Application Load Balancers per Region")
    alb_count = int(usage.get("applicationLoadBalancers", -1))
    add("quota.alb-headroom", alb_count >= 0 and alb_quota - alb_count >= 1, {"quota": alb_quota, "current": alb_count}, ">= 1 free ALB", "ECS Express requires one ALB.")

    vpc_quota = applied("vpc", "VPCs per Region")
    vpc_count = int(usage.get("vpcs", -1))
    add("quota.vpc-headroom", vpc_count >= 0 and vpc_quota - vpc_count >= 1, {"quota": vpc_quota, "current": vpc_count}, ">= 1 free VPC", "P1 provisions one production VPC.")

    subnet_quota = applied("vpc", "Subnets per VPC")
    add("quota.subnets-per-vpc", subnet_quota >= len(PLANNED_SUBNET_CIDRS), subnet_quota, f">= {len(PLANNED_SUBNET_CIDRS)}", "Reviewed P1 topology uses six subnets.")

    sg_quota = applied("vpc", "VPC security groups per Region")
    sg_count = int(usage.get("securityGroups", -1))
    add("quota.security-group-headroom", sg_count >= 0 and sg_quota - sg_count >= MIN_SECURITY_GROUP_HEADROOM, {"quota": sg_quota, "current": sg_count}, f">= {MIN_SECURITY_GROUP_HEADROOM} free", "Conservative P1 security-group margin.")

    eni_quota = applied("vpc", "Network interfaces per Region")
    eni_count = int(usage.get("networkInterfaces", -1))
    add("quota.network-interface-headroom", eni_count >= 0 and eni_quota - eni_count >= MIN_ENI_HEADROOM, {"quota": eni_quota, "current": eni_count}, f">= {MIN_ENI_HEADROOM} free", "Conservative P1 ENI margin.")

    interface_quota = applied("vpc", "Interface VPC endpoints per VPC")
    interface_required = 4 if require_kms_endpoint else 3
    add("quota.interface-vpc-endpoints", interface_quota >= interface_required, interface_quota, f">= {interface_required} per VPC", "Sensitive build requires ECR API, ECR DKR and Logs; KMS is optional.")

    gateway_quota = applied("vpc", "Gateway VPC endpoints per Region")
    gateway_count = int(usage.get("gatewayVpcEndpoints", -1))
    add("quota.gateway-vpc-endpoint-headroom", gateway_count >= 0 and gateway_quota - gateway_count >= 2, {"quota": gateway_quota, "current": gateway_count}, ">= 2 free", "S3 and DynamoDB gateway endpoints are required.")

    codebuild_concurrency = applied("codebuild", "Concurrently running builds for Linux/Large")
    add("quota.codebuild-linux-large-concurrency", codebuild_concurrency >= 1, codebuild_concurrency, ">= 1 applied", "Protected builds are globally serialized to one Linux/Large slot.")

    codebuild_projects = applied("codebuild", "Build projects")
    project_count = int(usage.get("codebuildProjects", -1))
    add("quota.codebuild-project-headroom", project_count >= 0 and codebuild_projects - project_count >= 3, {"quota": codebuild_projects, "current": project_count}, ">= 3 free projects", "Three protected CodeBuild projects are required.")

    add(
        "provider.codebuild-vpc-hard-limits",
        1 <= CODEBUILD_VPC_SECURITY_GROUP_LIMIT and 2 <= CODEBUILD_VPC_SUBNET_LIMIT,
        {"plannedSecurityGroups": 1, "plannedSubnets": 2},
        {"securityGroupsMax": CODEBUILD_VPC_SECURITY_GROUP_LIMIT, "subnetsMax": CODEBUILD_VPC_SUBNET_LIMIT},
        "P0-recorded non-adjustable CodeBuild VPC limits cover the reviewed private build shape.",
    )

    lambda_limit = lambda_settings.get("AccountLimit") or {}
    unreserved = lambda_limit.get("UnreservedConcurrentExecutions")
    add(
        "quota.lambda-reserved-concurrency",
        isinstance(unreserved, (int, float)) and unreserved >= 100 + PROTECTED_LAMBDA_COUNT,
        {"concurrentExecutions": lambda_limit.get("ConcurrentExecutions"), "unreservedConcurrentExecutions": unreserved},
        f">= {100 + PROTECTED_LAMBDA_COUNT} currently unreserved",
        "Six one-unit protected reservations must leave at least 100 unreserved.",
    )

    ddb_quota = applied("dynamodb", "Maximum number of tables", "Tables per Region")
    ddb_count = int(usage.get("dynamodbTables", -1))
    add("quota.dynamodb-table-headroom", ddb_count >= 0 and ddb_quota - ddb_count >= 2, {"quota": ddb_quota, "current": ddb_count}, ">= 2 free tables", "Protected release-control uses at most two on-demand tables.")
    add(
        "provider.dynamodb-on-demand-throughput-baseline",
        DYNAMODB_ON_DEMAND_TABLE_READ_WRITE_DEFAULT >= 100,
        {"readRequestUnits": DYNAMODB_ON_DEMAND_TABLE_READ_WRITE_DEFAULT, "writeRequestUnits": DYNAMODB_ON_DEMAND_TABLE_READ_WRITE_DEFAULT, "accountLevelOnDemandThroughputQuota": "not-applicable"},
        "provider on-demand per-table baseline >= 100 read/write request units/sec; post-create table maximum verified separately",
        "P0 records the provider's 40k/40k initial per-table on-demand envelope; on-demand has no account-level throughput quota to read before table creation.",
    )

    rds_instances_quota = applied("rds", "DB instances")
    rds_count = int(usage.get("rdsInstances", -1))
    add("quota.rds-instance-headroom", rds_count >= 0 and rds_instances_quota - rds_count >= 2, {"quota": rds_instances_quota, "current": rds_count}, ">= 2 free DB instance slots", "Production and restore target may coexist.")

    rds_storage_quota = applied("rds", "Total storage for all DB instances")
    rds_committed = int(usage.get("rdsCommittedStorageGiB", -1))
    add("quota.rds-storage-headroom", rds_committed >= 0 and rds_storage_quota - rds_committed >= 200, {"quotaGiB": rds_storage_quota, "existingCommittedGiB": rds_committed}, ">= 200 GiB headroom", "Production and restore target may each reach 100 GiB.")

    snapshot_quota = applied("rds", "Manual DB instance snapshots")
    snapshot_count = int(usage.get("rdsManualSnapshots", -1))
    add("quota.rds-manual-snapshot-headroom", snapshot_count >= 0 and snapshot_quota - snapshot_count >= MIN_RDS_MANUAL_SNAPSHOT_HEADROOM, {"quota": snapshot_quota, "current": snapshot_count}, f">= {MIN_RDS_MANUAL_SNAPSHOT_HEADROOM} free", "Backup/restore evidence requires manual snapshot headroom.")

    add(
        "provider.rds-db-subnet-group-hard-limit",
        2 <= RDS_DB_SUBNET_GROUP_SUBNET_LIMIT,
        {"plannedSubnets": 2},
        {"subnetsPerDbSubnetGroupMax": RDS_DB_SUBNET_GROUP_SUBNET_LIMIT},
        "P0-recorded non-adjustable RDS DB-subnet-group limit covers the reviewed shape.",
    )

    matching_rds: list[dict[str, Any]] = []
    for option in rds_options:
        if option.get("Engine") != "postgres" or option.get("EngineVersion") != "18.6" or option.get("DBInstanceClass") != "db.m8gd.large":
            continue
        if option.get("StorageType") != "gp3":
            continue
        if not option.get("Vpc") or not option.get("SupportsStorageEncryption") or not option.get("SupportsStorageAutoscaling") or not option.get("SupportsIAMDatabaseAuthentication"):
            continue
        min_storage, max_storage = option.get("MinStorageSize"), option.get("MaxStorageSize")
        if not isinstance(min_storage, (int, float)) or not isinstance(max_storage, (int, float)):
            continue
        if min_storage > 20 or max_storage < 100:
            continue
        matching_rds.append(option)

    rds_azs = {
        az.get("Name")
        for option in matching_rds
        for az in (option.get("AvailabilityZones") or [])
        if isinstance(az, dict) and isinstance(az.get("Name"), str)
    }
    selected_azs, worker_enabled = _select_azs(enabled_azs, rds_azs, worker_offerings)
    add("availability.rds-postgres-18.6-db.m8gd.large-gp3", bool(matching_rds), {"matchingOptions": len(matching_rds), "availabilityZones": sorted(rds_azs)}, "exact orderable VPC gp3 option with IAM DB auth, encryption, autoscaling, 20..100 GiB support", "No class/engine/storage downgrade is allowed.")
    add("availability.rds-two-az-and-worker", len(selected_azs) == 2, {"selectedAvailabilityZones": selected_azs, "rdsAvailabilityZones": sorted(rds_azs), "m7iOfferings": worker_enabled, "enabledAvailabilityZones": sorted(enabled_azs)}, "two RDS-capable enabled AZs with m7i.xlarge available in at least one selected AZ", "RDS subnet-group diversity needs two AZs; the single worker only needs one selected AZ.")

    express = observed.get("ecsExpress") or {}
    add("availability.ecs-express", express.get("cliCommandAvailable") is True and express.get("regionalApiRecognized") is True, express, {"cliCommandAvailable": True, "regionalApiRecognized": True}, "A real read-only regional DescribeExpressGatewayService request must be recognized.")

    add(
        "provider.ecs-express-hard-limits",
        1 <= ECS_SERVICES_PER_CLUSTER_LIMIT and 2 <= ECS_TASKS_PER_SERVICE_LIMIT and 1 <= ECS_AWSVPC_SECURITY_GROUP_LIMIT and 2 <= ECS_AWSVPC_SUBNET_LIMIT,
        topology["web"],
        {"servicesPerClusterMax": ECS_SERVICES_PER_CLUSTER_LIMIT, "tasksPerServiceMax": ECS_TASKS_PER_SERVICE_LIMIT, "awsvpcSecurityGroupsMax": ECS_AWSVPC_SECURITY_GROUP_LIMIT, "awsvpcSubnetsMax": ECS_AWSVPC_SUBNET_LIMIT},
        "Reviewed web shape remains below P0-recorded hard limits.",
    )

    required_endpoints = {
        f"com.amazonaws.{REGION}.ecr.api",
        f"com.amazonaws.{REGION}.ecr.dkr",
        f"com.amazonaws.{REGION}.logs",
        f"com.amazonaws.{REGION}.s3",
        f"com.amazonaws.{REGION}.dynamodb",
    }
    if require_kms_endpoint:
        required_endpoints.add(f"com.amazonaws.{REGION}.kms")
    missing = sorted(required_endpoints - endpoint_services)
    add("availability.vpc-endpoint-services", not missing, {"missing": missing, "available": sorted(endpoint_services)}, sorted(required_endpoints), "Sensitive build and incident mediator require these regional endpoint services without NAT.")

    add("topology.private-control-subnet-ip-capacity", all(value >= MIN_PRIVATE_CONTROL_USABLE_IPV4 for value in subnet_capacity.values()), subnet_capacity, f">= {MIN_PRIVATE_CONTROL_USABLE_IPV4} usable IPv4 addresses per private app/control subnet", "Conservative P1 margin for endpoints, CodeBuild and VPC Lambda ENIs.")

    incident = topology["incidentMediator"]
    add("topology.incident-mediator-vpc-attachment", incident["vpcAttached"] is True and incident["subnets"] <= LAMBDA_VPC_SUBNET_LIMIT and incident["securityGroups"] <= LAMBDA_VPC_SECURITY_GROUP_LIMIT and incident["rdsPort"] == 5432 and incident["internetNatEgress"] is False and incident["dynamodbGatewayEndpoint"] is True, incident, {"vpcAttached": True, "subnetsMax": LAMBDA_VPC_SUBNET_LIMIT, "securityGroupsMax": LAMBDA_VPC_SECURITY_GROUP_LIMIT, "rdsPort": 5432, "internetNatEgress": False, "dynamodbGatewayEndpoint": True}, "R31 mediator topology is representable within Lambda VPC limits.")
    add("topology.rds-iam-database-auth-plan", incident["rdsIamDatabaseAuthentication"] is True and incident["dbUser"] == INCIDENT_DB_USER, {"enabledInPlan": incident["rdsIamDatabaseAuthentication"], "dbUser": incident["dbUser"]}, {"enabledInPlan": True, "dbUser": INCIDENT_DB_USER}, "Post-create evidence must prove the realized RDS setting and grants.")
    template = rds_db_connect_resource_template(account)
    add("topology.rds-db-connect-resource-template", incident["rdsDbConnectResourceTemplate"] == template, incident["rdsDbConnectResourceTemplate"], template, "The DBI resource ID placeholder must be replaced with the created primary's exact resource ID before IAM policy acceptance.")
    add("topology.rds-incident-connection-budget", incident["maxConcurrentDbSessions"] == INCIDENT_MEDIATOR_MAX_DB_SESSIONS, incident["maxConcurrentDbSessions"], "exactly one concurrent fence-only session", "Live max_connections/headroom remains post-create evidence.")

    summary = {
        "status": "PASS" if all(check.status == "PASS" for check in checks) else "FAIL",
        "checks": len(checks),
        "passed": sum(check.status == "PASS" for check in checks),
        "failed": sum(check.status == "FAIL" for check in checks),
        "selectedAvailabilityZones": selected_azs,
        "workerAvailabilityZones": worker_enabled,
        "privateSubnetUsableIpv4": subnet_capacity,
        "interfaceEndpointCountRequired": interface_required,
        "protectedLambdaReservedConcurrencyUnits": PROTECTED_LAMBDA_COUNT,
    }
    return checks, summary


class AwsCli:
    def __init__(self, binary: str, profile: str | None, region: str) -> None:
        self.binary = binary
        self.profile = profile
        self.region = region

    def _base_command(self, service: str, operation: str, *args: str) -> list[str]:
        if (service, operation) not in READ_ONLY_AWS_OPERATIONS:
            raise AdmissionError(f"non-read-only AWS operation rejected: {service} {operation}")
        command = [self.binary, service, operation, *args, "--region", self.region, "--output", "json", "--no-cli-pager", "--cli-connect-timeout", "10", "--cli-read-timeout", "30"]
        if self.profile:
            command.extend(["--profile", self.profile])
        return command

    @staticmethod
    def _run(command: list[str]) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(command, capture_output=True, text=True, timeout=45)
        except subprocess.TimeoutExpired as exc:
            raise AdmissionError(f"command timed out: {command[:3]!r}") from exc

    def run_json(self, service: str, operation: str, *args: str) -> dict[str, Any]:
        result = self._run(self._base_command(service, operation, *args))
        if result.returncode != 0:
            raise AdmissionError(f"AWS read failed ({service} {operation}): {result.stderr.strip()}")
        try:
            value = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise AdmissionError(f"AWS response was not JSON ({service} {operation})") from exc
        if not isinstance(value, dict):
            raise AdmissionError(f"AWS response was not an object ({service} {operation})")
        return value

    def cli_version(self) -> str:
        result = self._run([self.binary, "--version"])
        if result.returncode != 0:
            raise AdmissionError(f"cannot execute AWS CLI: {result.stderr.strip()}")
        version = (result.stdout or result.stderr).strip()
        match = re.search(r"aws-cli/(\d+)\.", version)
        if not match or int(match.group(1)) < 2:
            raise AdmissionError(f"AWS CLI v2 is required: {version}")
        return version

    def executable_provenance(self) -> dict[str, str]:
        resolved = shutil.which(self.binary)
        if resolved is None:
            raise AdmissionError(f"AWS CLI executable not found: {self.binary!r}")
        path = Path(resolved).resolve()
        if not path.is_file():
            raise AdmissionError(f"AWS CLI executable is not a file: {path}")
        return {"resolvedPath": str(path), "sha256": sha256_file(path)}

    def probe_express_gateway_service(self, account: str) -> dict[str, Any]:
        service_arn = f"arn:aws:ecs:{self.region}:{account}:service/default/fpllm-readonly-admission-probe-does-not-exist"
        result = self._run(self._base_command("ecs", "describe-express-gateway-service", "--service-arn", service_arn))
        combined = f"{result.stdout}\n{result.stderr}".strip()
        lowered = combined.lower()
        if result.returncode == 0:
            return {"cliCommandAvailable": True, "regionalApiRecognized": True, "probeOutcome": "success"}
        if "invalid choice" in lowered or "unknown options" in lowered:
            return {"cliCommandAvailable": False, "regionalApiRecognized": False, "probeOutcome": "cli-model-missing"}
        recognized = any(marker in lowered for marker in ("servicenotfoundexception", "service not found", "cluster not found", "clusternotfoundexception"))
        if recognized:
            return {"cliCommandAvailable": True, "regionalApiRecognized": True, "probeOutcome": "expected-not-found"}
        if "accessdenied" in lowered or "access denied" in lowered:
            raise AdmissionError("read-only identity cannot call ecs:DescribeExpressGatewayService")
        if any(marker in lowered for marker in ("unknownoperation", "unsupportedoperation", "not supported in this region")):
            return {"cliCommandAvailable": True, "regionalApiRecognized": False, "probeOutcome": "regional-api-unsupported"}
        raise AdmissionError(f"ECS Express regional read probe returned an unclassified error: {combined[-1200:]}")


def service_quotas(cli: AwsCli, service_code: str) -> list[dict[str, Any]]:
    applied_doc = cli.run_json("service-quotas", "list-service-quotas", "--service-code", service_code, "--quota-applied-at-level", "ACCOUNT")
    default_doc = cli.run_json("service-quotas", "list-aws-default-service-quotas", "--service-code", service_code)
    applied = applied_doc.get("Quotas")
    defaults = default_doc.get("Quotas")
    if not isinstance(applied, list) or not isinstance(defaults, list):
        raise AdmissionError(f"missing service quotas for {service_code}")
    merged: dict[str, dict[str, Any]] = {}
    for quota in defaults:
        code = quota.get("QuotaCode") or f"default:{quota.get('QuotaName')}"
        merged[str(code)] = {**quota, "fpllmValueSource": "aws-default"}
    for quota in applied:
        code = quota.get("QuotaCode") or f"applied:{quota.get('QuotaName')}"
        merged[str(code)] = {**quota, "fpllmValueSource": "applied"}
    return list(merged.values())


def collector_provenance(require_clean: bool) -> dict[str, Any]:
    script = Path(__file__).resolve()
    root = script.parents[2]
    rev = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10)
    commit = rev.stdout.strip() if rev.returncode == 0 else None
    if require_clean and not commit:
        raise AdmissionError("live evidence must be generated from a Git checkout with an attributable commit")
    try:
        relative = script.relative_to(root)
    except ValueError as exc:
        raise AdmissionError("collector path is not under the repository root") from exc
    status = subprocess.run(["git", "-C", str(root), "status", "--porcelain", "--untracked-files=no", "--", str(relative)], capture_output=True, text=True, timeout=10)
    clean = status.stdout.strip() == "" if status.returncode == 0 else None
    if require_clean and clean is not True:
        raise AdmissionError("live evidence collector differs from the committed Git revision")
    return {"gitCommit": commit, "scriptPath": str(relative), "scriptSha256": sha256_file(script), "scriptWorkingTreeClean": clean}


def collect(cli: AwsCli, require_kms_endpoint: bool) -> dict[str, Any]:
    version = cli.cli_version()
    cli_provenance = cli.executable_provenance()
    identity = cli.run_json("sts", "get-caller-identity")
    account = identity.get("Account")
    if not isinstance(account, str) or not re.fullmatch(r"\d{12}", account):
        raise AdmissionError(f"invalid AWS account ID in caller identity: {account!r}")

    regions = cli.run_json("ec2", "describe-regions", "--all-regions", "--region-names", REGION).get("Regions") or []
    region = next((item for item in regions if item.get("RegionName") == REGION), {})
    az_doc = cli.run_json("ec2", "describe-availability-zones", "--filters", "Name=opt-in-status,Values=opt-in-not-required,opted-in")
    enabled_azs = sorted(item["ZoneName"] for item in az_doc.get("AvailabilityZones", []) if item.get("State") == "available" and isinstance(item.get("ZoneName"), str))
    offerings_doc = cli.run_json("ec2", "describe-instance-type-offerings", "--location-type", "availability-zone", "--filters", "Name=instance-type,Values=m7i.xlarge")
    m7i = sorted(item["Location"] for item in offerings_doc.get("InstanceTypeOfferings", []) if isinstance(item.get("Location"), str))
    rds_doc = cli.run_json("rds", "describe-orderable-db-instance-options", "--engine", "postgres", "--engine-version", "18.6", "--db-instance-class", "db.m8gd.large", "--vpc")

    endpoint_names = [
        f"com.amazonaws.{REGION}.ecr.api",
        f"com.amazonaws.{REGION}.ecr.dkr",
        f"com.amazonaws.{REGION}.logs",
        f"com.amazonaws.{REGION}.s3",
        f"com.amazonaws.{REGION}.dynamodb",
    ]
    if require_kms_endpoint:
        endpoint_names.append(f"com.amazonaws.{REGION}.kms")
    endpoint_doc = cli.run_json("ec2", "describe-vpc-endpoint-services", "--service-names", *endpoint_names)

    express_probe = cli.probe_express_gateway_service(account)
    vpcs = cli.run_json("ec2", "describe-vpcs")
    enis = cli.run_json("ec2", "describe-network-interfaces")
    sgs = cli.run_json("ec2", "describe-security-groups")
    endpoints = cli.run_json("ec2", "describe-vpc-endpoints")
    albs = cli.run_json("elbv2", "describe-load-balancers")
    projects = cli.run_json("codebuild", "list-projects")
    tables = cli.run_json("dynamodb", "list-tables")
    rds_instances = cli.run_json("rds", "describe-db-instances")
    rds_snapshots = cli.run_json("rds", "describe-db-snapshots", "--snapshot-type", "manual")
    lambda_settings = cli.run_json("lambda", "get-account-settings")

    rds_instance_list = rds_instances.get("DBInstances") or []
    rds_committed_storage = sum(
        max(int(item.get("AllocatedStorage") or 0), int(item.get("MaxAllocatedStorage") or item.get("AllocatedStorage") or 0))
        for item in rds_instance_list
    )

    return {
        "awsCliVersion": version,
        "awsCliExecutable": cli_provenance,
        "identity": identity,
        "region": region,
        "enabledAvailabilityZones": enabled_azs,
        "m7iOfferings": m7i,
        "rdsOrderableOptions": rds_doc.get("OrderableDBInstanceOptions") or [],
        "endpointServices": endpoint_doc.get("ServiceNames") or [],
        "ecsExpress": express_probe,
        "quotas": {
            code: service_quotas(cli, code)
            for code in ("fargate", "ec2", "rds", "elasticloadbalancing", "vpc", "codebuild", "dynamodb")
        },
        "usage": {
            "vpcs": count_list(vpcs, "Vpcs"),
            "networkInterfaces": count_list(enis, "NetworkInterfaces"),
            "securityGroups": count_list(sgs, "SecurityGroups"),
            "gatewayVpcEndpoints": sum(1 for item in (endpoints.get("VpcEndpoints") or []) if item.get("VpcEndpointType") == "Gateway"),
            "applicationLoadBalancers": sum(1 for item in albs.get("LoadBalancers", []) if item.get("Type") == "application"),
            "codebuildProjects": len(projects.get("projects") or []),
            "dynamodbTables": len(tables.get("TableNames") or []),
            "rdsInstances": len(rds_instance_list),
            "rdsCommittedStorageGiB": rds_committed_storage,
            "rdsManualSnapshots": len(rds_snapshots.get("DBSnapshots") or []),
        },
        "lambdaAccountSettings": lambda_settings,
    }


def build_evidence_boundary(evidence_source: str, summary_status: str) -> dict[str, Any]:
    return {
        "resourceCreationPerformed": False,
        "liveAdmissionPassed": evidence_source == "live-aws" and summary_status == "PASS",
        "productionResourceCreationAuthorizedByThisReport": False,
        "resourceCreationBlockersRemaining": [
            "fresh exact-topology cost estimate must remain below the USD 900/month stop/review threshold",
            "maintainer disposition of the controlled live admission evidence",
        ],
        "postProvisionVerificationStillRequired": [
            "RDS IAM database authentication enabled on the created primary",
            "created DBI resource ID substituted into the exact rds-db:connect resource ARN and effective IAM policy verified",
            "live RDS max_connections / connection headroom including <=1 incident-mediator session",
            "real subnet available-IP counts and Lambda/CodeBuild ENI attachment",
            "real VPC endpoint policies and route-table associations",
            "DynamoDB tables use PAY_PER_REQUEST and no table maximum is below the frozen release-control requirement",
        ],
    }


def write_report(path: Path, report: dict[str, Any]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(report, indent=2, sort_keys=True) + "\n").encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    temp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
        os.chmod(path, 0o600)
    finally:
        if temp.exists():
            temp.unlink()
    digest_path = path.with_name(f"{path.name}.sha256")
    digest_temp = digest_path.with_name(f".{digest_path.name}.tmp-{os.getpid()}")
    fd2 = os.open(digest_temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd2, "w", encoding="utf-8") as handle:
            handle.write(f"{digest}  {path.name}\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(digest_temp, digest_path)
        os.chmod(digest_path, 0o600)
    finally:
        if digest_temp.exists():
            digest_temp.unlink()
    return digest


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only/no-create Platform v0.5 P1 AWS topology/quota admission collector.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--region", default=REGION)
    parser.add_argument("--profile")
    parser.add_argument("--aws-binary", default="aws")
    parser.add_argument("--private-subnet-cidr", action="append", dest="private_subnet_cidrs", required=True, help="Reviewed private app/control subnet CIDR; specify both planned CIDRs.")
    parser.add_argument("--require-kms-interface-endpoint", action="store_true")
    parser.add_argument("--fixture", type=Path, help="CI/test only: evaluate captured observations without invoking AWS; never live admission evidence.")
    args = parser.parse_args()

    if args.region != REGION:
        raise SystemExit(f"P1_REGION_MUST_BE_{REGION}:{args.region}")

    evidence_source = "fixture" if args.fixture else "live-aws"
    try:
        provenance = collector_provenance(require_clean=evidence_source == "live-aws")
        observed = json.loads(args.fixture.read_text(encoding="utf-8")) if args.fixture else collect(AwsCli(args.aws_binary, args.profile, args.region), args.require_kms_interface_endpoint)
        checks, summary = evaluate(observed, args.private_subnet_cidrs, args.require_kms_interface_endpoint)
    except (AdmissionError, OSError, json.JSONDecodeError, KeyError, TypeError, ValueError, subprocess.SubprocessError) as exc:
        raise SystemExit(f"P1_ADMISSION_COLLECTION_FAILED:{exc}") from exc

    account = str((observed.get("identity") or {}).get("Account"))
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "fpllm-platform-v0.5-p1-readonly-admission",
        "generatedAt": utc_now(),
        "region": REGION,
        "readOnlyNoCreate": True,
        "evidenceSource": evidence_source,
        "collectorProvenance": provenance,
        "plannedTopology": planned_topology(account),
        "privateApplicationControlSubnetCidrs": args.private_subnet_cidrs,
        "requireKmsInterfaceEndpoint": args.require_kms_interface_endpoint,
        "identity": observed.get("identity"),
        "awsCliVersion": observed.get("awsCliVersion"),
        "summary": summary,
        "checks": [check.to_dict() for check in checks],
        "observations": observed,
        "evidenceBoundary": build_evidence_boundary(evidence_source, summary["status"]),
    }
    digest = write_report(args.output, report)
    print(json.dumps({**summary, "reportSha256": digest, "reportPath": str(args.output)}, sort_keys=True))
    return 0 if summary["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())

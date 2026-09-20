from __future__ import annotations

import argparse
import ipaddress
import json
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

REGION = "eu-west-1"
SCHEMA_VERSION = "1"
VPC_CIDR = "10.42.0.0/16"
PLANNED_SUBNET_CIDRS = (
    "10.42.0.0/24",
    "10.42.1.0/24",
    "10.42.16.0/24",
    "10.42.17.0/24",
    "10.42.32.0/24",
    "10.42.33.0/24",
)
PLANNED_PRIVATE_CONTROL_CIDRS = ("10.42.16.0/24", "10.42.17.0/24")
PROTECTED_LAMBDA_COUNT = 6
INCIDENT_MEDIATOR_MAX_DB_SESSIONS = 1
MIN_PRIVATE_SUBNET_USABLE_IPV4 = 32
MIN_SECURITY_GROUP_HEADROOM = 8
MIN_ENI_HEADROOM = 32
MIN_RDS_MANUAL_SNAPSHOT_HEADROOM = 2

# Every network/API request made by the collector itself must be present here.
# Local AWS CLI model inspection (--generate-cli-skeleton) is intentionally not
# included because it does not send an AWS request.
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
    ("ecs", "list-clusters"),
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


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def quota_value(quotas: Iterable[dict[str, Any]], *names_or_substrings: str) -> float:
    needles = tuple(normalize_name(item) for item in names_or_substrings)
    exact = [
        quota
        for quota in quotas
        if normalize_name(str(quota.get("QuotaName", ""))) in needles
    ]
    matches = exact
    if not matches:
        matches = []
        for quota in quotas:
            name = normalize_name(str(quota.get("QuotaName", "")))
            if any(needle in name for needle in needles):
                matches.append(quota)
    if len(matches) != 1:
        names = sorted(str(item.get("QuotaName")) for item in matches)
        raise AdmissionError(
            f"quota lookup ambiguous/missing for {names_or_substrings!r}: {names}"
        )
    value = matches[0].get("Value")
    if not isinstance(value, (int, float)):
        raise AdmissionError(
            f"quota value is not numeric for {matches[0].get('QuotaName')!r}: {value!r}"
        )
    return float(value)


def count_list(doc: dict[str, Any], key: str) -> int:
    value = doc.get(key)
    if not isinstance(value, list):
        raise AdmissionError(f"expected list at {key}")
    return len(value)


def usable_ipv4(cidr: str) -> int:
    network = ipaddress.ip_network(cidr, strict=True)
    if network.version != 4:
        raise AdmissionError(f"subnet must be IPv4: {cidr}")
    # AWS reserves the first four and final IPv4 addresses in each subnet.
    return max(0, network.num_addresses - 5)


def validate_topology(private_subnet_cidrs: list[str]) -> dict[str, int]:
    if len(private_subnet_cidrs) < 2:
        raise AdmissionError("at least two private application/control subnet CIDRs are required")
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


def evaluate(
    observed: dict[str, Any],
    private_subnet_cidrs: list[str],
    require_kms_endpoint: bool,
) -> tuple[list[Check], dict[str, Any]]:
    subnet_capacity = validate_topology(private_subnet_cidrs)

    identity = observed.get("identity") or {}
    region = observed.get("region") or {}
    quotas = observed.get("quotas") or {}
    usage = observed.get("usage") or {}
    lambda_settings = observed.get("lambdaAccountSettings") or {}
    instance_offerings = set(observed.get("m7iOfferings") or [])
    rds_options = observed.get("rdsOrderableOptions") or []
    endpoint_services = set(observed.get("endpointServices") or [])
    enabled_azs = set(observed.get("enabledAvailabilityZones") or [])

    checks: list[Check] = []

    def add(check_id: str, ok: bool, observed_value: Any, required: Any, detail: str) -> None:
        checks.append(
            Check(
                check_id,
                "PASS" if ok else "FAIL",
                observed_value,
                required,
                detail,
            )
        )

    account = identity.get("Account")
    add(
        "identity.account",
        isinstance(account, str) and bool(account),
        account,
        "non-empty AWS account ID",
        "Caller identity must be attributable.",
    )

    region_name = region.get("RegionName")
    opt_in = region.get("OptInStatus")
    add(
        "region.eu-west-1-enabled",
        region_name == REGION and opt_in in {"opt-in-not-required", "opted-in"},
        {"region": region_name, "optInStatus": opt_in},
        {"region": REGION, "optInStatus": ["opt-in-not-required", "opted-in"]},
        "Production region is frozen to Europe (Ireland).",
    )

    fargate_quota = quota_value(
        quotas["fargate"], "Fargate On-Demand vCPU resource count"
    )
    add(
        "quota.fargate-ondemand-vcpu",
        fargate_quota >= 6,
        fargate_quota,
        ">= 6 vCPU",
        "Frozen web/migration/canary applied-quota minimum.",
    )

    ec2_quota = quota_value(quotas["ec2"], "Running On-Demand Standard")
    add(
        "quota.ec2-standard-ondemand-vcpu",
        ec2_quota >= 4,
        ec2_quota,
        ">= 4 vCPU",
        "One m7i.xlarge worker requires four Standard On-Demand vCPUs.",
    )

    alb_quota = quota_value(
        quotas["elasticloadbalancing"], "Application Load Balancers per Region"
    )
    alb_count = int(usage.get("applicationLoadBalancers", -1))
    add(
        "quota.alb-headroom",
        alb_count >= 0 and alb_quota - alb_count >= 1,
        {"quota": alb_quota, "current": alb_count, "headroom": alb_quota - alb_count},
        ">= 1 free ALB",
        "ECS Express requires one internet-facing ALB in the frozen topology.",
    )

    vpc_quota = quota_value(quotas["vpc"], "VPCs per Region")
    vpc_count = int(usage.get("vpcs", -1))
    add(
        "quota.vpc-headroom",
        vpc_count >= 0 and vpc_quota - vpc_count >= 1,
        {"quota": vpc_quota, "current": vpc_count, "headroom": vpc_quota - vpc_count},
        ">= 1 free VPC",
        "P1 provisions one production VPC.",
    )

    subnet_quota = quota_value(quotas["vpc"], "Subnets per VPC")
    add(
        "quota.subnets-per-vpc",
        subnet_quota >= len(PLANNED_SUBNET_CIDRS),
        subnet_quota,
        f">= {len(PLANNED_SUBNET_CIDRS)}",
        "The reviewed topology uses two public, two private app/control and two private DB subnets.",
    )

    sg_quota = quota_value(quotas["vpc"], "VPC security groups per Region")
    sg_count = int(usage.get("securityGroups", -1))
    add(
        "quota.security-group-headroom",
        sg_count >= 0 and sg_quota - sg_count >= MIN_SECURITY_GROUP_HEADROOM,
        {"quota": sg_quota, "current": sg_count, "headroom": sg_quota - sg_count},
        f">= {MIN_SECURITY_GROUP_HEADROOM} free regional security groups",
        "Conservative P1 margin for distinct web/worker/RDS/build/incident boundaries.",
    )

    eni_quota = quota_value(quotas["vpc"], "Network interfaces per Region")
    eni_count = int(usage.get("networkInterfaces", -1))
    add(
        "quota.network-interface-headroom",
        eni_count >= 0 and eni_quota - eni_count >= MIN_ENI_HEADROOM,
        {"quota": eni_quota, "current": eni_count, "headroom": eni_quota - eni_count},
        f">= {MIN_ENI_HEADROOM} free ENI slots",
        "Conservative pre-create margin for Fargate, VPC Lambda, CodeBuild, RDS and interface endpoints.",
    )

    endpoint_quota = quota_value(quotas["vpc"], "Interface VPC endpoints per VPC")
    required_interface_endpoints = 4 if require_kms_endpoint else 3
    add(
        "quota.interface-vpc-endpoints",
        endpoint_quota >= required_interface_endpoints,
        endpoint_quota,
        f">= {required_interface_endpoints}",
        "Sensitive build requires ECR API, ECR DKR and Logs; KMS is optional only when proven necessary.",
    )

    gateway_endpoint_quota = quota_value(
        quotas["vpc"], "Gateway VPC endpoints per Region"
    )
    gateway_endpoint_count = int(usage.get("gatewayVpcEndpoints", -1))
    add(
        "quota.gateway-vpc-endpoint-headroom",
        gateway_endpoint_count >= 0
        and gateway_endpoint_quota - gateway_endpoint_count >= 2,
        {
            "quota": gateway_endpoint_quota,
            "current": gateway_endpoint_count,
            "headroom": gateway_endpoint_quota - gateway_endpoint_count,
        },
        ">= 2 free gateway endpoint slots",
        "S3 and DynamoDB gateway endpoints are required without NAT.",
    )

    codebuild_concurrency = quota_value(
        quotas["codebuild"], "Concurrently running builds for Linux/Large"
    )
    add(
        "quota.codebuild-linux-large-concurrency",
        codebuild_concurrency >= 1,
        codebuild_concurrency,
        ">= 1",
        "Three protected projects are globally serialized to one running Linux/Large build.",
    )

    codebuild_projects_quota = quota_value(quotas["codebuild"], "Build projects")
    project_count = int(usage.get("codebuildProjects", -1))
    add(
        "quota.codebuild-project-headroom",
        project_count >= 0 and codebuild_projects_quota - project_count >= 3,
        {
            "quota": codebuild_projects_quota,
            "current": project_count,
            "headroom": codebuild_projects_quota - project_count,
        },
        ">= 3 free projects",
        "Worker, evaluator-base and final hidden-evaluator projects are all required.",
    )

    codebuild_sg_limit = quota_value(
        quotas["codebuild"], "Security groups under VPC configuration"
    )
    add(
        "quota.codebuild-vpc-security-groups",
        codebuild_sg_limit >= 1,
        codebuild_sg_limit,
        ">= 1",
        "The sensitive builder needs one bounded security-group attachment.",
    )

    codebuild_subnet_limit = quota_value(
        quotas["codebuild"], "Subnets under VPC configuration"
    )
    add(
        "quota.codebuild-vpc-subnets",
        codebuild_subnet_limit >= len(PLANNED_PRIVATE_CONTROL_CIDRS),
        codebuild_subnet_limit,
        f">= {len(PLANNED_PRIVATE_CONTROL_CIDRS)}",
        "The sensitive builder is planned across the two private app/control subnets.",
    )

    lambda_limits = lambda_settings.get("AccountLimit") or {}
    unreserved = lambda_limits.get("UnreservedConcurrentExecutions")
    total_concurrency = lambda_limits.get("ConcurrentExecutions")
    lambda_ok = (
        isinstance(unreserved, (int, float))
        and unreserved >= 100 + PROTECTED_LAMBDA_COUNT
    )
    add(
        "quota.lambda-reserved-concurrency",
        lambda_ok,
        {
            "concurrentExecutions": total_concurrency,
            "unreservedConcurrentExecutions": unreserved,
        },
        f">= {100 + PROTECTED_LAMBDA_COUNT} currently unreserved so "
        f"{PROTECTED_LAMBDA_COUNT} one-unit reservations leave >=100 unreserved",
        "Current corrected topology retains six protected reserved-concurrency Lambdas.",
    )

    ddb_table_quota = quota_value(
        quotas["dynamodb"], "Maximum number of tables", "Tables per Region"
    )
    ddb_count = int(usage.get("dynamodbTables", -1))
    add(
        "quota.dynamodb-table-headroom",
        ddb_count >= 0 and ddb_table_quota - ddb_count >= 2,
        {
            "quota": ddb_table_quota,
            "current": ddb_count,
            "headroom": ddb_table_quota - ddb_count,
        },
        ">= 2 free tables",
        "Protected release-control uses at most two on-demand tables.",
    )

    rds_db_quota = quota_value(quotas["rds"], "DB instances")
    rds_count = int(usage.get("rdsInstances", -1))
    add(
        "quota.rds-instance-headroom",
        rds_count >= 0 and rds_db_quota - rds_count >= 2,
        {"quota": rds_db_quota, "current": rds_count, "headroom": rds_db_quota - rds_count},
        ">= 2 free DB instance slots",
        "Production and restore-drill target may coexist.",
    )

    rds_storage_quota = quota_value(quotas["rds"], "Total storage for all DB instances")
    current_rds_storage = int(usage.get("rdsAllocatedStorageGiB", -1))
    add(
        "quota.rds-storage-headroom",
        current_rds_storage >= 0 and rds_storage_quota - current_rds_storage >= 200,
        {
            "quotaGiB": rds_storage_quota,
            "currentAllocatedGiB": current_rds_storage,
            "headroomGiB": rds_storage_quota - current_rds_storage,
        },
        ">= 200 GiB headroom",
        "Production and restore target may each reach the 100 GiB autoscaling ceiling.",
    )

    rds_snapshot_quota = quota_value(quotas["rds"], "Manual DB instance snapshots")
    rds_snapshot_count = int(usage.get("rdsManualSnapshots", -1))
    add(
        "quota.rds-manual-snapshot-headroom",
        rds_snapshot_count >= 0
        and rds_snapshot_quota - rds_snapshot_count >= MIN_RDS_MANUAL_SNAPSHOT_HEADROOM,
        {
            "quota": rds_snapshot_quota,
            "current": rds_snapshot_count,
            "headroom": rds_snapshot_quota - rds_snapshot_count,
        },
        f">= {MIN_RDS_MANUAL_SNAPSHOT_HEADROOM} free manual DB instance snapshot slots",
        "P1 backup/restore and pre-migration evidence must not begin with exhausted snapshot capacity.",
    )

    rds_subnet_limit = quota_value(quotas["rds"], "Subnets per DB subnet group")
    add(
        "quota.rds-subnets-per-db-subnet-group",
        rds_subnet_limit >= 2,
        rds_subnet_limit,
        ">= 2",
        "The selected RDS topology requires private DB subnets in at least two Availability Zones.",
    )

    matching_rds: list[dict[str, Any]] = []
    for option in rds_options:
        if (
            option.get("Engine") != "postgres"
            or option.get("EngineVersion") != "18.6"
            or option.get("DBInstanceClass") != "db.m8gd.large"
        ):
            continue
        if option.get("StorageType") != "gp3":
            continue
        if (
            not option.get("Vpc")
            or not option.get("SupportsStorageEncryption")
            or not option.get("SupportsStorageAutoscaling")
            or not option.get("SupportsIAMDatabaseAuthentication")
        ):
            continue
        min_storage = option.get("MinStorageSize")
        max_storage = option.get("MaxStorageSize")
        if not isinstance(min_storage, (int, float)) or not isinstance(
            max_storage, (int, float)
        ):
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
    common_azs = sorted(enabled_azs & instance_offerings & rds_azs)
    add(
        "availability.rds-postgres-18.6-db.m8gd.large-gp3",
        bool(matching_rds),
        {"matchingOptions": len(matching_rds), "availabilityZones": sorted(rds_azs)},
        "orderable VPC gp3 option with IAM DB auth, encryption, storage autoscaling, 20..100 GiB support",
        "The corrected RDS selection must be realizable exactly; no silent class downgrade is allowed.",
    )
    add(
        "availability.m7i-and-rds-two-az-intersection",
        len(common_azs) >= 2,
        {
            "commonAvailabilityZones": common_azs,
            "m7iOfferings": sorted(instance_offerings),
            "rdsAvailabilityZones": sorted(rds_azs),
            "enabledAvailabilityZones": sorted(enabled_azs),
        },
        ">= 2 common enabled AZs",
        "At least two AZs must support the worker offering and selected RDS option.",
    )

    express = observed.get("ecsExpress") or {}
    add(
        "availability.ecs-express",
        express.get("apiModelAvailable") is True
        and express.get("regionalEndpointReachable") is True,
        express,
        {"apiModelAvailable": True, "regionalEndpointReachable": True},
        "No-create probe requires the Express CLI/API model and reachable ECS regional endpoint.",
    )

    required_endpoint_services = {
        f"com.amazonaws.{REGION}.ecr.api",
        f"com.amazonaws.{REGION}.ecr.dkr",
        f"com.amazonaws.{REGION}.logs",
        f"com.amazonaws.{REGION}.s3",
        f"com.amazonaws.{REGION}.dynamodb",
    }
    if require_kms_endpoint:
        required_endpoint_services.add(f"com.amazonaws.{REGION}.kms")
    missing_services = sorted(required_endpoint_services - endpoint_services)
    add(
        "availability.vpc-endpoint-services",
        not missing_services,
        {"available": sorted(endpoint_services), "missing": missing_services},
        sorted(required_endpoint_services),
        "No-Internet sensitive build and incident mediator depend on these regional endpoint services.",
    )

    subnet_ok = all(
        value >= MIN_PRIVATE_SUBNET_USABLE_IPV4 for value in subnet_capacity.values()
    )
    add(
        "topology.private-control-subnet-ip-capacity",
        subnet_ok,
        subnet_capacity,
        f">= {MIN_PRIVATE_SUBNET_USABLE_IPV4} usable IPv4 addresses per private app/control subnet",
        "Conservative pre-create margin for interface endpoints, CodeBuild and VPC Lambda ENIs.",
    )

    planned_incident_sessions = observed.get("plannedIncidentMediatorMaxDbSessions")
    add(
        "topology.rds-incident-connection-budget",
        planned_incident_sessions == INCIDENT_MEDIATOR_MAX_DB_SESSIONS,
        planned_incident_sessions,
        f"exactly {INCIDENT_MEDIATOR_MAX_DB_SESSIONS} planned concurrent fpllm_incident_fence session",
        "Live RDS max_connections/headroom remains post-provision evidence before incident use.",
    )

    summary = {
        "status": "PASS" if all(check.status == "PASS" for check in checks) else "FAIL",
        "checks": len(checks),
        "passed": sum(check.status == "PASS" for check in checks),
        "failed": sum(check.status == "FAIL" for check in checks),
        "selectedAvailabilityZones": common_azs[:2] if len(common_azs) >= 2 else [],
        "privateSubnetUsableIpv4": subnet_capacity,
        "interfaceEndpointCountRequired": required_interface_endpoints,
        "protectedLambdaReservedConcurrencyUnits": PROTECTED_LAMBDA_COUNT,
    }
    return checks, summary


class AwsCli:
    def __init__(self, binary: str, profile: str | None, region: str) -> None:
        self.binary = binary
        self.profile = profile
        self.region = region

    def run_json(self, service: str, operation: str, *args: str) -> dict[str, Any]:
        if (service, operation) not in READ_ONLY_AWS_OPERATIONS:
            raise AdmissionError(
                f"non-read-only AWS operation rejected: {service} {operation}"
            )
        command = [
            self.binary,
            service,
            operation,
            *args,
            "--region",
            self.region,
            "--output",
            "json",
            "--no-cli-pager",
        ]
        if self.profile:
            command.extend(["--profile", self.profile])
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            raise AdmissionError(
                f"AWS read failed ({service} {operation}): {result.stderr.strip()}"
            )
        try:
            value = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise AdmissionError(
                f"AWS response was not JSON ({service} {operation})"
            ) from exc
        if not isinstance(value, dict):
            raise AdmissionError(
                f"AWS response was not an object ({service} {operation})"
            )
        return value

    def cli_version(self) -> str:
        result = subprocess.run(
            [self.binary, "--version"], capture_output=True, text=True
        )
        if result.returncode != 0:
            raise AdmissionError(f"cannot execute AWS CLI: {result.stderr.strip()}")
        version = (result.stdout or result.stderr).strip()
        match = re.search(r"aws-cli/(\d+)\.", version)
        if not match or int(match.group(1)) < 2:
            raise AdmissionError(
                f"AWS CLI v2 is required for ECS Express admission checks: {version}"
            )
        return version

    def express_api_model_available(self) -> bool:
        # --generate-cli-skeleton is a local model operation and sends no AWS request.
        command = [
            self.binary,
            "ecs",
            "describe-express-gateway-service",
            "--service-arn",
            f"arn:aws:ecs:{self.region}:000000000000:express-gateway-service/fpllm-readonly-probe",
            "--generate-cli-skeleton",
            "output",
            "--region",
            self.region,
            "--no-cli-pager",
        ]
        if self.profile:
            command.extend(["--profile", self.profile])
        result = subprocess.run(command, capture_output=True, text=True)
        return result.returncode == 0


def service_quotas(cli: AwsCli, service_code: str) -> list[dict[str, Any]]:
    applied_doc = cli.run_json(
        "service-quotas", "list-service-quotas", "--service-code", service_code
    )
    default_doc = cli.run_json(
        "service-quotas",
        "list-aws-default-service-quotas",
        "--service-code",
        service_code,
    )
    applied = applied_doc.get("Quotas")
    defaults = default_doc.get("Quotas")
    if not isinstance(applied, list) or not isinstance(defaults, list):
        raise AdmissionError(f"missing service quotas for {service_code}")

    # Applied/account-specific values override provider defaults by stable quota code.
    # Defaults fill hard/default-only quota codes that have no applied-account entry.
    merged: dict[str, dict[str, Any]] = {}
    for quota in defaults:
        code = quota.get("QuotaCode") or f"default:{quota.get('QuotaName')}"
        merged[str(code)] = {**quota, "fpllmValueSource": "aws-default"}
    for quota in applied:
        code = quota.get("QuotaCode") or f"applied:{quota.get('QuotaName')}"
        merged[str(code)] = {**quota, "fpllmValueSource": "applied"}
    return list(merged.values())


def collect(cli: AwsCli, require_kms_endpoint: bool) -> dict[str, Any]:
    version = cli.cli_version()
    identity = cli.run_json("sts", "get-caller-identity")

    regions = cli.run_json(
        "ec2", "describe-regions", "--all-regions", "--region-names", REGION
    ).get("Regions") or []
    region = next((item for item in regions if item.get("RegionName") == REGION), {})

    az_doc = cli.run_json(
        "ec2",
        "describe-availability-zones",
        "--filters",
        "Name=opt-in-status,Values=opt-in-not-required,opted-in",
    )
    enabled_azs = sorted(
        item["ZoneName"]
        for item in az_doc.get("AvailabilityZones", [])
        if item.get("State") == "available" and isinstance(item.get("ZoneName"), str)
    )

    offerings_doc = cli.run_json(
        "ec2",
        "describe-instance-type-offerings",
        "--location-type",
        "availability-zone",
        "--filters",
        "Name=instance-type,Values=m7i.xlarge",
    )
    m7i = sorted(
        item["Location"]
        for item in offerings_doc.get("InstanceTypeOfferings", [])
        if isinstance(item.get("Location"), str)
    )

    rds_doc = cli.run_json(
        "rds",
        "describe-orderable-db-instance-options",
        "--engine",
        "postgres",
        "--engine-version",
        "18.6",
        "--db-instance-class",
        "db.m8gd.large",
        "--vpc",
    )

    endpoint_service_names = [
        f"com.amazonaws.{REGION}.ecr.api",
        f"com.amazonaws.{REGION}.ecr.dkr",
        f"com.amazonaws.{REGION}.logs",
        f"com.amazonaws.{REGION}.s3",
        f"com.amazonaws.{REGION}.dynamodb",
    ]
    if require_kms_endpoint:
        endpoint_service_names.append(f"com.amazonaws.{REGION}.kms")
    endpoint_doc = cli.run_json(
        "ec2", "describe-vpc-endpoint-services", "--service-names", *endpoint_service_names
    )

    # Harmless regional endpoint probe; Express API-model support is checked locally.
    cli.run_json("ecs", "list-clusters", "--max-results", "1")

    vpcs = cli.run_json("ec2", "describe-vpcs")
    enis = cli.run_json("ec2", "describe-network-interfaces")
    security_groups = cli.run_json("ec2", "describe-security-groups")
    vpc_endpoints = cli.run_json("ec2", "describe-vpc-endpoints")
    albs = cli.run_json("elbv2", "describe-load-balancers")
    projects = cli.run_json("codebuild", "list-projects")
    tables = cli.run_json("dynamodb", "list-tables")
    rds_instances = cli.run_json("rds", "describe-db-instances")
    rds_snapshots = cli.run_json(
        "rds", "describe-db-snapshots", "--snapshot-type", "manual"
    )
    lambda_settings = cli.run_json("lambda", "get-account-settings")

    rds_instance_list = rds_instances.get("DBInstances") or []
    rds_allocated = sum(
        int(item.get("AllocatedStorage") or 0) for item in rds_instance_list
    )

    return {
        "awsCliVersion": version,
        "identity": identity,
        "region": region,
        "enabledAvailabilityZones": enabled_azs,
        "m7iOfferings": m7i,
        "rdsOrderableOptions": rds_doc.get("OrderableDBInstanceOptions") or [],
        "endpointServices": endpoint_doc.get("ServiceNames") or [],
        "ecsExpress": {
            "apiModelAvailable": cli.express_api_model_available(),
            "regionalEndpointReachable": True,
            "probe": "aws ecs list-clusters + local describe-express-gateway-service API model",
        },
        "quotas": {
            "fargate": service_quotas(cli, "fargate"),
            "ec2": service_quotas(cli, "ec2"),
            "rds": service_quotas(cli, "rds"),
            "elasticloadbalancing": service_quotas(cli, "elasticloadbalancing"),
            "vpc": service_quotas(cli, "vpc"),
            "codebuild": service_quotas(cli, "codebuild"),
            "dynamodb": service_quotas(cli, "dynamodb"),
        },
        "usage": {
            "vpcs": count_list(vpcs, "Vpcs"),
            "networkInterfaces": count_list(enis, "NetworkInterfaces"),
            "securityGroups": count_list(security_groups, "SecurityGroups"),
            "gatewayVpcEndpoints": sum(
                1
                for item in (vpc_endpoints.get("VpcEndpoints") or [])
                if item.get("VpcEndpointType") == "Gateway"
            ),
            "applicationLoadBalancers": sum(
                1
                for item in albs.get("LoadBalancers", [])
                if item.get("Type") == "application"
            ),
            "codebuildProjects": len(projects.get("projects") or []),
            "dynamodbTables": len(tables.get("TableNames") or []),
            "rdsInstances": len(rds_instance_list),
            "rdsAllocatedStorageGiB": rds_allocated,
            "rdsManualSnapshots": len(rds_snapshots.get("DBSnapshots") or []),
        },
        "lambdaAccountSettings": lambda_settings,
        "plannedIncidentMediatorMaxDbSessions": INCIDENT_MEDIATOR_MAX_DB_SESSIONS,
    }


def build_evidence_boundary(evidence_source: str, summary_status: str) -> dict[str, Any]:
    return {
        "resourceCreationPerformed": False,
        "liveAdmissionPassed": evidence_source == "live-aws"
        and summary_status == "PASS",
        # Passing this collector is necessary but not sufficient to create production
        # resources. The fresh cost gate and maintainer evidence disposition remain.
        "productionResourceCreationAuthorizedByThisReport": False,
        "resourceCreationBlockersRemaining": [
            "fresh exact-topology cost estimate must remain below the USD 900/month stop/review threshold",
            "maintainer disposition of the controlled live admission evidence",
        ],
        "postProvisionVerificationStillRequired": [
            "RDS IAM database authentication enabled on the created primary",
            "exact rds-db:connect resource identity and effective IAM policy",
            "live RDS max_connections / connection headroom including <=1 incident-mediator session",
            "real subnet available-IP counts and Lambda/CodeBuild ENI attachment",
            "real VPC endpoint policies and route-table associations",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read-only/no-create Platform v0.5 P1 AWS topology/quota admission collector."
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--region", default=REGION)
    parser.add_argument("--profile")
    parser.add_argument("--aws-binary", default="aws")
    parser.add_argument(
        "--private-subnet-cidr",
        action="append",
        dest="private_subnet_cidrs",
        required=True,
        help="Reviewed private app/control subnet CIDR; specify both planned CIDRs.",
    )
    parser.add_argument("--require-kms-interface-endpoint", action="store_true")
    parser.add_argument(
        "--fixture",
        type=Path,
        help="CI/test only: evaluate captured observations without invoking AWS; never live admission evidence.",
    )
    args = parser.parse_args()

    if args.region != REGION:
        raise SystemExit(f"P1_REGION_MUST_BE_{REGION}:{args.region}")

    try:
        evidence_source = "fixture" if args.fixture else "live-aws"
        if args.fixture:
            observed = json.loads(args.fixture.read_text(encoding="utf-8"))
        else:
            observed = collect(
                AwsCli(args.aws_binary, args.profile, args.region),
                args.require_kms_interface_endpoint,
            )
        checks, summary = evaluate(
            observed,
            args.private_subnet_cidrs,
            args.require_kms_interface_endpoint,
        )
    except (
        AdmissionError,
        OSError,
        json.JSONDecodeError,
        KeyError,
        TypeError,
        ValueError,
    ) as exc:
        raise SystemExit(f"P1_ADMISSION_COLLECTION_FAILED:{exc}") from exc

    report = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "fpllm-platform-v0.5-p1-readonly-admission",
        "generatedAt": utc_now(),
        "region": REGION,
        "readOnlyNoCreate": True,
        "evidenceSource": evidence_source,
        "vpcCidr": VPC_CIDR,
        "plannedSubnetCidrs": list(PLANNED_SUBNET_CIDRS),
        "privateApplicationControlSubnetCidrs": args.private_subnet_cidrs,
        "requireKmsInterfaceEndpoint": args.require_kms_interface_endpoint,
        "identity": observed.get("identity"),
        "awsCliVersion": observed.get("awsCliVersion"),
        "summary": summary,
        "checks": [check.to_dict() for check in checks],
        "observations": observed,
        "evidenceBoundary": build_evidence_boundary(evidence_source, summary["status"]),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    # The report is controlled operational evidence. It contains account identity and
    # current inventory metadata; default to owner-only permissions on POSIX systems.
    args.output.chmod(0o600)
    print(json.dumps(summary, sort_keys=True))
    return 0 if summary["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())

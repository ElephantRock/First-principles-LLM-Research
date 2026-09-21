from __future__ import annotations

import importlib.util
import json
import stat
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from subprocess import CompletedProcess
from unittest import mock

MODULE_PATH = Path(__file__).resolve().parents[1] / "ops" / "p1_readonly_admission.py"
SPEC = importlib.util.spec_from_file_location("p1_readonly_admission", MODULE_PATH)
assert SPEC and SPEC.loader
p1 = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = p1
SPEC.loader.exec_module(p1)

ACCOUNT = "123456789012"


def q(name: str, value: float, source: str = "applied") -> dict:
    return {"QuotaName": name, "Value": value, "fpllmValueSource": source}


def valid_observed() -> dict:
    now = p1.datetime.now(p1.timezone.utc).replace(microsecond=0)
    point = {"Timestamp": now.isoformat().replace("+00:00", "Z"), "Maximum": 0.0}
    return {
        "identity": {"Account": ACCOUNT, "Arn": f"arn:aws:sts::{ACCOUNT}:assumed-role/read-only/session"},
        "region": {"RegionName": p1.REGION, "OptInStatus": "opt-in-not-required"},
        "enabledAvailabilityZones": ["eu-west-1a", "eu-west-1b"],
        "m7iOfferings": ["eu-west-1a"],
        "rdsOrderableOptions": [{
            "Engine": "postgres", "EngineVersion": "18.6", "DBInstanceClass": "db.m8gd.large",
            "StorageType": "gp3", "Vpc": True, "SupportsStorageEncryption": True,
            "SupportsStorageAutoscaling": True, "SupportsIAMDatabaseAuthentication": True,
            "MinStorageSize": 20, "MaxStorageSize": 100,
            "AvailabilityZones": [{"Name": "eu-west-1a"}, {"Name": "eu-west-1b"}],
        }],
        "endpointServices": [
            "com.amazonaws.eu-west-1.ecr.api", "com.amazonaws.eu-west-1.ecr.dkr",
            "com.amazonaws.eu-west-1.logs", "com.amazonaws.eu-west-1.s3",
            "com.amazonaws.eu-west-1.dynamodb",
        ],
        "ecsExpress": {"cliCommandAvailable": True, "regionalApiRecognized": True, "probeOutcome": "expected-not-found"},
        "vcpuUsage": {
            "fargateOnDemand": {"telemetryComplete": True, "maximumObservedVcpu": 0.0, "datapoints": [point]},
            "ec2StandardOnDemand": {"telemetryComplete": True, "maximumObservedVcpu": 0.0, "datapoints": [point]},
        },
        "computeVcpuInventory": {
            "fargateOnDemand": {"observedVcpu": 0.0, "taskCount": 0, "tasks": []},
            "ec2StandardOnDemand": {
                "observedVcpu": 0.0, "instanceCount": 0, "instances": [],
                "capacityReservationCount": 0, "capacityReservations": [],
            },
            "verification": {
                "stable": True, "method": "direct-inventory-before-and-after-cloudwatch-window-read",
                "attemptsUsed": 1, "inventoryFingerprintSha256": "abc",
            },
        },
        "codebuildEnvironmentCapability": {"regionalApiReadSucceeded": True, "curatedLinuxDockerImageCount": 1},
        "quotas": {
            "fargate": [q("Fargate On-Demand vCPU resource count", 20)],
            "ec2": [q("Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances", 20)],
            "elasticloadbalancing": [q("Application Load Balancers per Region", 50)],
            "vpc": [
                q("VPCs per Region", 5), q("Subnets per VPC", 200),
                q("VPC security groups per Region", 2500), q("Network interfaces per Region", 5000),
                q("Interface VPC endpoints per VPC", 50), q("Gateway VPC endpoints per Region", 20),
            ],
            "codebuild": [q("Concurrently running builds for Linux/Large", 1), q("Build projects", 5000)],
            "dynamodb": [q("Maximum number of tables", 2500)],
            "rds": [q("DB instances", 40), q("Total storage for all DB instances", 100000), q("Manual DB instance snapshots", 100)],
        },
        "usage": {
            "vpcs": 0, "networkInterfaces": 0, "securityGroups": 0, "gatewayVpcEndpoints": 0,
            "applicationLoadBalancers": 0, "codebuildProjects": 0, "dynamodbTables": 0,
            "rdsInstances": 0, "rdsCommittedStorageGiB": 0, "rdsManualSnapshots": 0,
        },
        "lambdaAccountSettings": {"AccountLimit": {"ConcurrentExecutions": 1000, "UnreservedConcurrentExecutions": 1000}},
        "lambdaConcurrencyAllocations": {
            "functions": [], "functionCount": 0, "totalReservedConcurrency": 0,
            "totalProvisionedConcurrency": 0, "provisionedConcurrencyNotCoveredByReserved": 0,
        },
    }


class FakeCli:
    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []

    def run_json(self, service, operation, *args):
        self.calls.append((service, operation, args))
        value = self.responses.get((service, operation))
        if callable(value):
            return value(service, operation, *args)
        if isinstance(value, list):
            if not value:
                raise AssertionError(f"no response left for {(service, operation)}")
            return value.pop(0)
        if value is None:
            raise AssertionError(f"unexpected call {(service, operation, args)}")
        return value


class EvaluateTests(unittest.TestCase):
    def test_valid_fixture_passes(self):
        checks, summary = p1.evaluate(valid_observed(), list(p1.PLANNED_PRIVATE_CONTROL_CIDRS), False)
        self.assertEqual(summary["status"], "PASS")
        self.assertTrue(all(check.status == "PASS" for check in checks))

    def test_default_only_quota_is_rejected(self):
        observed = valid_observed()
        observed["quotas"]["fargate"][0]["fpllmValueSource"] = "aws-default"
        with self.assertRaises(p1.AdmissionError):
            p1.evaluate(observed, list(p1.PLANNED_PRIVATE_CONTROL_CIDRS), False)

    def test_regional_security_group_headroom_is_enforced(self):
        observed = valid_observed()
        observed["usage"]["securityGroups"] = 2493
        checks, summary = p1.evaluate(observed, list(p1.PLANNED_PRIVATE_CONTROL_CIDRS), False)
        self.assertEqual(summary["status"], "FAIL")
        check = next(item for item in checks if item.id == "quota.security-group-headroom")
        self.assertEqual(check.observed["free"], 7.0)

    def test_direct_compute_inventory_can_make_metric_green_case_fail(self):
        observed = valid_observed()
        observed["quotas"]["ec2"] = [q("Running On-Demand Standard", 4)]
        observed["computeVcpuInventory"]["ec2StandardOnDemand"]["observedVcpu"] = 4
        _, summary = p1.evaluate(observed, list(p1.PLANNED_PRIVATE_CONTROL_CIDRS), False)
        self.assertEqual(summary["status"], "FAIL")

    def test_fixture_pass_never_authorizes_resource_creation(self):
        boundary = p1.build_evidence_boundary("fixture", "PASS")
        self.assertFalse(boundary["liveAdmissionPassed"])
        self.assertFalse(boundary["productionResourceCreationAuthorizedByThisReport"])


class ReadOnlyBoundaryTests(unittest.TestCase):
    def test_mutating_operation_is_rejected(self):
        cli = p1.AwsCli("aws", None, p1.REGION)
        with self.assertRaises(p1.AdmissionError):
            cli._base_command("ec2", "run-instances")

    def test_compute_inventory_operations_are_read_only_allowlisted(self):
        required = {
            ("ec2", "describe-capacity-reservations"), ("ec2", "describe-instances"),
            ("ec2", "describe-instance-types"), ("ec2", "describe-security-groups"),
            ("ecs", "list-clusters"), ("ecs", "list-tasks"), ("ecs", "describe-tasks"),
            ("ecs", "describe-task-definition"), ("eks", "list-clusters"),
        }
        self.assertTrue(required.issubset(p1.READ_ONLY_AWS_OPERATIONS))


class CloudWatchTests(unittest.TestCase):
    def test_empty_window_is_unknown_not_zero(self):
        result = p1.collect_recent_vcpu_usage(FakeCli({("cloudwatch", "get-metric-statistics"): {"Datapoints": []}}), "EC2", "Standard/OnDemand")
        self.assertFalse(result["telemetryComplete"])
        self.assertIsNone(result["maximumObservedVcpu"])

    def test_fresh_window_uses_maximum(self):
        now = p1.datetime.now(p1.timezone.utc).replace(microsecond=0)
        cli = FakeCli({("cloudwatch", "get-metric-statistics"): {"Datapoints": [
            {"Timestamp": (now - timedelta(minutes=2)).isoformat(), "Maximum": 2},
            {"Timestamp": (now - timedelta(minutes=1)).isoformat(), "Maximum": 3},
        ]}})
        result = p1.collect_recent_vcpu_usage(cli, "EC2", "Standard/OnDemand")
        self.assertTrue(result["telemetryComplete"])
        self.assertEqual(result["maximumObservedVcpu"], 3.0)

    def test_stale_window_fails_closed(self):
        now = p1.datetime.now(p1.timezone.utc).replace(microsecond=0)
        cli = FakeCli({("cloudwatch", "get-metric-statistics"): {"Datapoints": [
            {"Timestamp": (now - timedelta(minutes=10)).isoformat(), "Maximum": 0}
        ]}})
        result = p1.collect_recent_vcpu_usage(cli, "EC2", "Standard/OnDemand")
        self.assertFalse(result["telemetryComplete"])
        self.assertIsNone(result["maximumObservedVcpu"])


class ComputeInventoryTests(unittest.TestCase):
    @staticmethod
    def instance_types(*names):
        return {"InstanceTypes": [{"InstanceType": name, "VCpuInfo": {"DefaultVCpus": 4}} for name in names]}

    def test_ec2_inventory_counts_owned_capacity_reservation_without_double_counting_covered_instance(self):
        cli = FakeCli({
            ("ec2", "describe-capacity-reservations"): {"CapacityReservations": [{
                "CapacityReservationId": "cr-1", "OwnerId": ACCOUNT, "State": "active",
                "ReservationType": "default", "InstanceType": "m7i.xlarge",
                "TotalInstanceCount": 2, "AvailableInstanceCount": 1, "Tenancy": "default",
            }]},
            ("ec2", "describe-instances"): {"Reservations": [{"Instances": [
                {"InstanceId": "i-covered", "InstanceType": "m7i.xlarge", "State": {"Name": "running"}, "CapacityReservationId": "cr-1"},
                {"InstanceId": "i-uncovered", "InstanceType": "m7i.xlarge", "State": {"Name": "running"}},
                {"InstanceId": "i-spot", "InstanceType": "m7i.xlarge", "State": {"Name": "running"}, "InstanceLifecycle": "spot"},
            ]}]},
            ("ec2", "describe-instance-types"): self.instance_types("m7i.xlarge"),
        })
        result = p1.collect_ec2_standard_inventory_once(cli, ACCOUNT)
        self.assertEqual(result["observedVcpu"], 12)
        self.assertEqual(result["capacityReservationCount"], 1)
        self.assertEqual(result["instanceCount"], 2)
        covered = next(item for item in result["instances"] if item["instanceId"] == "i-covered")
        self.assertTrue(covered["coveredByOwnedQuotaCountingCapacityReservation"])

    def test_ec2_inventory_ignores_capacity_blocks_and_noncounting_reservation_states(self):
        cli = FakeCli({
            ("ec2", "describe-capacity-reservations"): {"CapacityReservations": [
                {"CapacityReservationId": "cr-block", "OwnerId": ACCOUNT, "State": "active", "ReservationType": "capacity-block", "InstanceType": "m7i.xlarge", "TotalInstanceCount": 2, "AvailableInstanceCount": 2},
                {"CapacityReservationId": "cr-expired", "OwnerId": ACCOUNT, "State": "expired", "ReservationType": "default", "InstanceType": "m7i.xlarge", "TotalInstanceCount": 2, "AvailableInstanceCount": 0},
            ]},
            ("ec2", "describe-instances"): {"Reservations": []},
        })
        result = p1.collect_ec2_standard_inventory_once(cli, ACCOUNT)
        self.assertEqual(result["observedVcpu"], 0)
        self.assertEqual(result["capacityReservationCount"], 0)

    def test_fargate_inventory_includes_nonterminal_desired_stopped_task_and_excludes_terminal_or_spot(self):
        def list_tasks(_service, _operation, *args):
            status = args[args.index("--desired-status") + 1]
            return {"taskArns": ["t-running", "t-spot"] if status == "RUNNING" else ["t-stopping", "t-stopped"]}

        def describe_tasks(_service, _operation, *args):
            requested = set(args[args.index("--tasks") + 1 :])
            all_tasks = {
                "t-running": {"taskArn": "t-running", "desiredStatus": "RUNNING", "lastStatus": "RUNNING", "capacityProviderName": "FARGATE", "cpu": "1024"},
                "t-spot": {"taskArn": "t-spot", "desiredStatus": "RUNNING", "lastStatus": "RUNNING", "capacityProviderName": "FARGATE_SPOT", "cpu": "2048"},
                "t-stopping": {"taskArn": "t-stopping", "desiredStatus": "STOPPED", "lastStatus": "STOPPING", "launchType": "FARGATE", "cpu": "512"},
                "t-stopped": {"taskArn": "t-stopped", "desiredStatus": "STOPPED", "lastStatus": "STOPPED", "launchType": "FARGATE", "cpu": "4096"},
            }
            return {"failures": [], "tasks": [all_tasks[name] for name in sorted(requested)]}

        cli = FakeCli({
            ("eks", "list-clusters"): {"clusters": []},
            ("ecs", "list-clusters"): {"clusterArns": ["c1"]},
            ("ecs", "list-tasks"): list_tasks,
            ("ecs", "describe-tasks"): describe_tasks,
        })
        result = p1.collect_fargate_inventory_once(cli)
        self.assertEqual(result["taskCount"], 2)
        self.assertEqual(result["observedVcpu"], 1.5)
        self.assertEqual({item["taskArn"] for item in result["tasks"]}, {"t-running", "t-stopping"})

    def test_eks_presence_fails_closed_for_fargate_inventory(self):
        with self.assertRaises(p1.AdmissionError):
            p1.collect_fargate_inventory_once(FakeCli({("eks", "list-clusters"): {"clusters": ["other"]}}))

    def test_compute_bracket_retries_inventory_race(self):
        a = {"fargateOnDemand": {"observedVcpu": 0}, "ec2StandardOnDemand": {"observedVcpu": 0}}
        b = {"fargateOnDemand": {"observedVcpu": 1}, "ec2StandardOnDemand": {"observedVcpu": 0}}
        usage = {"telemetryComplete": True, "maximumObservedVcpu": 0}
        with mock.patch.object(p1, "_compute_inventory_once", side_effect=[a, b, b, b]), mock.patch.object(p1, "collect_recent_vcpu_usage", return_value=usage):
            result = p1.collect_bracketed_compute_snapshot(object(), ACCOUNT, max_attempts=2)
        self.assertEqual(result["computeVcpuInventory"]["verification"]["attemptsUsed"], 2)


class ExpressProbeTests(unittest.TestCase):
    def _probe(self, stderr):
        cli = p1.AwsCli("aws", None, p1.REGION)
        with mock.patch.object(cli, "_run", return_value=CompletedProcess(["aws"], 255, "", stderr)):
            return cli.probe_express_gateway_service(ACCOUNT)

    def test_resource_not_found_proves_api_recognized(self):
        self.assertTrue(self._probe("ResourceNotFoundException: resource not found")["regionalApiRecognized"])

    def test_unsupported_feature_is_red(self):
        self.assertFalse(self._probe("UnsupportedFeatureException: not available")["regionalApiRecognized"])

    def test_access_denied_fails_collection(self):
        cli = p1.AwsCli("aws", None, p1.REGION)
        with mock.patch.object(cli, "_run", return_value=CompletedProcess(["aws"], 255, "", "AccessDeniedException")):
            with self.assertRaises(p1.AdmissionError):
                cli.probe_express_gateway_service(ACCOUNT)


class QuotaAndLambdaTests(unittest.TestCase):
    def test_applied_quota_overrides_default_by_code(self):
        cli = FakeCli({
            ("service-quotas", "list-service-quotas"): {"Quotas": [{"QuotaCode": "L-1", "QuotaName": "VPC security groups per Region", "Value": 2500}]},
            ("service-quotas", "list-aws-default-service-quotas"): {"Quotas": [{"QuotaCode": "L-1", "QuotaName": "VPC security groups per Region", "Value": 5}]},
        })
        result = p1.service_quotas(cli, "vpc")
        self.assertEqual(result[0]["Value"], 2500)
        self.assertEqual(result[0]["fpllmValueSource"], "applied")

    def test_lambda_two_identical_bracketed_samples_pass(self):
        account = {"AccountLimit": {"ConcurrentExecutions": 1000, "UnreservedConcurrentExecutions": 1000}}
        allocations = {"functions": [], "functionCount": 0, "totalReservedConcurrency": 0, "totalProvisionedConcurrency": 0, "provisionedConcurrencyNotCoveredByReserved": 0}
        cli = FakeCli({("lambda", "get-account-settings"): [account, account, account, account]})
        with mock.patch.object(p1, "collect_lambda_concurrency_allocations", return_value=allocations):
            result = p1.collect_stable_lambda_concurrency_snapshot(cli, max_attempts=2)
        self.assertTrue(result["verification"]["stable"])


class CodeBuildTests(unittest.TestCase):
    def test_linux_curated_catalog_is_recognized(self):
        result = p1.summarize_codebuild_environment_capability({"platforms": [{
            "platform": "AMAZON_LINUX", "languages": [{"language": "STANDARD", "images": [{"name": "aws/codebuild/standard", "versions": ["7.0"]}]}]
        }]})
        self.assertEqual(result["curatedLinuxDockerImageCount"], 1)


class EvidenceEnvelopeTests(unittest.TestCase):
    def _assert_consistent(self, path: Path):
        envelope = json.loads(path.read_text(encoding="utf-8"))
        digest = p1.hashlib.sha256(p1.report_payload_bytes(envelope["report"])).hexdigest()
        self.assertEqual(envelope["reportSha256"], digest)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertFalse(path.with_name(f"{path.name}.sha256").exists())
        return envelope

    def test_write_report_publishes_single_self_verifying_generation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "admission.json"
            digest = p1.write_report(path, {"generation": 1})
            self.assertEqual(self._assert_consistent(path)["reportSha256"], digest)

    def test_interrupted_replace_preserves_previous_generation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "admission.json"
            p1.write_report(path, {"generation": 1})
            before = path.read_bytes()
            with mock.patch.object(p1.os, "replace", side_effect=OSError("simulated interruption")):
                with self.assertRaises(OSError):
                    p1.write_report(path, {"generation": 2})
            self.assertEqual(path.read_bytes(), before)
            self._assert_consistent(path)

    def test_concurrent_writers_never_cross_pair_report_and_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "admission.json"
            barrier = threading.Barrier(6)
            def writer(generation):
                barrier.wait()
                return p1.write_report(path, {"generation": generation, "payload": "x" * generation})
            with ThreadPoolExecutor(max_workers=6) as pool:
                list(pool.map(writer, range(1, 7)))
            envelope = self._assert_consistent(path)
            self.assertIn(envelope["report"]["generation"], range(1, 7))


if __name__ == "__main__":
    unittest.main()

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
    usage_point = {
        "Timestamp": now.isoformat().replace("+00:00", "Z"),
        "Maximum": 0.0,
    }
    return {
        "identity": {
            "Account": ACCOUNT,
            "Arn": f"arn:aws:sts::{ACCOUNT}:assumed-role/read-only/session",
        },
        "region": {"RegionName": p1.REGION, "OptInStatus": "opt-in-not-required"},
        "enabledAvailabilityZones": ["eu-west-1a", "eu-west-1b"],
        "m7iOfferings": ["eu-west-1a"],
        "rdsOrderableOptions": [
            {
                "Engine": "postgres",
                "EngineVersion": "18.6",
                "DBInstanceClass": "db.m8gd.large",
                "StorageType": "gp3",
                "Vpc": True,
                "SupportsStorageEncryption": True,
                "SupportsStorageAutoscaling": True,
                "SupportsIAMDatabaseAuthentication": True,
                "MinStorageSize": 20,
                "MaxStorageSize": 100,
                "AvailabilityZones": [{"Name": "eu-west-1a"}, {"Name": "eu-west-1b"}],
            }
        ],
        "endpointServices": [
            "com.amazonaws.eu-west-1.ecr.api",
            "com.amazonaws.eu-west-1.ecr.dkr",
            "com.amazonaws.eu-west-1.logs",
            "com.amazonaws.eu-west-1.s3",
            "com.amazonaws.eu-west-1.dynamodb",
        ],
        "ecsExpress": {
            "cliCommandAvailable": True,
            "regionalApiRecognized": True,
            "probeOutcome": "expected-not-found",
        },
        "vcpuUsage": {
            "fargateOnDemand": {
                "telemetryComplete": True,
                "maximumObservedVcpu": 0.0,
                "datapoints": [usage_point],
            },
            "ec2StandardOnDemand": {
                "telemetryComplete": True,
                "maximumObservedVcpu": 0.0,
                "datapoints": [usage_point],
            },
        },
        "computeVcpuInventory": {
            "fargateOnDemand": {"observedVcpu": 0.0, "taskCount": 0, "tasks": []},
            "ec2StandardOnDemand": {
                "observedVcpu": 0.0,
                "instanceCount": 0,
                "instances": [],
                "capacityReservationCount": 0,
                "capacityReservations": [],
            },
            "verification": {
                "stable": True,
                "method": "direct-inventory-before-and-after-cloudwatch-window-read",
                "attemptsUsed": 1,
                "inventoryFingerprintSha256": "abc",
            },
        },
        "codebuildEnvironmentCapability": {
            "regionalApiReadSucceeded": True,
            "curatedLinuxDockerImageCount": 1,
        },
        "quotas": {
            "fargate": [q("Fargate On-Demand vCPU resource count", 20)],
            "ec2": [
                q(
                    "Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances",
                    20,
                )
            ],
            "elasticloadbalancing": [q("Application Load Balancers per Region", 50)],
            "vpc": [
                q("VPCs per Region", 5),
                q("Subnets per VPC", 200),
                q("VPC security groups per Region", 2500),
                q("Network interfaces per Region", 5000),
                q("Interface VPC endpoints per VPC", 50),
                q("Gateway VPC endpoints per Region", 20),
            ],
            "codebuild": [
                q("Concurrently running builds for Linux/Large", 1),
                q("Build projects", 5000),
            ],
            "dynamodb": [q("Maximum number of tables", 2500)],
            "rds": [
                q("DB instances", 40),
                q("Total storage for all DB instances", 100000),
                q("Manual DB instance snapshots", 100),
            ],
        },
        "usage": {
            "vpcs": 0,
            "networkInterfaces": 0,
            "securityGroups": 0,
            "gatewayVpcEndpoints": 0,
            "applicationLoadBalancers": 0,
            "codebuildProjects": 0,
            "dynamodbTables": 0,
            "rdsInstances": 0,
            "rdsCommittedStorageGiB": 0,
            "rdsManualSnapshots": 0,
        },
        "lambdaAccountSettings": {
            "AccountLimit": {
                "ConcurrentExecutions": 1000,
                "UnreservedConcurrentExecutions": 1000,
            }
        },
        "lambdaConcurrencyAllocations": {
            "functions": [],
            "functionCount": 0,
            "totalReservedConcurrency": 0,
            "totalProvisionedConcurrency": 0,
            "provisionedConcurrencyNotCoveredByReserved": 0,
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
        checks, summary = p1.evaluate(
            valid_observed(), list(p1.PLANNED_PRIVATE_CONTROL_CIDRS), False
        )
        self.assertEqual(summary["status"], "PASS")
        self.assertTrue(all(item.status == "PASS" for item in checks))

    def test_real_regional_security_group_quota_is_required(self):
        observed = valid_observed()
        observed["quotas"]["vpc"] = [
            item
            for item in observed["quotas"]["vpc"]
            if item["QuotaName"] != "VPC security groups per Region"
        ] + [q("Security groups per VPC", 2500)]
        with self.assertRaises(p1.AdmissionError):
            p1.evaluate(observed, list(p1.PLANNED_PRIVATE_CONTROL_CIDRS), False)

    def test_security_group_check_subtracts_regional_inventory(self):
        observed = valid_observed()
        observed["usage"]["securityGroups"] = 2493
        checks, summary = p1.evaluate(
            observed, list(p1.PLANNED_PRIVATE_CONTROL_CIDRS), False
        )
        self.assertEqual(summary["status"], "FAIL")
        sg = next(c for c in checks if c.id == "quota.security-group-headroom")
        self.assertEqual(sg.status, "FAIL")
        self.assertEqual(sg.observed["free"], 7.0)

    def test_direct_fargate_inventory_catches_launch_newer_than_metric(self):
        observed = valid_observed()
        observed["quotas"]["fargate"] = [q("Fargate On-Demand vCPU resource count", 6)]
        observed["vcpuUsage"]["fargateOnDemand"]["maximumObservedVcpu"] = 0
        observed["computeVcpuInventory"]["fargateOnDemand"]["observedVcpu"] = 1
        checks, summary = p1.evaluate(
            observed, list(p1.PLANNED_PRIVATE_CONTROL_CIDRS), False
        )
        self.assertEqual(summary["status"], "FAIL")
        check = next(c for c in checks if c.id == "quota.fargate-ondemand-vcpu-headroom")
        self.assertEqual(check.status, "FAIL")
        self.assertEqual(check.observed["effectiveObservedVcpu"], 1.0)

    def test_direct_ec2_inventory_catches_launch_newer_than_metric(self):
        observed = valid_observed()
        observed["quotas"]["ec2"] = [q("Running On-Demand Standard", 4)]
        observed["vcpuUsage"]["ec2StandardOnDemand"]["maximumObservedVcpu"] = 0
        observed["computeVcpuInventory"]["ec2StandardOnDemand"]["observedVcpu"] = 4
        checks, summary = p1.evaluate(
            observed, list(p1.PLANNED_PRIVATE_CONTROL_CIDRS), False
        )
        self.assertEqual(summary["status"], "FAIL")
        check = next(c for c in checks if c.id == "quota.ec2-standard-ondemand-vcpu-headroom")
        self.assertEqual(check.status, "FAIL")
        self.assertEqual(check.observed["effectiveObservedVcpu"], 4.0)

    def test_unstable_compute_inventory_fails_closed(self):
        observed = valid_observed()
        observed["computeVcpuInventory"]["verification"]["stable"] = False
        _, summary = p1.evaluate(
            observed, list(p1.PLANNED_PRIVATE_CONTROL_CIDRS), False
        )
        self.assertEqual(summary["status"], "FAIL")

    def test_default_only_quota_is_rejected(self):
        observed = valid_observed()
        observed["quotas"]["fargate"][0]["fpllmValueSource"] = "aws-default"
        with self.assertRaises(p1.AdmissionError):
            p1.evaluate(observed, list(p1.PLANNED_PRIVATE_CONTROL_CIDRS), False)

    def test_fixture_pass_never_authorizes_resource_creation(self):
        boundary = p1.build_evidence_boundary("fixture", "PASS")
        self.assertFalse(boundary["liveAdmissionPassed"])
        self.assertFalse(boundary["productionResourceCreationAuthorizedByThisReport"])


class ReadOnlyBoundaryTests(unittest.TestCase):
    def test_mutating_operation_is_rejected(self):
        cli = p1.AwsCli("aws", None, p1.REGION)
        with self.assertRaises(p1.AdmissionError):
            cli._base_command("ec2", "run-instances")

    def test_new_inventory_operations_are_read_only(self):
        required = {
            ("ec2", "describe-capacity-reservations"),
            ("ec2", "describe-instances"),
            ("ec2", "describe-instance-types"),
            ("ec2", "describe-security-groups"),
            ("ecs", "list-clusters"),
            ("ecs", "list-tasks"),
            ("ecs", "describe-tasks"),
            ("ecs", "describe-task-definition"),
            ("eks", "list-clusters"),
        }
        self.assertTrue(required.issubset(p1.READ_ONLY_AWS_OPERATIONS))


class CloudWatchTests(unittest.TestCase):
    def test_empty_window_is_unknown_not_zero(self):
        cli = FakeCli({("cloudwatch", "get-metric-statistics"): {"Datapoints": []}})
        result = p1.collect_recent_vcpu_usage(cli, "EC2", "Standard/OnDemand")
        self.assertFalse(result["telemetryComplete"])
        self.assertIsNone(result["maximumObservedVcpu"])

    def test_fresh_window_uses_maximum(self):
        now = p1.datetime.now(p1.timezone.utc).replace(microsecond=0)
        cli = FakeCli(
            {
                ("cloudwatch", "get-metric-statistics"): {
                    "Datapoints": [
                        {
                            "Timestamp": (now - timedelta(minutes=2)).isoformat(),
                            "Maximum": 2,
                        },
                        {
                            "Timestamp": (now - timedelta(minutes=1)).isoformat(),
                            "Maximum": 3,
                        },
                    ]
                }
            }
        )
        result = p1.collect_recent_vcpu_usage(cli, "EC2", "Standard/OnDemand")
        self.assertTrue(result["telemetryComplete"])
        self.assertEqual(result["maximumObservedVcpu"], 3.0)

    def test_stale_window_fails_closed(self):
        now = p1.datetime.now(p1.timezone.utc).replace(microsecond=0)
        cli = FakeCli(
            {
                ("cloudwatch", "get-metric-statistics"): {
                    "Datapoints": [
                        {
                            "Timestamp": (now - timedelta(minutes=10)).isoformat(),
                            "Maximum": 0,
                        }
                    ]
                }
            }
        )
        result = p1.collect_recent_vcpu_usage(cli, "EC2", "Standard/OnDemand")
        self.assertFalse(result["telemetryComplete"])
        self.assertIsNone(result["maximumObservedVcpu"])


class ComputeInventoryTests(unittest.TestCase):
    @staticmethod
    def _instance_types(*names):
        return {
            "InstanceTypes": [
                {"InstanceType": name, "VCpuInfo": {"DefaultVCpus": 4}} for name in names
            ]
        }

    def test_ec2_inventory_counts_only_standard_on_demand(self):
        cli = FakeCli(
            {
                ("ec2", "describe-capacity-reservations"): {"CapacityReservations": []},
                ("ec2", "describe-instances"): {
                    "Reservations": [
                        {
                            "Instances": [
                                {
                                    "InstanceId": "i-1",
                                    "InstanceType": "m7i.xlarge",
                                    "State": {"Name": "running"},
                                },
                                {
                                    "InstanceId": "i-2",
                                    "InstanceType": "m7i.xlarge",
                                    "State": {"Name": "running"},
                                    "InstanceLifecycle": "spot",
                                },
                                {
                                    "InstanceId": "i-3",
                                    "InstanceType": "g6.xlarge",
                                    "State": {"Name": "running"},
                                },
                            ]
                        }
                    ]
                },
                ("ec2", "describe-instance-types"): self._instance_types("m7i.xlarge"),
            }
        )
        result = p1.collect_ec2_standard_inventory_once(cli, ACCOUNT)
        self.assertEqual(result["observedVcpu"], 4)
        self.assertEqual(result["instanceCount"], 1)
        self.assertEqual(result["instances"][0]["instanceId"], "i-1")

    def test_pending_ec2_instance_does_not_count_toward_ondemand_quota(self):
        cli = FakeCli(
            {
                ("ec2", "describe-capacity-reservations"): {"CapacityReservations": []},
                ("ec2", "describe-instances"): {
                    "Reservations": [
                        {
                            "Instances": [
                                {
                                    "InstanceId": "i-pending",
                                    "InstanceType": "m7i.xlarge",
                                    "State": {"Name": "pending"},
                                }
                            ]
                        }
                    ]
                },
            }
        )
        result = p1.collect_ec2_standard_inventory_once(cli, ACCOUNT)
        self.assertEqual(result["observedVcpu"], 0)
        self.assertEqual(result["instanceCount"], 0)

    def test_ec2_inventory_counts_owned_capacity_reservation_without_double_counting(self):
        cli = FakeCli(
            {
                ("ec2", "describe-capacity-reservations"): {
                    "CapacityReservations": [
                        {
                            "CapacityReservationId": "cr-1",
                            "OwnerId": ACCOUNT,
                            "State": "active",
                            "ReservationType": "default",
                            "InstanceType": "m7i.xlarge",
                            "TotalInstanceCount": 2,
                            "AvailableInstanceCount": 1,
                            "Tenancy": "default",
                        }
                    ]
                },
                ("ec2", "describe-instances"): {
                    "Reservations": [
                        {
                            "Instances": [
                                {
                                    "InstanceId": "i-covered",
                                    "InstanceType": "m7i.xlarge",
                                    "State": {"Name": "running"},
                                    "CapacityReservationId": "cr-1",
                                },
                                {
                                    "InstanceId": "i-uncovered",
                                    "InstanceType": "m7i.xlarge",
                                    "State": {"Name": "running"},
                                },
                            ]
                        }
                    ]
                },
                ("ec2", "describe-instance-types"): self._instance_types("m7i.xlarge"),
            }
        )
        result = p1.collect_ec2_standard_inventory_once(cli, ACCOUNT)
        self.assertEqual(result["observedVcpu"], 12)
        self.assertEqual(result["capacityReservationCount"], 1)
        self.assertEqual(result["instanceCount"], 2)
        covered = next(item for item in result["instances"] if item["instanceId"] == "i-covered")
        self.assertTrue(covered["coveredByOwnedQuotaCountingCapacityReservation"])

    def test_ec2_inventory_excludes_capacity_blocks_and_noncounting_states(self):
        cli = FakeCli(
            {
                ("ec2", "describe-capacity-reservations"): {
                    "CapacityReservations": [
                        {
                            "CapacityReservationId": "cr-block",
                            "OwnerId": ACCOUNT,
                            "State": "active",
                            "ReservationType": "capacity-block",
                            "InstanceType": "m7i.xlarge",
                            "TotalInstanceCount": 2,
                            "AvailableInstanceCount": 2,
                        },
                        {
                            "CapacityReservationId": "cr-expired",
                            "OwnerId": ACCOUNT,
                            "State": "expired",
                            "ReservationType": "default",
                            "InstanceType": "m7i.xlarge",
                            "TotalInstanceCount": 2,
                            "AvailableInstanceCount": 0,
                        },
                    ]
                },
                ("ec2", "describe-instances"): {"Reservations": []},
            }
        )
        result = p1.collect_ec2_standard_inventory_once(cli, ACCOUNT)
        self.assertEqual(result["observedVcpu"], 0)
        self.assertEqual(result["capacityReservationCount"], 0)

    def test_fargate_inventory_counts_on_demand_not_spot(self):
        def list_tasks(_service, _operation, *args):
            status = args[args.index("--desired-status") + 1]
            return {"taskArns": ["t1", "t2"] if status == "RUNNING" else []}

        cli = FakeCli(
            {
                ("eks", "list-clusters"): {"clusters": []},
                ("ecs", "list-clusters"): {"clusterArns": ["c1"]},
                ("ecs", "list-tasks"): list_tasks,
                ("ecs", "describe-tasks"): {
                    "failures": [],
                    "tasks": [
                        {
                            "taskArn": "t1",
                            "desiredStatus": "RUNNING",
                            "lastStatus": "RUNNING",
                            "capacityProviderName": "FARGATE",
                            "cpu": "1024",
                        },
                        {
                            "taskArn": "t2",
                            "desiredStatus": "RUNNING",
                            "lastStatus": "RUNNING",
                            "capacityProviderName": "FARGATE_SPOT",
                            "cpu": "2048",
                        },
                    ],
                },
            }
        )
        result = p1.collect_fargate_inventory_once(cli)
        self.assertEqual(result["observedVcpu"], 1.0)
        self.assertEqual(result["taskCount"], 1)

    def test_fargate_inventory_counts_stopping_desired_stopped_but_not_terminal_stopped(self):
        def list_tasks(_service, _operation, *args):
            status = args[args.index("--desired-status") + 1]
            return {"taskArns": [] if status == "RUNNING" else ["t-stopping", "t-stopped"]}

        cli = FakeCli(
            {
                ("eks", "list-clusters"): {"clusters": []},
                ("ecs", "list-clusters"): {"clusterArns": ["c1"]},
                ("ecs", "list-tasks"): list_tasks,
                ("ecs", "describe-tasks"): {
                    "failures": [],
                    "tasks": [
                        {
                            "taskArn": "t-stopping",
                            "desiredStatus": "STOPPED",
                            "lastStatus": "STOPPING",
                            "launchType": "FARGATE",
                            "cpu": "512",
                        },
                        {
                            "taskArn": "t-stopped",
                            "desiredStatus": "STOPPED",
                            "lastStatus": "STOPPED",
                            "launchType": "FARGATE",
                            "cpu": "4096",
                        },
                    ],
                },
            }
        )
        result = p1.collect_fargate_inventory_once(cli)
        self.assertEqual(result["observedVcpu"], 0.5)
        self.assertEqual(result["taskCount"], 1)
        self.assertEqual(result["tasks"][0]["taskArn"], "t-stopping")

    def test_eks_presence_fails_closed_for_complete_fargate_inventory(self):
        cli = FakeCli({("eks", "list-clusters"): {"clusters": ["other"]}})
        with self.assertRaises(p1.AdmissionError):
            p1.collect_fargate_inventory_once(cli)

    def test_compute_bracket_retries_inventory_race(self):
        inventory_a = {
            "fargateOnDemand": {"observedVcpu": 0, "tasks": []},
            "ec2StandardOnDemand": {"observedVcpu": 0, "instances": []},
        }
        inventory_b = {
            "fargateOnDemand": {"observedVcpu": 1, "tasks": [{"taskArn": "new"}]},
            "ec2StandardOnDemand": {"observedVcpu": 0, "instances": []},
        }
        stable_usage = {"telemetryComplete": True, "maximumObservedVcpu": 0}
        sequence = [inventory_a, inventory_b, inventory_b, inventory_b]
        with mock.patch.object(
            p1, "_compute_inventory_once", side_effect=sequence
        ), mock.patch.object(p1._core, "collect_recent_vcpu_usage", return_value=stable_usage):
            result = p1.collect_bracketed_compute_snapshot(object(), ACCOUNT, max_attempts=2)
        self.assertTrue(result["computeVcpuInventory"]["verification"]["stable"])
        self.assertEqual(result["computeVcpuInventory"]["verification"]["attemptsUsed"], 2)
        self.assertEqual(
            result["computeVcpuInventory"]["fargateOnDemand"]["observedVcpu"], 1
        )

    def test_compute_bracket_refuses_persistent_race(self):
        counter = {"n": 0}

        def changing(_cli, _account):
            counter["n"] += 1
            return {
                "fargateOnDemand": {"observedVcpu": counter["n"], "tasks": []},
                "ec2StandardOnDemand": {"observedVcpu": 0, "instances": []},
            }

        stable_usage = {"telemetryComplete": True, "maximumObservedVcpu": 0}
        with mock.patch.object(
            p1, "_compute_inventory_once", side_effect=changing
        ), mock.patch.object(p1._core, "collect_recent_vcpu_usage", return_value=stable_usage):
            with self.assertRaises(p1.AdmissionError):
                p1.collect_bracketed_compute_snapshot(object(), ACCOUNT, max_attempts=2)


class ExpressProbeTests(unittest.TestCase):
    def _probe_with_stderr(self, stderr):
        cli = p1.AwsCli("aws", None, p1.REGION)
        with mock.patch.object(
            cli,
            "_run",
            return_value=CompletedProcess(["aws"], 255, "", stderr),
        ):
            return cli.probe_express_gateway_service(ACCOUNT)

    def test_resource_not_found_proves_api_recognized(self):
        result = self._probe_with_stderr("ResourceNotFoundException: resource not found")
        self.assertTrue(result["regionalApiRecognized"])

    def test_unsupported_feature_is_red(self):
        result = self._probe_with_stderr("UnsupportedFeatureException: not available")
        self.assertFalse(result["regionalApiRecognized"])

    def test_access_denied_fails_collection(self):
        cli = p1.AwsCli("aws", None, p1.REGION)
        with mock.patch.object(
            cli,
            "_run",
            return_value=CompletedProcess(["aws"], 255, "", "AccessDeniedException"),
        ):
            with self.assertRaises(p1.AdmissionError):
                cli.probe_express_gateway_service(ACCOUNT)


class QuotaTests(unittest.TestCase):
    def test_applied_overrides_default_by_code(self):
        cli = FakeCli(
            {
                ("service-quotas", "list-service-quotas"): {
                    "Quotas": [
                        {
                            "QuotaCode": "L-1",
                            "QuotaName": "VPC security groups per Region",
                            "Value": 2500,
                        }
                    ]
                },
                ("service-quotas", "list-aws-default-service-quotas"): {
                    "Quotas": [
                        {
                            "QuotaCode": "L-1",
                            "QuotaName": "VPC security groups per Region",
                            "Value": 5,
                        }
                    ]
                },
            }
        )
        result = p1.service_quotas(cli, "vpc")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["Value"], 2500)
        self.assertEqual(result[0]["fpllmValueSource"], "applied")


class LambdaSnapshotTests(unittest.TestCase):
    def test_two_identical_bracketed_samples_pass(self):
        account = {
            "AccountLimit": {
                "ConcurrentExecutions": 1000,
                "UnreservedConcurrentExecutions": 1000,
            }
        }
        allocations = {
            "functions": [],
            "functionCount": 0,
            "totalReservedConcurrency": 0,
            "totalProvisionedConcurrency": 0,
            "provisionedConcurrencyNotCoveredByReserved": 0,
        }
        cli = FakeCli(
            {("lambda", "get-account-settings"): [account, account, account, account]}
        )
        with mock.patch.object(
            p1._core, "collect_lambda_concurrency_allocations", return_value=allocations
        ):
            result = p1.collect_stable_lambda_concurrency_snapshot(cli, max_attempts=2)
        self.assertTrue(result["verification"]["stable"])
        self.assertEqual(result["verification"]["attemptsUsed"], 2)

    def test_changed_allocations_do_not_false_pass(self):
        account = {
            "AccountLimit": {
                "ConcurrentExecutions": 1000,
                "UnreservedConcurrentExecutions": 1000,
            }
        }
        cli = FakeCli({("lambda", "get-account-settings"): [account] * 6})
        allocations = [
            {
                "functions": [{"functionName": "a"}],
                "functionCount": 1,
                "totalReservedConcurrency": 0,
                "totalProvisionedConcurrency": 0,
                "provisionedConcurrencyNotCoveredByReserved": 0,
            },
            {
                "functions": [{"functionName": "a", "provisionedConcurrencyClaim": 2}],
                "functionCount": 1,
                "totalReservedConcurrency": 0,
                "totalProvisionedConcurrency": 2,
                "provisionedConcurrencyNotCoveredByReserved": 2,
            },
            {
                "functions": [{"functionName": "a", "provisionedConcurrencyClaim": 3}],
                "functionCount": 1,
                "totalReservedConcurrency": 0,
                "totalProvisionedConcurrency": 3,
                "provisionedConcurrencyNotCoveredByReserved": 3,
            },
        ]
        with mock.patch.object(
            p1._core, "collect_lambda_concurrency_allocations", side_effect=allocations
        ):
            with self.assertRaises(p1.AdmissionError):
                p1.collect_stable_lambda_concurrency_snapshot(cli, max_attempts=3)


class CodeBuildTests(unittest.TestCase):
    def test_linux_curated_catalog_is_recognized(self):
        result = p1.summarize_codebuild_environment_capability(
            {
                "platforms": [
                    {
                        "platform": "AMAZON_LINUX",
                        "languages": [
                            {
                                "language": "STANDARD",
                                "images": [
                                    {"name": "aws/codebuild/standard", "versions": ["7.0"]}
                                ],
                            }
                        ],
                    }
                ]
            }
        )
        self.assertEqual(result["curatedLinuxDockerImageCount"], 1)


class EvidenceEnvelopeTests(unittest.TestCase):
    def _assert_envelope_consistent(self, path: Path):
        envelope = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(envelope["kind"], "fpllm-controlled-evidence-envelope")
        digest = p1.hashlib.sha256(p1.report_payload_bytes(envelope["report"])).hexdigest()
        self.assertEqual(envelope["reportSha256"], digest)
        self.assertFalse(path.with_name(f"{path.name}.sha256").exists())
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        return envelope

    def test_write_report_publishes_single_self_verifying_generation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "admission.json"
            digest = p1.write_report(path, {"generation": 1})
            envelope = self._assert_envelope_consistent(path)
            self.assertEqual(envelope["reportSha256"], digest)

    def test_interrupted_replace_preserves_previous_generation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "admission.json"
            p1.write_report(path, {"generation": 1})
            before = path.read_bytes()
            with mock.patch.object(
                p1.os, "replace", side_effect=OSError("simulated interruption")
            ):
                with self.assertRaises(OSError):
                    p1.write_report(path, {"generation": 2})
            self.assertEqual(path.read_bytes(), before)
            self._assert_envelope_consistent(path)
            self.assertFalse(list(path.parent.glob(f".{path.name}.tmp-*")))

    def test_concurrent_writers_cannot_cross_pair_report_and_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "admission.json"
            barrier = threading.Barrier(8)

            def writer(generation):
                barrier.wait()
                return p1.write_report(
                    path, {"generation": generation, "payload": "x" * generation}
                )

            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(writer, range(1, 9)))
            envelope = self._assert_envelope_consistent(path)
            self.assertIn(envelope["report"]["generation"], range(1, 9))


if __name__ == "__main__":
    unittest.main()

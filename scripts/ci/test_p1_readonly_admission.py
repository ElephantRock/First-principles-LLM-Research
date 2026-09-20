from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "ops" / "p1_readonly_admission.py"
spec = importlib.util.spec_from_file_location("p1_readonly_admission", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def quota(name: str, value: float) -> dict[str, object]:
    return {"QuotaName": name, "Value": value}


def passing_observation() -> dict[str, object]:
    return {
        "awsCliVersion": "aws-cli/2.31.0 Python/3.13 Linux/6.8",
        "identity": {
            "Account": "123456789012",
            "Arn": "arn:aws:iam::123456789012:role/read-only",
        },
        "region": {
            "RegionName": "eu-west-1",
            "OptInStatus": "opt-in-not-required",
        },
        "enabledAvailabilityZones": ["eu-west-1a", "eu-west-1b", "eu-west-1c"],
        "m7iOfferings": ["eu-west-1a", "eu-west-1b"],
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
                "MaxStorageSize": 65536,
                "AvailabilityZones": [
                    {"Name": "eu-west-1a"},
                    {"Name": "eu-west-1b"},
                ],
            }
        ],
        "endpointServices": [
            "com.amazonaws.eu-west-1.ecr.api",
            "com.amazonaws.eu-west-1.ecr.dkr",
            "com.amazonaws.eu-west-1.logs",
            "com.amazonaws.eu-west-1.kms",
            "com.amazonaws.eu-west-1.s3",
            "com.amazonaws.eu-west-1.dynamodb",
        ],
        "ecsExpress": {
            "apiModelAvailable": True,
            "regionalEndpointReachable": True,
            "probe": "fixture",
        },
        "quotas": {
            "fargate": [quota("Fargate On-Demand vCPU resource count", 6)],
            "ec2": [
                quota(
                    "Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances",
                    16,
                )
            ],
            "rds": [
                quota("DB instances", 40),
                quota("Total storage for all DB instances", 100000),
                quota("Manual DB instance snapshots", 100),
                quota("Subnets per DB subnet group", 20),
                quota("Reserved DB instances", 40),
            ],
            "elasticloadbalancing": [
                quota("Application Load Balancers per Region", 50)
            ],
            "vpc": [
                quota("VPCs per Region", 5),
                quota("Subnets per VPC", 200),
                quota("VPC security groups per Region", 2500),
                quota("Network interfaces per Region", 5000),
                quota("Interface VPC endpoints per VPC", 50),
                quota("Gateway VPC endpoints per Region", 20),
            ],
            "codebuild": [
                quota("Concurrently running builds for Linux/Large environment", 1),
                quota("Build projects", 5000),
                quota("Security groups under VPC configuration", 5),
                quota("Subnets under VPC configuration", 16),
            ],
            "dynamodb": [quota("Maximum number of tables", 2500)],
        },
        "usage": {
            "vpcs": 1,
            "networkInterfaces": 10,
            "securityGroups": 10,
            "gatewayVpcEndpoints": 0,
            "applicationLoadBalancers": 0,
            "codebuildProjects": 0,
            "dynamodbTables": 0,
            "rdsInstances": 0,
            "rdsAllocatedStorageGiB": 0,
            "rdsManualSnapshots": 0,
        },
        "lambdaAccountSettings": {
            "AccountLimit": {
                "ConcurrentExecutions": 1000,
                "UnreservedConcurrentExecutions": 1000,
            }
        },
        "plannedIncidentMediatorMaxDbSessions": 1,
    }


class AdmissionTests(unittest.TestCase):
    def evaluate(
        self, observed: dict[str, object], *, require_kms: bool = False
    ):
        return module.evaluate(
            observed,
            ["10.42.16.0/24", "10.42.17.0/24"],
            require_kms,
        )

    def test_passing_fixture_passes_and_selects_two_common_azs(self) -> None:
        checks, summary = self.evaluate(passing_observation())
        self.assertEqual(summary["status"], "PASS")
        self.assertEqual(summary["failed"], 0)
        self.assertEqual(
            summary["selectedAvailabilityZones"], ["eu-west-1a", "eu-west-1b"]
        )
        self.assertTrue(all(check.status == "PASS" for check in checks))

    def test_lambda_reservation_requires_six_units_plus_100_unreserved(self) -> None:
        observed = passing_observation()
        observed["lambdaAccountSettings"]["AccountLimit"][
            "UnreservedConcurrentExecutions"
        ] = 105
        checks, summary = self.evaluate(observed)
        self.assertEqual(summary["status"], "FAIL")
        failed = {check.id for check in checks if check.status == "FAIL"}
        self.assertIn("quota.lambda-reserved-concurrency", failed)

    def test_rds_requires_iam_database_authentication_support(self) -> None:
        observed = passing_observation()
        observed["rdsOrderableOptions"][0][
            "SupportsIAMDatabaseAuthentication"
        ] = False
        checks, summary = self.evaluate(observed)
        self.assertEqual(summary["status"], "FAIL")
        failed = {check.id for check in checks if check.status == "FAIL"}
        self.assertIn("availability.rds-postgres-18.6-db.m8gd.large-gp3", failed)

    def test_kms_endpoint_is_optional_until_selected(self) -> None:
        observed = passing_observation()
        observed["endpointServices"].remove("com.amazonaws.eu-west-1.kms")
        _, normal = self.evaluate(observed, require_kms=False)
        checks, kms_required = self.evaluate(observed, require_kms=True)
        self.assertEqual(normal["status"], "PASS")
        self.assertEqual(kms_required["status"], "FAIL")
        failed = {check.id for check in checks if check.status == "FAIL"}
        self.assertIn("availability.vpc-endpoint-services", failed)

    def test_topology_rejects_unreviewed_private_subnets(self) -> None:
        with self.assertRaises(module.AdmissionError):
            module.evaluate(
                passing_observation(),
                ["10.42.16.0/28", "10.42.17.0/28"],
                False,
            )

    def test_exact_quota_name_wins_over_partial_reserved_db_match(self) -> None:
        quotas = [
            quota("Reserved DB instances", 2),
            quota("DB instances", 40),
        ]
        self.assertEqual(module.quota_value(quotas, "DB instances"), 40.0)

    def test_allowlist_contains_only_descriptive_operations(self) -> None:
        forbidden_prefixes = (
            "create",
            "delete",
            "put",
            "update",
            "modify",
            "run",
            "start",
            "stop",
            "register",
            "deregister",
        )
        for service, operation in module.READ_ONLY_AWS_OPERATIONS:
            self.assertFalse(operation.startswith(forbidden_prefixes), (service, operation))

    def test_fixture_pass_never_counts_as_live_admission(self) -> None:
        boundary = module.build_evidence_boundary("fixture", "PASS")
        self.assertFalse(boundary["liveAdmissionPassed"])
        self.assertFalse(boundary["productionResourceCreationAuthorizedByThisReport"])

    def test_live_pass_marks_admission_only_not_resource_creation(self) -> None:
        boundary = module.build_evidence_boundary("live-aws", "PASS")
        self.assertTrue(boundary["liveAdmissionPassed"])
        self.assertFalse(boundary["productionResourceCreationAuthorizedByThisReport"])
        self.assertGreaterEqual(len(boundary["resourceCreationBlockersRemaining"]), 2)

    def test_current_dynamodb_quota_name_is_supported(self) -> None:
        self.assertEqual(
            module.quota_value(
                [quota("Maximum number of tables", 2500)],
                "Maximum number of tables",
                "Tables per Region",
            ),
            2500.0,
        )


if __name__ == "__main__":
    unittest.main()

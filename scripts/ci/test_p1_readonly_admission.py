from __future__ import annotations

import importlib.util
import stat
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "ops" / "p1_readonly_admission.py"
spec = importlib.util.spec_from_file_location("p1_readonly_admission", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def quota(name: str, value: float, source: str = "applied") -> dict[str, object]:
    return {"QuotaName": name, "Value": value, "fpllmValueSource": source}


def usage(maximum: float) -> dict[str, object]:
    return {
        "namespace": "AWS/Usage",
        "metricName": "ResourceCount",
        "dimensions": {},
        "windowStart": "2026-09-20T21:00:00Z",
        "windowEnd": "2026-09-20T21:15:00Z",
        "periodSeconds": 60,
        "statistic": "Maximum",
        "datapointCount": 1 if maximum else 0,
        "maximumObservedVcpu": maximum,
        "emptyWindowInterpretedAsZeroUsage": maximum == 0,
        "datapoints": [] if maximum == 0 else [{"Maximum": maximum}],
    }


def passing_observation() -> dict[str, object]:
    return {
        "awsCliVersion": "aws-cli/2.36.49 Python/3.13 Linux/6.8",
        "identity": {
            "Account": "123456789012",
            "Arn": "arn:aws:iam::123456789012:role/read-only",
        },
        "region": {
            "RegionName": "eu-west-1",
            "OptInStatus": "opt-in-not-required",
        },
        "enabledAvailabilityZones": ["eu-west-1a", "eu-west-1b", "eu-west-1c"],
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
            "cliCommandAvailable": True,
            "regionalApiRecognized": True,
            "probeOutcome": "expected-not-found",
        },
        "vcpuUsage": {
            "fargateOnDemand": usage(0),
            "ec2StandardOnDemand": usage(0),
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
        "lambdaConcurrencySnapshotVerification": {
            "stable": True,
            "method": "two-consecutive-bracketed-identical-snapshots",
            "attemptsUsed": 2,
        },
    }


class LambdaInventoryCli:
    def __init__(self, provisioned_claims: list[int]) -> None:
        self.provisioned_claims = provisioned_claims
        self.inventory_scan = 0

    def run_json(self, service: str, operation: str, *args: str) -> dict[str, object]:
        self.assert_lambda(service)
        if operation == "get-account-settings":
            return {
                "AccountLimit": {
                    "ConcurrentExecutions": 1000,
                    "UnreservedConcurrentExecutions": 1000,
                }
            }
        if operation == "list-functions":
            self.inventory_scan += 1
            return {"Functions": [{"FunctionName": "existing"}]}
        if operation == "get-function-concurrency":
            return {}
        if operation == "list-provisioned-concurrency-configs":
            index = min(self.inventory_scan - 1, len(self.provisioned_claims) - 1)
            claim = self.provisioned_claims[index]
            return {
                "ProvisionedConcurrencyConfigs": [
                    {
                        "FunctionArn": "arn:aws:lambda:eu-west-1:123456789012:function:existing:live",
                        "RequestedProvisionedConcurrentExecutions": claim,
                        "AllocatedProvisionedConcurrentExecutions": claim,
                        "AvailableProvisionedConcurrentExecutions": claim,
                        "Status": "READY",
                    }
                ]
            }
        raise AssertionError((service, operation, args))

    @staticmethod
    def assert_lambda(service: str) -> None:
        if service != "lambda":
            raise AssertionError(service)


class AdmissionTests(unittest.TestCase):
    def evaluate(self, observed: dict[str, object], *, require_kms: bool = False):
        return module.evaluate(
            observed,
            ["10.42.16.0/24", "10.42.17.0/24"],
            require_kms,
        )

    def test_passing_fixture_passes_with_one_worker_az_and_two_rds_azs(self) -> None:
        checks, summary = self.evaluate(passing_observation())
        self.assertEqual(summary["status"], "PASS")
        self.assertEqual(summary["selectedAvailabilityZones"], ["eu-west-1a", "eu-west-1b"])
        self.assertTrue(all(check.status == "PASS" for check in checks))

    def test_fargate_quota_must_be_free_headroom_not_nominal_limit(self) -> None:
        observed = passing_observation()
        observed["vcpuUsage"]["fargateOnDemand"] = usage(1)
        checks, summary = self.evaluate(observed)
        self.assertEqual(summary["status"], "FAIL")
        self.assertEqual(summary["fargateOnDemandVcpuHeadroom"], 5)
        self.assertIn(
            "quota.fargate-ondemand-vcpu-headroom",
            {check.id for check in checks if check.status == "FAIL"},
        )

    def test_ec2_standard_quota_must_leave_four_free_vcpu(self) -> None:
        observed = passing_observation()
        observed["quotas"]["ec2"][0]["Value"] = 4
        observed["vcpuUsage"]["ec2StandardOnDemand"] = usage(1)
        checks, summary = self.evaluate(observed)
        self.assertEqual(summary["status"], "FAIL")
        self.assertEqual(summary["ec2StandardOnDemandVcpuHeadroom"], 3)
        self.assertIn(
            "quota.ec2-standard-ondemand-vcpu-headroom",
            {check.id for check in checks if check.status == "FAIL"},
        )

    def test_two_worker_azs_are_not_required(self) -> None:
        observed = passing_observation()
        observed["m7iOfferings"] = ["eu-west-1b"]
        _, summary = self.evaluate(observed)
        self.assertEqual(summary["status"], "PASS")
        self.assertEqual(summary["selectedAvailabilityZones"], ["eu-west-1b", "eu-west-1a"])

    def test_fails_without_two_rds_azs(self) -> None:
        observed = passing_observation()
        observed["rdsOrderableOptions"][0]["AvailabilityZones"] = [{"Name": "eu-west-1a"}]
        checks, summary = self.evaluate(observed)
        self.assertEqual(summary["status"], "FAIL")
        self.assertIn(
            "availability.rds-two-az-and-worker",
            {check.id for check in checks if check.status == "FAIL"},
        )

    def test_account_applied_quota_is_required(self) -> None:
        observed = passing_observation()
        observed["quotas"]["fargate"][0]["fpllmValueSource"] = "aws-default"
        with self.assertRaises(module.AdmissionError):
            self.evaluate(observed)

    def test_lambda_reservation_requires_six_plus_100_effective_unreserved(self) -> None:
        observed = passing_observation()
        observed["lambdaConcurrencyAllocations"] = {
            "functions": [],
            "functionCount": 0,
            "totalReservedConcurrency": 0,
            "totalProvisionedConcurrency": 895,
            "provisionedConcurrencyNotCoveredByReserved": 895,
        }
        checks, summary = self.evaluate(observed)
        self.assertEqual(summary["status"], "FAIL")
        failed = {check.id for check in checks if check.status == "FAIL"}
        self.assertIn("quota.lambda-reserved-concurrency", failed)
        self.assertNotIn("quota.lambda-reserved-inventory-consistent", failed)
        self.assertEqual(
            summary["lambdaEffectiveUnreservedAfterExistingProvisionedConcurrency"],
            105,
        )

    def test_lambda_provisioned_concurrency_inside_reserved_is_not_double_counted(self) -> None:
        observed = passing_observation()
        observed["lambdaAccountSettings"]["AccountLimit"] = {
            "ConcurrentExecutions": 1200,
            "UnreservedConcurrentExecutions": 300,
        }
        observed["lambdaConcurrencyAllocations"] = {
            "functions": [
                {
                    "functionName": "existing",
                    "reservedConcurrency": 900,
                    "provisionedConcurrencyClaim": 900,
                    "provisionedConcurrencyNotCoveredByReserved": 0,
                    "provisionedConfigurations": [],
                }
            ],
            "functionCount": 1,
            "totalReservedConcurrency": 900,
            "totalProvisionedConcurrency": 900,
            "provisionedConcurrencyNotCoveredByReserved": 0,
        }
        checks, summary = self.evaluate(observed)
        self.assertEqual(summary["status"], "PASS")
        self.assertEqual(summary["lambdaEffectiveUnreservedAfterExistingProvisionedConcurrency"], 300)
        self.assertTrue(all(check.status == "PASS" for check in checks))

    def test_lambda_inventory_disagreement_fails_closed(self) -> None:
        observed = passing_observation()
        observed["lambdaAccountSettings"]["AccountLimit"]["UnreservedConcurrentExecutions"] = 900
        checks, summary = self.evaluate(observed)
        self.assertEqual(summary["status"], "FAIL")
        self.assertIn(
            "quota.lambda-reserved-inventory-consistent",
            {check.id for check in checks if check.status == "FAIL"},
        )

    def test_stable_lambda_inventory_requires_two_identical_bracketed_samples(self) -> None:
        snapshot = module.collect_stable_lambda_concurrency_snapshot(
            LambdaInventoryCli([10, 10]),
            max_attempts=3,
        )
        self.assertTrue(snapshot["verification"]["stable"])
        self.assertEqual(snapshot["verification"]["attemptsUsed"], 2)
        self.assertEqual(
            snapshot["allocations"]["provisionedConcurrencyNotCoveredByReserved"],
            10,
        )

    def test_raced_lambda_provisioned_inventory_fails_closed(self) -> None:
        with self.assertRaisesRegex(module.AdmissionError, "did not stabilize"):
            module.collect_stable_lambda_concurrency_snapshot(
                LambdaInventoryCli([10, 20, 10]),
                max_attempts=3,
            )

    def test_express_probe_accepts_documented_resource_not_found(self) -> None:
        cli = module.AwsCli("aws", None, "eu-west-1")
        cli._run = lambda command: module.subprocess.CompletedProcess(
            command,
            255,
            stdout="",
            stderr=(
                "An error occurred (ResourceNotFoundException) when calling the "
                "DescribeExpressGatewayService operation: Resource not found"
            ),
        )
        result = cli.probe_express_gateway_service("123456789012")
        self.assertTrue(result["regionalApiRecognized"])
        self.assertEqual(result["probeOutcome"], "expected-not-found")

    def test_express_probe_classifies_unsupported_feature(self) -> None:
        cli = module.AwsCli("aws", None, "eu-west-1")
        cli._run = lambda command: module.subprocess.CompletedProcess(
            command,
            255,
            stdout="",
            stderr=(
                "An error occurred (UnsupportedFeatureException) when calling the "
                "DescribeExpressGatewayService operation: Express is not supported"
            ),
        )
        result = cli.probe_express_gateway_service("123456789012")
        self.assertFalse(result["regionalApiRecognized"])
        self.assertEqual(result["probeOutcome"], "regional-api-unsupported")

    def test_service_quota_merge_preserves_applied_source_and_default_only_entries(self) -> None:
        class QuotaCli:
            def run_json(self, service: str, operation: str, *args: str):
                self_service = service
                if self_service != "service-quotas":
                    raise AssertionError((service, operation, args))
                if operation == "list-service-quotas":
                    return {
                        "Quotas": [
                            {
                                "QuotaCode": "L-APPLIED",
                                "QuotaName": "Example applied quota",
                                "Value": 7,
                            }
                        ]
                    }
                if operation == "list-aws-default-service-quotas":
                    return {
                        "Quotas": [
                            {
                                "QuotaCode": "L-APPLIED",
                                "QuotaName": "Example applied quota",
                                "Value": 5,
                            },
                            {
                                "QuotaCode": "L-DEFAULT",
                                "QuotaName": "Example default-only quota",
                                "Value": 11,
                            },
                        ]
                    }
                raise AssertionError((service, operation, args))

        merged = module.service_quotas(QuotaCli(), "example")
        by_code = {entry["QuotaCode"]: entry for entry in merged}
        self.assertEqual(by_code["L-APPLIED"]["Value"], 7)
        self.assertEqual(by_code["L-APPLIED"]["fpllmValueSource"], "applied")
        self.assertEqual(by_code["L-DEFAULT"]["fpllmValueSource"], "aws-default")

    def test_aws_usage_parser_retains_recent_maximum(self) -> None:
        class MetricCli:
            def run_json(self, service: str, operation: str, *args: str):
                self.last = (service, operation, args)
                return {
                    "Datapoints": [
                        {"Maximum": 2.0, "Timestamp": "2026-09-20T21:00:00Z"},
                        {"Maximum": 5.0, "Timestamp": "2026-09-20T21:01:00Z"},
                    ]
                }

        cli = MetricCli()
        result = module.collect_recent_vcpu_usage(cli, "Fargate", "Standard/OnDemand")
        self.assertEqual(result["maximumObservedVcpu"], 5.0)
        self.assertEqual(result["datapointCount"], 2)
        self.assertEqual(cli.last[0:2], ("cloudwatch", "get-metric-statistics"))

    def test_rds_requires_iam_database_authentication(self) -> None:
        observed = passing_observation()
        observed["rdsOrderableOptions"][0]["SupportsIAMDatabaseAuthentication"] = False
        checks, summary = self.evaluate(observed)
        self.assertEqual(summary["status"], "FAIL")
        self.assertIn(
            "availability.rds-postgres-18.6-db.m8gd.large-gp3",
            {check.id for check in checks if check.status == "FAIL"},
        )

    def test_kms_endpoint_is_optional(self) -> None:
        observed = passing_observation()
        observed["endpointServices"].remove("com.amazonaws.eu-west-1.kms")
        _, normal = self.evaluate(observed, require_kms=False)
        checks, required = self.evaluate(observed, require_kms=True)
        self.assertEqual(normal["status"], "PASS")
        self.assertEqual(required["status"], "FAIL")
        self.assertIn(
            "availability.vpc-endpoint-services",
            {check.id for check in checks if check.status == "FAIL"},
        )

    def test_dynamodb_on_demand_does_not_require_fake_account_throughput_quota(self) -> None:
        checks, summary = self.evaluate(passing_observation())
        self.assertEqual(summary["status"], "PASS")
        self.assertIn(
            "provider.dynamodb-on-demand-throughput-baseline",
            {check.id for check in checks},
        )

    def test_topology_rejects_unreviewed_private_subnets(self) -> None:
        with self.assertRaises(module.AdmissionError):
            module.evaluate(
                passing_observation(),
                ["10.42.16.0/28", "10.42.17.0/28"],
                False,
            )

    def test_rds_connect_template_binds_account_region_and_user(self) -> None:
        self.assertEqual(
            module.rds_db_connect_resource_template("123456789012"),
            "arn:aws:rds-db:eu-west-1:123456789012:dbuser:<DBI_RESOURCE_ID>/fpllm_incident_fence",
        )

    def test_rds_connect_policy_template_has_no_wildcard_authority(self) -> None:
        policy = module.rds_db_connect_policy_template("123456789012")
        self.assertEqual(policy["Statement"][0]["Action"], ["rds-db:connect"])
        self.assertEqual(
            policy["Statement"][0]["Resource"],
            [
                "arn:aws:rds-db:eu-west-1:123456789012:dbuser:<DBI_RESOURCE_ID>/fpllm_incident_fence"
            ],
        )
        self.assertNotIn("*", module.json.dumps(policy, sort_keys=True))

    def test_exact_quota_name_wins_over_partial_match(self) -> None:
        values = [
            quota("Reserved DB instances", 2),
            quota("DB instances", 40),
        ]
        self.assertEqual(
            module.quota_value(values, "DB instances", require_applied=True),
            40.0,
        )

    def test_allowlist_contains_only_descriptive_operations(self) -> None:
        forbidden = (
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
            self.assertFalse(operation.startswith(forbidden), (service, operation))

    def test_fixture_pass_is_never_resource_creation_authority(self) -> None:
        boundary = module.build_evidence_boundary("fixture", "PASS")
        self.assertFalse(boundary["liveAdmissionPassed"])
        self.assertFalse(boundary["productionResourceCreationAuthorizedByThisReport"])

    def test_live_pass_is_still_not_resource_creation_authority(self) -> None:
        boundary = module.build_evidence_boundary("live-aws", "PASS")
        self.assertTrue(boundary["liveAdmissionPassed"])
        self.assertFalse(boundary["productionResourceCreationAuthorizedByThisReport"])

    def test_write_report_is_owner_only_and_digest_matches(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            digest = module.write_report(path, {"ok": True})
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            digest_path = Path(f"{path}.sha256")
            self.assertEqual(stat.S_IMODE(digest_path.stat().st_mode), 0o600)
            self.assertTrue(digest_path.read_text(encoding="utf-8").startswith(digest))
            self.assertEqual(digest, module.hashlib.sha256(path.read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

MODULE_PATH = Path(__file__).resolve().parents[1] / "ops" / "p1_readonly_admission.py"
SPEC = importlib.util.spec_from_file_location(
    "p1_readonly_admission_ec2_canonicalization_tests", MODULE_PATH
)
assert SPEC and SPEC.loader
p1 = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = p1
SPEC.loader.exec_module(p1)

ACCOUNT = "123456789012"


class PermutedEc2Cli:
    def __init__(self, *, reverse: bool) -> None:
        self.reverse = reverse

    def run_json(self, service, operation, *args):
        if (service, operation) == ("ec2", "describe-capacity-reservations"):
            reservations = [
                {
                    "CapacityReservationId": "cr-b",
                    "OwnerId": ACCOUNT,
                    "State": "scheduled",
                    "ReservationType": "default",
                    "InstanceType": "m7i.xlarge",
                    "TotalInstanceCount": 0,
                    "AvailableInstanceCount": 0,
                    "CommitmentInfo": {"CommittedInstanceCount": 2},
                },
                {
                    "CapacityReservationId": "cr-a",
                    "OwnerId": ACCOUNT,
                    "State": "delayed",
                    "ReservationType": "default",
                    "InstanceType": "m7i.xlarge",
                    "TotalInstanceCount": 0,
                    "AvailableInstanceCount": 0,
                    "CommitmentInfo": {"CommittedInstanceCount": 1},
                },
            ]
            if self.reverse:
                reservations.reverse()
            return {"CapacityReservations": reservations}

        if (service, operation) == ("ec2", "describe-instances"):
            instances = [
                {
                    "InstanceId": "i-b",
                    "InstanceType": "m7i.xlarge",
                    "State": {"Name": "running"},
                    "InstanceLifecycle": "capacity-block",
                    "CapacityReservationId": "cr-block-b",
                    "CapacityBlockId": "cb-b",
                },
                {
                    "InstanceId": "i-a",
                    "InstanceType": "m7i.xlarge",
                    "State": {"Name": "running"},
                    "InstanceLifecycle": "capacity-block",
                    "CapacityReservationId": "cr-block-a",
                    "CapacityBlockId": "cb-a",
                },
            ]
            if self.reverse:
                instances.reverse()
            return {"Reservations": [{"Instances": instances}]}

        if (service, operation) == ("ec2", "describe-instance-types"):
            return {
                "InstanceTypes": [
                    {"InstanceType": "m7i.xlarge", "VCpuInfo": {"DefaultVCpus": 4}}
                ]
            }

        raise AssertionError(f"unexpected call: {(service, operation, args)!r}")


class Ec2WrapperCanonicalizationTests(unittest.TestCase):
    def test_provider_order_permutations_have_identical_canonical_inventory(self):
        forward = p1.collect_ec2_standard_inventory_once(
            PermutedEc2Cli(reverse=False), ACCOUNT
        )
        reversed_order = p1.collect_ec2_standard_inventory_once(
            PermutedEc2Cli(reverse=True), ACCOUNT
        )

        self.assertEqual(forward, reversed_order)
        self.assertEqual(p1._core._fingerprint(forward), p1._core._fingerprint(reversed_order))
        self.assertEqual(forward["observedVcpu"], 12)
        self.assertEqual(
            [item["capacityReservationId"] for item in forward["futureDatedCommitmentAdjustments"]],
            ["cr-a", "cr-b"],
        )
        self.assertEqual(
            [item["instanceId"] for item in forward["capacityBlockInstanceExclusions"]],
            ["i-a", "i-b"],
        )


class EventualConsistencyGuardTests(unittest.TestCase):
    @staticmethod
    def inventory(marker: str) -> dict:
        return {
            "fargateOnDemand": {
                "observedVcpu": 0.0,
                "taskCount": 0,
                "tasks": [],
                "marker": marker,
            },
            "ec2StandardOnDemand": {
                "observedVcpu": 0.0,
                "instanceCount": 0,
                "instances": [],
                "capacityReservationCount": 0,
                "capacityReservations": [],
                "marker": marker,
            },
        }

    @staticmethod
    def usage() -> dict:
        return {
            "telemetryComplete": True,
            "maximumObservedVcpu": 0.0,
            "datapoints": [],
        }

    @staticmethod
    def live_cli():
        return p1.AwsCli("aws", None, p1.REGION)

    def test_live_snapshot_requires_mutation_quiescence_assertion(self):
        with mock.patch.dict(
            p1.os.environ,
            {p1.COMPUTE_MUTATION_QUIESCENCE_ENV: ""},
            clear=False,
        ):
            with self.assertRaisesRegex(p1.AdmissionError, "mutation-quiescence"):
                p1.collect_bracketed_compute_snapshot(self.live_cli(), ACCOUNT)

    def test_live_snapshot_waits_guard_and_records_evidence(self):
        stable = self.inventory("stable")
        with mock.patch.dict(
            p1.os.environ,
            {
                p1.COMPUTE_MUTATION_QUIESCENCE_ENV: (
                    p1.COMPUTE_MUTATION_QUIESCENCE_VALUE
                )
            },
            clear=False,
        ), mock.patch.object(
            p1, "_compute_inventory_once", side_effect=[stable, stable, stable]
        ), mock.patch.object(
            p1._core,
            "collect_recent_vcpu_usage",
            side_effect=[self.usage(), self.usage()],
        ), mock.patch.object(p1.time, "sleep") as sleep_mock:
            result = p1.collect_bracketed_compute_snapshot(self.live_cli(), ACCOUNT)

        sleep_mock.assert_called_once_with(p1.COMPUTE_EVENTUAL_CONSISTENCY_GUARD_SECONDS)
        verification = result["computeVcpuInventory"]["verification"]
        self.assertTrue(verification["stable"])
        self.assertTrue(verification["eventualConsistencyGuardApplied"])
        self.assertEqual(
            verification["guardStartInventoryFingerprintSha256"],
            verification["inventoryFingerprintSha256"],
        )

    def test_live_snapshot_rejects_inventory_change_during_guard(self):
        stale = self.inventory("stale")
        converged = self.inventory("converged")
        with mock.patch.dict(
            p1.os.environ,
            {
                p1.COMPUTE_MUTATION_QUIESCENCE_ENV: (
                    p1.COMPUTE_MUTATION_QUIESCENCE_VALUE
                )
            },
            clear=False,
        ), mock.patch.object(
            p1, "_compute_inventory_once", side_effect=[stale, converged]
        ), mock.patch.object(p1.time, "sleep"):
            with self.assertRaisesRegex(
                p1.AdmissionError, "changed across the eventual-consistency guard"
            ):
                p1.collect_bracketed_compute_snapshot(self.live_cli(), ACCOUNT)


if __name__ == "__main__":
    unittest.main()

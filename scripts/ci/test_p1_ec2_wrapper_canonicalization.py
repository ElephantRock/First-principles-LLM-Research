from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()

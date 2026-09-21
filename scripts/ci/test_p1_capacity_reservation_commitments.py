from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "ops" / "p1_readonly_admission.py"
SPEC = importlib.util.spec_from_file_location("p1_readonly_admission_commitment_tests", MODULE_PATH)
assert SPEC and SPEC.loader
p1 = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = p1
SPEC.loader.exec_module(p1)

ACCOUNT = "123456789012"


class FakeCli:
    def __init__(self, capacity_reservations):
        self.capacity_reservations = capacity_reservations

    def run_json(self, service, operation, *args):
        if (service, operation) == ("ec2", "describe-capacity-reservations"):
            return {"CapacityReservations": self.capacity_reservations}
        if (service, operation) == ("ec2", "describe-instances"):
            return {"Reservations": []}
        if (service, operation) == ("ec2", "describe-instance-types"):
            names = args[args.index("--instance-types") + 1 :]
            return {
                "InstanceTypes": [
                    {"InstanceType": name, "VCpuInfo": {"DefaultVCpus": 4}}
                    for name in names
                ]
            }
        raise AssertionError((service, operation, args))


class FutureDatedCapacityReservationTests(unittest.TestCase):
    def reservation(self, *, state, total, committed, reservation_type="default"):
        return {
            "CapacityReservationId": f"cr-{state}",
            "OwnerId": ACCOUNT,
            "State": state,
            "ReservationType": reservation_type,
            "InstanceType": "m7i.xlarge",
            "TotalInstanceCount": total,
            "AvailableInstanceCount": 0,
            "CommitmentInfo": {"CommittedInstanceCount": committed},
        }

    def test_scheduled_commitment_counts_when_total_instance_count_is_zero(self):
        result = p1.collect_ec2_standard_inventory_once(
            FakeCli([self.reservation(state="scheduled", total=0, committed=8)]),
            ACCOUNT,
        )
        self.assertEqual(result["ownedCapacityReservationVcpu"], 32)
        self.assertEqual(result["observedVcpu"], 32)
        self.assertEqual(result["capacityReservations"][0]["totalInstanceCount"], 8)
        self.assertEqual(
            result["futureDatedCommitmentAdjustments"],
            [
                {
                    "capacityReservationId": "cr-scheduled",
                    "state": "scheduled",
                    "reportedTotalInstanceCount": 0,
                    "committedInstanceCount": 8,
                    "quotaInstanceCount": 8,
                }
            ],
        )

    def test_larger_delivered_total_remains_the_quota_claim(self):
        result = p1.collect_ec2_standard_inventory_once(
            FakeCli([self.reservation(state="active", total=10, committed=8)]),
            ACCOUNT,
        )
        self.assertEqual(result["ownedCapacityReservationVcpu"], 40)
        self.assertEqual(result["futureDatedCommitmentAdjustments"], [])

    def test_capacity_block_is_not_promoted_into_on_demand_quota_claim(self):
        result = p1.collect_ec2_standard_inventory_once(
            FakeCli(
                [
                    self.reservation(
                        state="scheduled",
                        total=0,
                        committed=8,
                        reservation_type="capacity-block",
                    )
                ]
            ),
            ACCOUNT,
        )
        self.assertEqual(result["observedVcpu"], 0)
        self.assertEqual(result["futureDatedCommitmentAdjustments"], [])

    def test_negative_committed_count_fails_closed(self):
        with self.assertRaises(p1.AdmissionError):
            p1.collect_ec2_standard_inventory_once(
                FakeCli([self.reservation(state="scheduled", total=0, committed=-1)]),
                ACCOUNT,
            )


if __name__ == "__main__":
    unittest.main()

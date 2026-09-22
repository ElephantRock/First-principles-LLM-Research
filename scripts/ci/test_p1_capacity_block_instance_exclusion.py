from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "ops" / "p1_readonly_admission.py"
SPEC = importlib.util.spec_from_file_location(
    "p1_readonly_admission_capacity_block_instance_tests", MODULE_PATH
)
assert SPEC and SPEC.loader
p1 = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = p1
SPEC.loader.exec_module(p1)

ACCOUNT = "123456789012"


class FakeCli:
    def run_json(self, service, operation, *args):
        if (service, operation) == ("ec2", "describe-capacity-reservations"):
            return {
                "CapacityReservations": [
                    {
                        "CapacityReservationId": "cr-capacity-block",
                        "OwnerId": ACCOUNT,
                        "State": "active",
                        "ReservationType": "capacity-block",
                        "InstanceType": "m7i.xlarge",
                        "TotalInstanceCount": 1,
                        "AvailableInstanceCount": 0,
                    }
                ]
            }
        if (service, operation) == ("ec2", "describe-instances"):
            return {
                "Reservations": [
                    {
                        "Instances": [
                            {
                                "InstanceId": "i-capacity-block",
                                "InstanceType": "m7i.xlarge",
                                "State": {"Name": "running"},
                                "InstanceLifecycle": "capacity-block",
                                "CapacityReservationId": "cr-capacity-block",
                                "CapacityBlockId": "cb-0123456789abcdef0",
                            }
                        ]
                    }
                ]
            }
        raise AssertionError(f"unexpected call: {(service, operation, args)!r}")


class CapacityBlockInstanceQuotaTests(unittest.TestCase):
    def test_running_capacity_block_instance_is_excluded_from_standard_ondemand_usage(self):
        result = p1.collect_ec2_standard_inventory_once(FakeCli(), ACCOUNT)

        self.assertEqual(result["observedVcpu"], 0)
        self.assertEqual(result["runningInstanceVcpu"], 0)
        self.assertEqual(result["instanceCount"], 0)
        self.assertEqual(result["capacityReservationCount"], 0)
        self.assertEqual(
            result["capacityBlockInstanceExclusions"],
            [
                {
                    "instanceId": "i-capacity-block",
                    "instanceType": "m7i.xlarge",
                    "capacityReservationId": "cr-capacity-block",
                    "capacityBlockId": "cb-0123456789abcdef0",
                    "instanceLifecycle": "capacity-block",
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()

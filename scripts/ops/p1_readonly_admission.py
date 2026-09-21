from __future__ import annotations

"""Stable P1 admission entry point over the reviewed collector core.

The collector grew large during the P1 hardening cycle. The reviewed implementation is
kept in ``p1_readonly_admission_core.py``; this entry point re-exports that surface and
contains the narrowly scoped quota-accounting correction that requires future-dated EC2
Capacity Reservation commitments to be counted even while ``TotalInstanceCount`` remains
zero. Live collection still enters the core ``main`` function, with its compute snapshot
and provenance hooks replaced below before execution.
"""

import copy
import importlib.util
import sys
from pathlib import Path
from typing import Any

_CORE_PATH = Path(__file__).with_name("p1_readonly_admission_core.py")
_CORE_SPEC = importlib.util.spec_from_file_location("p1_readonly_admission_core", _CORE_PATH)
if _CORE_SPEC is None or _CORE_SPEC.loader is None:
    raise RuntimeError(f"cannot load P1 admission core: {_CORE_PATH}")
_core = importlib.util.module_from_spec(_CORE_SPEC)
sys.modules[_CORE_SPEC.name] = _core
_CORE_SPEC.loader.exec_module(_core)

# Re-export the reviewed core API first; corrected functions below intentionally replace
# selected names in this module and the hooks used by core.collect()/core.main().
for _name in dir(_core):
    if not _name.startswith("__"):
        globals()[_name] = getattr(_core, _name)

_CORE_COLLECT_EC2_STANDARD_INVENTORY_ONCE = _core.collect_ec2_standard_inventory_once
_CORE_COLLECTOR_PROVENANCE = _core.collector_provenance


class _CapacityReservationQuotaAccountingCli:
    """Read-only response adapter for AWS future-dated reservation quota semantics.

    AWS documents ``assessing``, ``scheduled``, ``pending``, ``active`` and ``delayed``
    On-Demand Capacity Reservations as consuming the owner's On-Demand Instance quota.
    For a future-dated reservation, ``TotalInstanceCount`` can remain zero while the
    committed capacity is carried in ``CommitmentInfo.CommittedInstanceCount``. The core
    inventory already handles reservation/instance double-counting; this adapter only
    normalizes the count presented to that reviewed logic to the larger provider claim.
    """

    def __init__(self, delegate: Any) -> None:
        self.delegate = delegate
        self.commitment_adjustments: list[dict[str, Any]] = []

    def run_json(self, service: str, operation: str, *args: str) -> dict[str, Any]:
        document = self.delegate.run_json(service, operation, *args)
        if (service, operation) != ("ec2", "describe-capacity-reservations"):
            return document

        adjusted = copy.deepcopy(document)
        reservations = adjusted.get("CapacityReservations")
        if not isinstance(reservations, list):
            return adjusted

        for reservation in reservations:
            if not isinstance(reservation, dict):
                continue
            if reservation.get("State") not in COUNTED_CAPACITY_RESERVATION_STATES:
                continue
            if reservation.get("ReservationType", "default") == "capacity-block":
                continue

            total_raw = reservation.get("TotalInstanceCount", 0)
            commitment = reservation.get("CommitmentInfo") or {}
            committed_raw = (
                commitment.get("CommittedInstanceCount") if isinstance(commitment, dict) else None
            )
            if not isinstance(total_raw, int) or total_raw < 0:
                # Preserve malformed provider evidence for the core fail-closed validator.
                continue
            if committed_raw is not None and (
                not isinstance(committed_raw, int) or committed_raw < 0
            ):
                raise AdmissionError(
                    "invalid Capacity Reservation committed instance count: "
                    f"{reservation!r}"
                )

            # Every reservation in a provider-documented quota-counting state consumes
            # On-Demand quota. A zero delivered count is therefore not trustworthy proof
            # of zero quota usage unless commitment metadata supplies the committed count.
            if total_raw == 0 and committed_raw is None:
                raise AdmissionError(
                    "quota-counting Capacity Reservation has zero delivered capacity but "
                    "no committed instance count; refusing to infer zero quota usage: "
                    f"{reservation!r}"
                )

            quota_instance_count = max(total_raw, committed_raw or 0)
            if quota_instance_count <= 0:
                raise AdmissionError(
                    "quota-counting Capacity Reservation has no positive quota claim: "
                    f"{reservation!r}"
                )
            if quota_instance_count == total_raw:
                continue

            reservation["TotalInstanceCount"] = quota_instance_count
            if (
                reservation.get("State") in {"assessing", "scheduled", "pending", "delayed"}
                and reservation.get("AvailableInstanceCount") is None
            ):
                # Capacity is not yet delivered in these states; zero is the conservative
                # availability value while the commitment still consumes quota.
                reservation["AvailableInstanceCount"] = 0
            self.commitment_adjustments.append(
                {
                    "capacityReservationId": reservation.get("CapacityReservationId"),
                    "state": reservation.get("State"),
                    "reportedTotalInstanceCount": total_raw,
                    "committedInstanceCount": committed_raw,
                    "quotaInstanceCount": quota_instance_count,
                }
            )
        return adjusted


def collect_ec2_standard_inventory_once(cli: Any, account: str) -> dict[str, Any]:
    adapter = _CapacityReservationQuotaAccountingCli(cli)
    result = _CORE_COLLECT_EC2_STANDARD_INVENTORY_ONCE(adapter, account)
    return {
        **result,
        "capacityReservationAccounting": (
            "max(TotalInstanceCount, CommitmentInfo.CommittedInstanceCount) "
            "for provider-documented quota-counting On-Demand Capacity Reservation states"
        ),
        "futureDatedCommitmentAdjustments": adapter.commitment_adjustments,
    }


def _compute_inventory_once(cli: Any, account: str) -> dict[str, Any]:
    return {
        "fargateOnDemand": _core.collect_fargate_inventory_once(cli),
        "ec2StandardOnDemand": collect_ec2_standard_inventory_once(cli, account),
    }


def collect_bracketed_compute_snapshot(
    cli: Any,
    account: str,
    max_attempts: int = COMPUTE_SNAPSHOT_MAX_ATTEMPTS,
) -> dict[str, Any]:
    if max_attempts < 1:
        raise AdmissionError("compute snapshot requires at least one attempt")
    last_reason = "no attempts executed"
    for attempt in range(1, max_attempts + 1):
        try:
            before = _compute_inventory_once(cli, account)
            usage = {
                "fargateOnDemand": _core.collect_recent_vcpu_usage(
                    cli, "Fargate", "Standard/OnDemand"
                ),
                "ec2StandardOnDemand": _core.collect_recent_vcpu_usage(
                    cli, "EC2", "Standard/OnDemand"
                ),
            }
            after = _compute_inventory_once(cli, account)
        except AdmissionError as exc:
            last_reason = str(exc)
            continue

        before_fingerprint = _core._fingerprint(before)
        after_fingerprint = _core._fingerprint(after)
        if before_fingerprint == after_fingerprint:
            return {
                "vcpuUsage": usage,
                "computeVcpuInventory": {
                    **after,
                    "verification": {
                        "stable": True,
                        "method": (
                            "direct-quota-inventory-before-and-after-cloudwatch-window-read"
                        ),
                        "attemptsUsed": attempt,
                        "maxAttempts": max_attempts,
                        "inventoryFingerprintSha256": after_fingerprint,
                    },
                },
            }
        last_reason = (
            "direct EC2/Fargate quota inventory changed across the CloudWatch usage reads"
        )

    raise AdmissionError(
        "compute vCPU inventory did not stabilize within "
        f"{max_attempts} attempts: {last_reason}"
    )


def _head_blob_sha256(root: Path, relative: Path) -> str | None:
    """Return SHA-256 of the exact blob at HEAD:path, or None when HEAD lacks the path."""
    result = _core.subprocess.run(
        ["git", "-C", str(root), "show", f"HEAD:{relative.as_posix()}"],
        capture_output=True,
        timeout=10,
    )
    if result.returncode != 0:
        return None
    return _core.hashlib.sha256(result.stdout).hexdigest()


def collector_provenance(require_clean: bool) -> dict[str, Any]:
    """Bind live evidence to both the stable entry point and the reviewed core."""
    core_provenance = _CORE_COLLECTOR_PROVENANCE(require_clean)
    entrypoint = Path(__file__).resolve()
    root = entrypoint.parents[2]
    try:
        relative = entrypoint.relative_to(root)
    except ValueError as exc:
        raise AdmissionError("collector entrypoint is not under the repository root") from exc

    status = _core.subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "status",
            "--porcelain",
            "--untracked-files=no",
            "--",
            str(relative),
        ],
        capture_output=True,
        text=True,
        timeout=10,
    )
    clean = status.stdout.strip() == "" if status.returncode == 0 else None
    entrypoint_sha256 = _core.sha256_file(entrypoint)
    entrypoint_head_sha256 = _head_blob_sha256(root, relative)
    entrypoint_matches_head = entrypoint_head_sha256 == entrypoint_sha256

    core_relative_raw = core_provenance.get("scriptPath")
    core_relative = (
        Path(core_relative_raw)
        if isinstance(core_relative_raw, str) and core_relative_raw
        else None
    )
    core_head_sha256 = (
        _head_blob_sha256(root, core_relative) if core_relative is not None else None
    )
    core_working_sha256 = core_provenance.get("scriptSha256")
    core_matches_head = (
        isinstance(core_working_sha256, str)
        and core_head_sha256 == core_working_sha256
    )

    if require_clean and clean is not True:
        raise AdmissionError("live evidence collector entrypoint differs from committed Git")
    if require_clean and not entrypoint_matches_head:
        raise AdmissionError(
            "live evidence collector entrypoint is absent from HEAD or its bytes differ from HEAD"
        )
    if require_clean and not core_matches_head:
        raise AdmissionError(
            "live evidence collector core is absent from HEAD or its bytes differ from HEAD"
        )

    return {
        "gitCommit": core_provenance.get("gitCommit"),
        "scriptPath": str(relative),
        "scriptSha256": entrypoint_sha256,
        "scriptWorkingTreeClean": clean,
        "scriptHeadSha256": entrypoint_head_sha256,
        "scriptMatchesHead": entrypoint_matches_head,
        "coreScriptPath": core_provenance.get("scriptPath"),
        "coreScriptSha256": core_working_sha256,
        "coreScriptWorkingTreeClean": core_provenance.get("scriptWorkingTreeClean"),
        "coreScriptHeadSha256": core_head_sha256,
        "coreScriptMatchesHead": core_matches_head,
    }


# core.collect()/core.main() resolve these hooks in the core module at call time. Rebind
# them before exposing/running main so both direct imports and CLI execution use the
# corrected accounting and evidence provenance paths.
_core._compute_inventory_once = _compute_inventory_once
_core.collect_bracketed_compute_snapshot = collect_bracketed_compute_snapshot
_core.collector_provenance = collector_provenance

# Ensure corrected public helpers win over the initial re-export.
globals()["collect_ec2_standard_inventory_once"] = collect_ec2_standard_inventory_once
globals()["_compute_inventory_once"] = _compute_inventory_once
globals()["collect_bracketed_compute_snapshot"] = collect_bracketed_compute_snapshot
globals()["collector_provenance"] = collector_provenance
main = _core.main


if __name__ == "__main__":
    raise SystemExit(main())

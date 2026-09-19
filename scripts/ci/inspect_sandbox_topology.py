from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

FORBIDDEN_ENV_KEYS = {
    "DATABASE_URL",
    "GITHUB_TOKEN",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
    "FPLLM_PRIVATE_TEST_BUNDLE_ROOT",
    "FPLLM_PUBLIC_TEST_BUNDLE_ROOT",
}


def inspect_container(name: str) -> dict[str, Any]:
    process = subprocess.run(
        ["docker", "inspect", name],
        check=True,
        capture_output=True,
        text=True,
    )
    documents = json.loads(process.stdout)
    if not isinstance(documents, list) or len(documents) != 1:
        raise SystemExit(f"unexpected docker inspect response for {name}")
    return documents[0]


def env_keys(document: dict[str, Any]) -> list[str]:
    entries = (document.get("Config") or {}).get("Env") or []
    keys: list[str] = []
    for entry in entries:
        if not isinstance(entry, str) or "=" not in entry:
            continue
        keys.append(entry.split("=", 1)[0])
    return sorted(set(keys))


def mount_view(document: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for mount in document.get("Mounts") or []:
        result.append(
            {
                "type": mount.get("Type"),
                "destination": mount.get("Destination"),
                "readOnly": not bool(mount.get("RW")),
            }
        )
    return sorted(result, key=lambda item: str(item["destination"]))


def assert_common(name: str, document: dict[str, Any]) -> dict[str, Any]:
    host = document.get("HostConfig") or {}
    config = document.get("Config") or {}
    keys = env_keys(document)
    leaked = sorted(FORBIDDEN_ENV_KEYS.intersection(keys))
    if leaked:
        raise SystemExit(f"{name} contains forbidden control-plane environment keys: {leaked}")
    if host.get("NetworkMode") != "none":
        raise SystemExit(f"{name} network is not disabled")
    if host.get("ReadonlyRootfs") is not True:
        raise SystemExit(f"{name} root filesystem is not read-only")
    cap_drop = set(host.get("CapDrop") or [])
    if "ALL" not in cap_drop:
        raise SystemExit(f"{name} does not drop all Linux capabilities")
    security = set(host.get("SecurityOpt") or [])
    if not any("no-new-privileges" in item for item in security):
        raise SystemExit(f"{name} does not enforce no-new-privileges")
    if not isinstance(host.get("PidsLimit"), int) or host["PidsLimit"] <= 0:
        raise SystemExit(f"{name} lacks a positive PID limit")
    if not isinstance(host.get("Memory"), int) or host["Memory"] <= 0:
        raise SystemExit(f"{name} lacks a positive memory limit")
    if not isinstance(host.get("NanoCpus"), int) or host["NanoCpus"] <= 0:
        raise SystemExit(f"{name} lacks a positive CPU limit")
    if config.get("User") != "65532:65532":
        raise SystemExit(f"{name} is not running under the expected unprivileged UID:GID")
    return {
        "networkMode": host.get("NetworkMode"),
        "readOnlyRootfs": host.get("ReadonlyRootfs"),
        "capDrop": sorted(cap_drop),
        "securityOpt": sorted(security),
        "pidsLimit": host.get("PidsLimit"),
        "memoryBytes": host.get("Memory"),
        "nanoCpus": host.get("NanoCpus"),
        "user": config.get("User"),
        "environmentKeys": keys,
        "mounts": mount_view(document),
    }


def destinations(view: dict[str, Any]) -> dict[str, bool]:
    return {str(item["destination"]): bool(item["readOnly"]) for item in view["mounts"]}


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect the split hidden-evaluation container topology.")
    parser.add_argument("--learner-container", required=True)
    parser.add_argument("--evaluator-container", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    learner_doc = inspect_container(args.learner_container)
    evaluator_doc = inspect_container(args.evaluator_container)
    learner = assert_common("learner probe", learner_doc)
    evaluator = assert_common("hidden evaluator", evaluator_doc)

    learner_mounts = destinations(learner)
    evaluator_mounts = destinations(evaluator)

    if learner_mounts.get("/workspace") is not True:
        raise SystemExit("learner workspace must be mounted read-only")
    if "/run/fpllm-ipc" not in learner_mounts:
        raise SystemExit("learner probe is missing its IPC mount")
    if "/opt/fpllm/tests" in learner_mounts:
        raise SystemExit("private test mount leaked into learner container")

    if evaluator_mounts.get("/opt/fpllm/tests") is not True:
        raise SystemExit("private evaluator bundle must be mounted read-only")
    if "/run/fpllm-ipc" not in evaluator_mounts or "/output" not in evaluator_mounts:
        raise SystemExit("hidden evaluator is missing IPC/output mounts")
    if "/workspace" in evaluator_mounts:
        raise SystemExit("learner workspace leaked into hidden evaluator container")

    evidence = {
        "schemaVersion": "1",
        "kind": "fpllm-sandbox-topology-inspection",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "invariants": {
            "learnerPrivateBundleAbsent": True,
            "evaluatorLearnerWorkspaceAbsent": True,
            "forbiddenControlPlaneEnvironmentAbsent": True,
            "networkDisabled": True,
            "readOnlyRootfs": True,
            "allCapabilitiesDropped": True,
            "noNewPrivileges": True,
            "resourceLimitsPresent": True,
            "unprivilegedUser": True,
        },
        "learnerProbe": learner,
        "hiddenEvaluator": evaluator,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(evidence["invariants"], sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

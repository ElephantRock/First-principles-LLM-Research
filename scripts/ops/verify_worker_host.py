from __future__ import annotations

import argparse
import json
import os
import platform
import re
import stat
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DIGEST_IMAGE = re.compile(r"^.+@sha256:[0-9a-f]{64}$", re.IGNORECASE)
FORBIDDEN_SANDBOX_ENV = {
    "DATABASE_URL",
    "GITHUB_TOKEN",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
    "FPLLM_PRIVATE_TEST_BUNDLE_ROOT",
    "FPLLM_PUBLIC_TEST_BUNDLE_ROOT",
}

SENTINEL = r'''
import json
import os
import socket
from pathlib import Path

status = Path('/proc/self/status').read_text(encoding='utf-8')
fields = {}
for line in status.splitlines():
    if ':' in line:
        key, value = line.split(':', 1)
        fields[key] = value.strip()

root_write_blocked = False
try:
    Path('/fpllm-root-write-test').write_text('should-not-write', encoding='utf-8')
except OSError:
    root_write_blocked = True

network_blocked = False
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(0.5)
try:
    sock.connect(('1.1.1.1', 53))
except OSError:
    network_blocked = True
finally:
    sock.close()

forbidden = sorted({
    'DATABASE_URL',
    'GITHUB_TOKEN',
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_WEBHOOK_SECRET',
    'FPLLM_PRIVATE_TEST_BUNDLE_ROOT',
    'FPLLM_PUBLIC_TEST_BUNDLE_ROOT',
}.intersection(os.environ))

print(json.dumps({
    'uid': os.getuid(),
    'gid': os.getgid(),
    'capEff': fields.get('CapEff'),
    'noNewPrivs': fields.get('NoNewPrivs'),
    'dockerSocketPresent': Path('/var/run/docker.sock').exists(),
    'forbiddenEnvironmentKeys': forbidden,
    'rootWriteBlocked': root_write_blocked,
    'externalNetworkBlocked': network_blocked,
}, sort_keys=True))
'''


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, capture_output=True, text=True)


def inspect_path(path: Path, *, require_writable: bool) -> dict[str, Any]:
    resolved = path.resolve()
    if not resolved.exists() or not resolved.is_dir():
        raise SystemExit(f"required directory missing: {resolved}")
    mode = stat.S_IMODE(resolved.stat().st_mode)
    if mode & stat.S_IWOTH:
        raise SystemExit(f"directory must not be world-writable: {resolved}")
    if require_writable and not os.access(resolved, os.W_OK | os.X_OK):
        raise SystemExit(f"directory is not writable/searchable by worker identity: {resolved}")
    return {
        "path": str(resolved),
        "mode": f"{mode:04o}",
        "writableByWorker": bool(os.access(resolved, os.W_OK | os.X_OK)),
    }


def docker_security_options(binary: str) -> list[str]:
    result = run([binary, "info", "--format", "{{json .SecurityOptions}}"])
    try:
        value = json.loads(result.stdout.strip())
    except json.JSONDecodeError as exc:
        raise SystemExit("DOCKER_SECURITY_OPTIONS_INVALID") from exc
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise SystemExit("DOCKER_SECURITY_OPTIONS_INVALID")
    options = sorted(value)
    if not any("seccomp" in item for item in options):
        raise SystemExit("DOCKER_SECCOMP_NOT_ENABLED")
    return options


def image_identity(binary: str, image: str, *, allow_local: bool) -> dict[str, Any]:
    if not allow_local and not DIGEST_IMAGE.fullmatch(image):
        raise SystemExit(f"runtime image is not digest pinned: {image}")
    result = run([
        binary,
        "image",
        "inspect",
        image,
        "--format",
        "{{json .}}",
    ])
    try:
        document = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"DOCKER_IMAGE_INSPECT_INVALID:{image}") from exc
    labels = (document.get("Config") or {}).get("Labels") or {}
    if not isinstance(labels, dict):
        labels = {}
    return {
        "reference": image,
        "imageId": document.get("Id"),
        "repoDigests": document.get("RepoDigests") or [],
        "architecture": document.get("Architecture"),
        "os": document.get("Os"),
        "fpllmRole": labels.get("io.fpllm.runtime-role"),
        "sourceRevision": labels.get("org.opencontainers.image.revision"),
    }


def sandbox_probe(binary: str, image: str, role: str) -> dict[str, Any]:
    command = [
        binary,
        "run",
        "--rm",
        "--pull=never",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=64",
        "--cpus=0.5",
        "--memory=256m",
        "--user=65532:65532",
        "--env=PYTHONDONTWRITEBYTECODE=1",
        "--env=PYTHONHASHSEED=0",
        "--env=TMPDIR=/tmp",
        "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=64m",
        image,
        "python",
        "-c",
        SENTINEL,
    ]
    result = run(command)
    try:
        evidence = json.loads(result.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError) as exc:
        raise SystemExit(f"SANDBOX_SENTINEL_OUTPUT_INVALID:{role}") from exc

    expected = {
        "uid": 65532,
        "gid": 65532,
        "capEff": "0000000000000000",
        "noNewPrivs": "1",
        "dockerSocketPresent": False,
        "forbiddenEnvironmentKeys": [],
        "rootWriteBlocked": True,
        "externalNetworkBlocked": True,
    }
    for key, value in expected.items():
        if evidence.get(key) != value:
            raise SystemExit(f"SANDBOX_SENTINEL_FAILED:{role}:{key}:{evidence.get(key)!r}")
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser(description="Fail-closed worker-host and sandbox preflight for the untrusted-code execution tier.")
    parser.add_argument("--learner-image", required=True)
    parser.add_argument("--evaluator-image", required=True)
    parser.add_argument("--docker-binary", default="docker")
    parser.add_argument("--docker-socket", type=Path, default=Path("/var/run/docker.sock"))
    parser.add_argument("--worker-temp-root", type=Path, required=True)
    parser.add_argument("--public-bundle-root", type=Path, required=True)
    parser.add_argument("--private-bundle-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--allow-local-image", action="store_true", help="CI only: permit mutable/local image references.")
    parser.add_argument("--allow-root", action="store_true", help="CI only: permit running the host verifier as root.")
    args = parser.parse_args()

    if platform.system() != "Linux":
        raise SystemExit("WORKER_HOST_MUST_BE_LINUX")
    euid = os.geteuid()
    if euid == 0 and not args.allow_root:
        raise SystemExit("WORKER_HOST_PROCESS_MUST_NOT_RUN_AS_ROOT")
    if not Path("/sys/fs/cgroup/cgroup.controllers").is_file():
        raise SystemExit("CGROUP_V2_REQUIRED")

    docker_socket = args.docker_socket.resolve()
    if not docker_socket.exists() or not stat.S_ISSOCK(docker_socket.stat().st_mode):
        raise SystemExit(f"DOCKER_SOCKET_UNAVAILABLE:{docker_socket}")
    if not os.access(docker_socket, os.R_OK | os.W_OK):
        raise SystemExit(f"DOCKER_SOCKET_NOT_ACCESSIBLE_TO_WORKER:{docker_socket}")

    docker_version = run([args.docker_binary, "version", "--format", "{{.Server.Version}}"] ).stdout.strip()
    security_options = docker_security_options(args.docker_binary)

    paths = {
        "workerTempRoot": inspect_path(args.worker_temp_root, require_writable=True),
        "publicBundleRoot": inspect_path(args.public_bundle_root, require_writable=False),
        "privateBundleRoot": inspect_path(args.private_bundle_root, require_writable=False),
    }
    public_path = Path(paths["publicBundleRoot"]["path"])
    private_path = Path(paths["privateBundleRoot"]["path"])
    temp_path = Path(paths["workerTempRoot"]["path"])
    for first, second, label in (
        (public_path, private_path, "PUBLIC_PRIVATE_BUNDLE_ROOT_OVERLAP"),
        (temp_path, private_path, "TEMP_PRIVATE_BUNDLE_ROOT_OVERLAP"),
        (temp_path, public_path, "TEMP_PUBLIC_BUNDLE_ROOT_OVERLAP"),
    ):
        if first == second or first in second.parents or second in first.parents:
            raise SystemExit(label)

    learner = image_identity(args.docker_binary, args.learner_image, allow_local=args.allow_local_image)
    evaluator = image_identity(args.docker_binary, args.evaluator_image, allow_local=args.allow_local_image)
    if learner.get("fpllmRole") not in {"learner-runtime", None if args.allow_local_image else "learner-runtime"}:
        raise SystemExit("LEARNER_IMAGE_ROLE_LABEL_INVALID")
    if evaluator.get("fpllmRole") not in {"hidden-evaluator", None if args.allow_local_image else "hidden-evaluator"}:
        raise SystemExit("EVALUATOR_IMAGE_ROLE_LABEL_INVALID")

    learner_probe = sandbox_probe(args.docker_binary, args.learner_image, "learner-runtime")
    evaluator_probe = sandbox_probe(args.docker_binary, args.evaluator_image, "hidden-evaluator")

    evidence = {
        "schemaVersion": "1",
        "kind": "fpllm-worker-host-preflight",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "host": {
            "platform": platform.platform(),
            "effectiveUid": euid,
            "cgroupV2": True,
            "dockerServerVersion": docker_version,
            "dockerSocket": str(docker_socket),
            "dockerSecurityOptions": security_options,
        },
        "paths": paths,
        "images": {
            "learnerRuntime": learner,
            "hiddenEvaluator": evaluator,
        },
        "sandboxSentinels": {
            "learnerRuntime": learner_probe,
            "hiddenEvaluator": evaluator_probe,
        },
        "invariants": {
            "workerProcessNonRoot": euid != 0,
            "cgroupV2Available": True,
            "dockerSeccompEnabled": True,
            "runtimeSocketNotMountedIntoSandboxes": True,
            "controlPlaneEnvironmentNotInheritedBySandboxes": True,
            "sandboxNetworkDefaultDeny": True,
            "sandboxRootReadOnly": True,
            "sandboxCapabilitiesDropped": True,
            "sandboxNoNewPrivileges": True,
            "sandboxUnprivilegedUid": True,
            "bundleAndTempRootsSeparated": True,
            "runtimeImagesDigestPinned": not args.allow_local_image,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(evidence["invariants"], sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

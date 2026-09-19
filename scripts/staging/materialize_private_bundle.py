from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import tarfile
from pathlib import Path, PurePosixPath
from typing import Any

MAX_ARCHIVE_BYTES = 48 * 1024
MAX_MEMBERS = 128
MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024
SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")


def safe_member_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"unsafe archive path: {name!r}")
    return path


def load_commitment(path: Path, bundle_id: str) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit("PRIVATE_BUNDLE_COMMITMENT_INVALID") from exc
    if not isinstance(document, dict):
        raise SystemExit("PRIVATE_BUNDLE_COMMITMENT_INVALID")
    if document.get("schemaVersion") != "1":
        raise SystemExit("PRIVATE_BUNDLE_COMMITMENT_SCHEMA_UNSUPPORTED")
    if document.get("testBundleId") != bundle_id:
        raise SystemExit("PRIVATE_BUNDLE_COMMITMENT_BUNDLE_MISMATCH")
    if document.get("archiveFormat") != "tar.gz":
        raise SystemExit("PRIVATE_BUNDLE_COMMITMENT_FORMAT_UNSUPPORTED")
    digest = document.get("archiveSha256")
    size = document.get("archiveBytes")
    if not isinstance(digest, str) or not SHA256_HEX.fullmatch(digest):
        raise SystemExit("PRIVATE_BUNDLE_COMMITMENT_DIGEST_INVALID")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0 or size > MAX_ARCHIVE_BYTES:
        raise SystemExit("PRIVATE_BUNDLE_COMMITMENT_SIZE_INVALID")
    return document


def verify_manifest(bundle_root: Path, commitment: dict[str, Any]) -> None:
    manifest_path = bundle_root / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit("PRIVATE_BUNDLE_MANIFEST_INVALID") from exc
    if not isinstance(manifest, dict):
        raise SystemExit("PRIVATE_BUNDLE_MANIFEST_INVALID")

    expected_pairs = (
        ("schemaVersion", commitment.get("schemaVersion")),
        ("testBundleId", commitment.get("testBundleId")),
        ("privateEvaluatorVersion", commitment.get("privateEvaluatorVersion")),
        ("adapterInterface", commitment.get("adapterInterface")),
        ("memoryTraceSchema", commitment.get("memoryTraceSchema")),
    )
    for key, expected in expected_pairs:
        if not isinstance(expected, str) or manifest.get(key) != expected:
            raise SystemExit(f"PRIVATE_BUNDLE_MANIFEST_MISMATCH:{key}")

    expected_invariants = commitment.get("hiddenInvariants")
    if not isinstance(expected_invariants, list) or not all(isinstance(value, str) for value in expected_invariants):
        raise SystemExit("PRIVATE_BUNDLE_COMMITMENT_INVARIANTS_INVALID")
    if manifest.get("hiddenInvariants") != expected_invariants:
        raise SystemExit("PRIVATE_BUNDLE_MANIFEST_MISMATCH:hiddenInvariants")
    if manifest.get("transport") != "unix" or manifest.get("runner") != "runner.py":
        raise SystemExit("PRIVATE_BUNDLE_MANIFEST_RUNTIME_CONTRACT_INVALID")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default="FPLLM_PRIVATE_BUNDLE_TAR_B64")
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument("--commitment", required=True)
    args = parser.parse_args()

    commitment = load_commitment(Path(args.commitment), args.bundle_id)

    encoded = os.environ.get(args.env, "").strip()
    if not encoded:
        raise SystemExit(f"{args.env}_REQUIRED")
    if len(encoded.encode("ascii", errors="ignore")) > MAX_ARCHIVE_BYTES * 2:
        raise SystemExit("PRIVATE_BUNDLE_SECRET_TOO_LARGE")

    try:
        archive = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise SystemExit("PRIVATE_BUNDLE_BASE64_INVALID") from exc
    if not archive or len(archive) > MAX_ARCHIVE_BYTES:
        raise SystemExit("PRIVATE_BUNDLE_ARCHIVE_SIZE_INVALID")

    archive_digest = hashlib.sha256(archive).hexdigest()
    if len(archive) != commitment["archiveBytes"] or archive_digest != commitment["archiveSha256"]:
        raise SystemExit("PRIVATE_BUNDLE_COMMITMENT_MISMATCH")

    output_root = Path(args.output_root).resolve()
    bundle_root = (output_root / args.bundle_id).resolve()
    if bundle_root.parent != output_root:
        raise SystemExit("PRIVATE_BUNDLE_ID_PATH_INVALID")
    bundle_root.mkdir(parents=True, exist_ok=True)

    total = 0
    member_count = 0
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar.getmembers():
            member_count += 1
            if member_count > MAX_MEMBERS:
                raise SystemExit("PRIVATE_BUNDLE_TOO_MANY_FILES")
            path = safe_member_path(member.name)
            if member.issym() or member.islnk() or member.isdev() or member.isfifo():
                raise SystemExit("PRIVATE_BUNDLE_SPECIAL_FILE_REJECTED")
            if member.isdir():
                target_dir = (bundle_root / path).resolve()
                if target_dir != bundle_root and bundle_root not in target_dir.parents:
                    raise SystemExit("PRIVATE_BUNDLE_PATH_ESCAPE")
                target_dir.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                raise SystemExit("PRIVATE_BUNDLE_MEMBER_TYPE_REJECTED")
            total += member.size
            if member.size < 0 or total > MAX_UNCOMPRESSED_BYTES:
                raise SystemExit("PRIVATE_BUNDLE_UNCOMPRESSED_SIZE_INVALID")
            target = (bundle_root / path).resolve()
            if bundle_root not in target.parents:
                raise SystemExit("PRIVATE_BUNDLE_PATH_ESCAPE")
            target.parent.mkdir(parents=True, exist_ok=True)
            source = tar.extractfile(member)
            if source is None:
                raise SystemExit("PRIVATE_BUNDLE_MEMBER_READ_FAILED")
            data = source.read(MAX_UNCOMPRESSED_BYTES + 1)
            if len(data) != member.size:
                raise SystemExit("PRIVATE_BUNDLE_MEMBER_SIZE_MISMATCH")
            target.write_bytes(data)
            target.chmod(0o600)

    runner = bundle_root / "runner.py"
    if not runner.is_file() or runner.stat().st_size <= 0:
        raise SystemExit("PRIVATE_BUNDLE_RUNNER_MISSING")
    verify_manifest(bundle_root, commitment)

    print(
        "private bundle materialized: "
        f"bundle={args.bundle_id} archive_sha256={archive_digest} files={member_count} bytes={total} root={bundle_root}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import argparse
import base64
import io
import os
import tarfile
from pathlib import Path, PurePosixPath

MAX_ARCHIVE_BYTES = 48 * 1024
MAX_MEMBERS = 128
MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024


def safe_member_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"unsafe archive path: {name!r}")
    return path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default="FPLLM_PRIVATE_BUNDLE_TAR_B64")
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--bundle-id", required=True)
    args = parser.parse_args()

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
                (bundle_root / path).mkdir(parents=True, exist_ok=True)
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

    print(
        f"private bundle materialized: bundle={args.bundle_id} files={member_count} bytes={total} root={bundle_root}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import stat
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

BUNDLE_ID = "phase1-causal-attention@1.0"


def build_archive() -> bytes:
    manifest = {
        "schemaVersion": "1",
        "privateEvaluatorVersion": "test",
        "testBundleId": BUNDLE_ID,
        "adapterInterface": "causal-attention-v1",
        "memoryTraceSchema": "2",
        "hiddenInvariants": [
            "attention.randomized_numerics",
            "attention.no_permanent_kv_repeat",
        ],
        "transport": "unix",
        "runner": "runner.py",
    }
    members = {
        "manifest.json": (json.dumps(manifest, sort_keys=True) + "\n").encode(),
        "runner.py": b"raise SystemExit(0)\n",
    }
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o600
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    materializer = root / "scripts" / "staging" / "materialize_private_bundle.py"
    archive = build_archive()

    commitment = {
        "schemaVersion": "1",
        "testBundleId": BUNDLE_ID,
        "privateEvaluatorVersion": "test",
        "archiveFormat": "tar.gz",
        "archiveSha256": hashlib.sha256(archive).hexdigest(),
        "archiveBytes": len(archive),
        "adapterInterface": "causal-attention-v1",
        "memoryTraceSchema": "2",
        "hiddenInvariants": [
            "attention.randomized_numerics",
            "attention.no_permanent_kv_repeat",
        ],
    }

    with tempfile.TemporaryDirectory() as temporary:
        temp = Path(temporary)
        commitment_path = temp / "commitment.json"
        output_root = temp / "private"
        commitment_path.write_text(json.dumps(commitment), encoding="utf-8")
        env = os.environ.copy()
        env["FPLLM_PRIVATE_BUNDLE_TAR_B64"] = base64.b64encode(archive).decode("ascii")
        subprocess.run(
            [
                sys.executable,
                str(materializer),
                "--output-root",
                str(output_root),
                "--bundle-id",
                BUNDLE_ID,
                "--commitment",
                str(commitment_path),
            ],
            check=True,
            env=env,
            stdout=subprocess.DEVNULL,
        )

        bundle_root = output_root / BUNDLE_ID
        for name in ("runner.py", "manifest.json"):
            path = bundle_root / name
            mode = stat.S_IMODE(path.stat().st_mode)
            if mode != 0o444:
                raise SystemExit(f"PRIVATE_BUNDLE_MODE_INVALID:{name}:{mode:o}")
            if not (mode & stat.S_IROTH):
                raise SystemExit(f"PRIVATE_BUNDLE_NOT_CROSS_UID_READABLE:{name}")

    print("private bundle materializer cross-UID readability: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "1"
SOURCE_REPOSITORY = "https://github.com/ElephantRock/First-principles-LLM-Research"
EXPECTED_TEST_BUNDLE = "phase1-causal-attention@1.0"
EXPECTED_ADAPTER = "causal-attention-v1"
EXPECTED_MEMORY_TRACE_SCHEMA = "2"
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
PINNED_FROM = re.compile(r"^FROM\s+([^\s]+)@(?P<digest>sha256:[0-9a-f]{64})(?:\s+AS\s+\S+)?$", re.IGNORECASE)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_inputs(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    files: list[tuple[str, Path]] = []
    for path in paths:
        if path.is_file():
            files.append((path.as_posix(), path))
            continue
        if not path.is_dir():
            raise SystemExit(f"provenance input does not exist: {path}")
        for child in path.rglob("*"):
            if child.is_file() and "__pycache__" not in child.parts and child.suffix != ".pyc":
                files.append((child.as_posix(), child))
    for name, file_path in sorted(files, key=lambda item: item[0]):
        encoded = name.encode("utf-8")
        digest.update(len(encoded).to_bytes(4, "big"))
        digest.update(encoded)
        with file_path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def pinned_base(dockerfile: Path) -> tuple[str, str]:
    for raw in dockerfile.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = PINNED_FROM.match(line)
        if not match:
            raise SystemExit(f"first Dockerfile instruction must pin FROM by sha256 digest: {line}")
        image = line.split("@", 1)[0].split(maxsplit=1)[1]
        return image, match.group("digest")
    raise SystemExit("Dockerfile has no FROM instruction")


def inspect_image(image: str) -> dict[str, Any]:
    process = subprocess.run(
        ["docker", "image", "inspect", image],
        check=True,
        capture_output=True,
        text=True,
    )
    documents = json.loads(process.stdout)
    if not isinstance(documents, list) or len(documents) != 1:
        raise SystemExit("docker image inspect returned an unexpected document")
    document = documents[0]
    image_id = document.get("Id")
    if not isinstance(image_id, str) or not SHA256.match(image_id):
        raise SystemExit(f"unexpected Docker image ID: {image_id!r}")
    return document


def required_label(labels: dict[str, str], key: str, expected: str) -> None:
    observed = labels.get(key)
    if observed != expected:
        raise SystemExit(f"image label {key} mismatch: expected {expected!r}, observed {observed!r}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Emit bounded provenance for an FPLLM runtime image.")
    parser.add_argument("--image", required=True)
    parser.add_argument("--role", choices=["learner-runtime", "hidden-evaluator"], required=True)
    parser.add_argument("--dockerfile", type=Path, required=True)
    parser.add_argument("--input", action="append", type=Path, default=[])
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--registry-digest")
    args = parser.parse_args()

    source_commit = args.source_commit.lower()
    if not COMMIT.match(source_commit):
        raise SystemExit("source commit must be a full lowercase 40-character Git SHA")
    if args.registry_digest is not None and not SHA256.match(args.registry_digest):
        raise SystemExit("registry digest must be sha256:<64 lowercase hex>")
    if not args.dockerfile.is_file():
        raise SystemExit(f"Dockerfile does not exist: {args.dockerfile}")

    base_image, base_digest = pinned_base(args.dockerfile)
    image = inspect_image(args.image)
    config = image.get("Config") or {}
    raw_labels = config.get("Labels") or {}
    labels = {str(k): str(v) for k, v in raw_labels.items()}
    required_label(labels, "org.opencontainers.image.source", SOURCE_REPOSITORY)
    required_label(labels, "org.opencontainers.image.revision", source_commit)
    required_label(labels, "io.fpllm.runtime-role", args.role)
    required_label(labels, "io.fpllm.test-bundle", EXPECTED_TEST_BUNDLE)
    required_label(labels, "io.fpllm.adapter-interface", EXPECTED_ADAPTER)
    required_label(labels, "io.fpllm.memory-trace-schema", EXPECTED_MEMORY_TRACE_SCHEMA)

    inputs = [args.dockerfile, *args.input]
    document = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "fpllm-runtime-image-provenance",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "repository": SOURCE_REPOSITORY,
            "commit": source_commit,
        },
        "runtimeContract": {
            "role": args.role,
            "testBundleId": EXPECTED_TEST_BUNDLE,
            "adapterInterface": EXPECTED_ADAPTER,
            "memoryTraceSchema": EXPECTED_MEMORY_TRACE_SCHEMA,
        },
        "build": {
            "dockerfile": args.dockerfile.as_posix(),
            "dockerfileSha256": sha256_file(args.dockerfile),
            "inputSha256": hash_inputs(inputs),
            "baseImage": base_image,
            "baseImageDigest": base_digest,
        },
        "image": {
            "localImageId": image["Id"],
            "repositoryTags": image.get("RepoTags") or [],
            "os": image.get("Os"),
            "architecture": image.get("Architecture"),
            "labels": {key: labels[key] for key in sorted(labels) if key.startswith("io.fpllm.") or key.startswith("org.opencontainers.image.")},
        },
        "distribution": {
            "status": "published" if args.registry_digest else "local-built",
            "registryDigest": args.registry_digest,
        },
        "builder": {
            "githubRunId": os.getenv("GITHUB_RUN_ID"),
            "githubRunAttempt": os.getenv("GITHUB_RUN_ATTEMPT"),
            "githubWorkflow": os.getenv("GITHUB_WORKFLOW"),
            "githubActor": os.getenv("GITHUB_ACTOR"),
        },
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "role": args.role, "imageId": image["Id"], "baseDigest": base_digest}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

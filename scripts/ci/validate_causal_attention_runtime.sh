#!/usr/bin/env bash
set -euo pipefail

GOOD_SHA="c29f8a28cb56d2b50d5139bae1a7747ddf495c89"
GOOD_REF="refs/heads/fixture/causal-attention-good-v1"
BAD_KV_SHA="3ccf5ba08f37c5d35b56e66b9e78993eb117d93f"
BAD_KV_REF="refs/heads/fixture/causal-attention-bad-kv-repeat-v1"
IMAGE="fpllm/test-runtime:ci"
BUNDLE_ID="phase1-causal-attention@1.0"
ROOT="$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d)"
PROBE_CLIENT="$ROOT/scripts/ci/probe_memory_trace_client.py"

cleanup() {
  docker rm -f fpllm-ci-probe-good fpllm-ci-probe-bad >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

fetch_fixture() {
  local ref="$1" expected="$2" remote_ref="$3" destination="$4"
  git fetch --no-tags --depth=1 origin "+${ref}:${remote_ref}"
  local actual
  actual="$(git rev-parse "$remote_ref")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Fixture ref drift: $ref resolved to $actual; expected $expected" >&2
    exit 1
  fi
  mkdir -p "$destination"
  git archive "$expected" | tar -x -C "$destination"
}

sandbox_common=(
  --network=none
  --read-only
  --cap-drop=ALL
  --security-opt=no-new-privileges
  --pids-limit=128
  --cpus=1
  --memory=1024m
  --user=65532:65532
  --env=PYTHONDONTWRITEBYTECODE=1
  --env=PYTHONHASHSEED=0
  --env=TMPDIR=/tmp
  --tmpfs=/tmp:rw,nosuid,nodev,noexec,size=256m
)

echo "Building learner runtime image..."
docker build --pull -f "$ROOT/infra/docker/test-runtime/Dockerfile" -t "$IMAGE" "$ROOT/infra/docker/test-runtime"

GOOD="$TMP/good"
BAD="$TMP/bad-kv"
fetch_fixture "$GOOD_REF" "$GOOD_SHA" refs/remotes/origin/fpllm-fixture-good "$GOOD"
fetch_fixture "$BAD_KV_REF" "$BAD_KV_SHA" refs/remotes/origin/fpllm-fixture-bad-kv "$BAD"

PUBLIC_OUT="$TMP/public-output"
mkdir -p "$PUBLIC_OUT"
chmod 733 "$PUBLIC_OUT"
docker run --rm \
  "${sandbox_common[@]}" \
  --mount="type=bind,source=$GOOD,target=/workspace,readonly" \
  --mount="type=bind,source=$ROOT/test-bundles/public/$BUNDLE_ID,target=/opt/fpllm/tests,readonly" \
  --mount="type=bind,source=$PUBLIC_OUT,target=/output" \
  --workdir=/workspace \
  "$IMAGE" \
  python /opt/fpllm/tests/runner.py \
    --bundle-id "$BUNDLE_ID" \
    --visibility public \
    --output /output/public.json

python - "$PUBLIC_OUT/public.json" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
doc = json.loads(p.read_text())
expected = {
    "attention.shape",
    "attention.causal",
    "attention.gqa_equivalence",
    "attention.gradients",
}
seen = {item["invariantId"] for item in doc["results"]}
if doc.get("testBundleId") != "phase1-causal-attention@1.0" or seen != expected:
    raise SystemExit(f"public bundle identity mismatch: {doc!r}")
failed = [item for item in doc["results"] if item.get("passed") is not True]
if failed:
    raise SystemExit(f"known-good public fixture failed: {failed!r}")
print("known-good public invariants: PASS")
PY

run_probe_trace() {
  local workspace="$1" container="$2" expectation="$3"
  local ipc="$TMP/ipc-$expectation"
  mkdir -p "$ipc"
  chmod 733 "$ipc"

  docker run -d --rm --name "$container" \
    "${sandbox_common[@]}" \
    --mount="type=bind,source=$workspace,target=/workspace,readonly" \
    --mount="type=bind,source=$ipc,target=/run/fpllm-ipc" \
    --workdir=/workspace \
    "$IMAGE" \
    python /opt/fpllm/probe/serve.py \
      --socket /run/fpllm-ipc/probe.sock \
      --ready-file /run/fpllm-ipc/probe.ready \
      --interface causal-attention-v1 >/dev/null

  for _ in $(seq 1 200); do
    [[ -f "$ipc/probe.ready" ]] && break
    sleep 0.05
  done
  if [[ ! -f "$ipc/probe.ready" ]]; then
    docker logs "$container" >&2 || true
    echo "probe did not become ready" >&2
    exit 1
  fi

  python "$PROBE_CLIENT" --socket "$ipc/probe.sock" --expect "$expectation"
  docker rm -f "$container" >/dev/null
}

run_probe_trace "$GOOD" fpllm-ci-probe-good clean
run_probe_trace "$BAD" fpllm-ci-probe-bad materialized

echo "causal-attention runtime image + fixture validation: PASS"

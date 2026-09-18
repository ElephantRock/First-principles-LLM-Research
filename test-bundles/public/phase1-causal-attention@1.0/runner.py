from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, "/opt/fpllm")
from probe import protocol  # type: ignore  # runtime-owned module
from probe.adapters import causal_attention_v1 as adapter  # type: ignore

TEST_BUNDLE_ID = "phase1-causal-attention@1.0"
CONFIG = {
    "dModel": 32,
    "nHeads": 4,
    "nKvHeads": 2,
    "headDim": 8,
    "maxSeqLen": 32,
}


def values(seed: int, count: int) -> list[float]:
    rng = random.Random(seed)
    return [rng.uniform(-0.4, 0.4) for _ in range(count)]


def payload(*, batch: int, sequence: int, seed: int, parameter_seed: int, check_gradients: bool = False) -> dict[str, Any]:
    width = CONFIG["dModel"]
    return {
        "config": CONFIG,
        "parameterSeed": parameter_seed,
        "checkGradients": check_gradients,
        "input": {
            "shape": [batch, sequence, width],
            "values": values(seed, batch * sequence * width),
            "positions": list(range(sequence)),
        },
    }


def decode_tensor(document: dict[str, Any], torch: Any) -> Any:
    shape = document["shape"]
    return torch.tensor(document["values"], dtype=torch.float32).reshape(*shape)


def projection(document: dict[str, Any], key: str, torch: Any) -> tuple[Any, Any | None]:
    entry = document["parameters"][key]
    weight = decode_tensor(entry["weight"], torch)
    bias = decode_tensor(entry["bias"], torch) if "bias" in entry else None
    return weight, bias


def reference_single_token(request: dict[str, Any], response: dict[str, Any]) -> Any:
    import torch
    import torch.nn.functional as F

    x = torch.tensor(request["input"]["values"], dtype=torch.float32).reshape(*request["input"]["shape"])
    q_weight, q_bias = projection(response, "q", torch)
    k_weight, k_bias = projection(response, "k", torch)
    v_weight, v_bias = projection(response, "v", torch)
    o_weight, o_bias = projection(response, "o", torch)

    b, s, _ = x.shape
    hq = CONFIG["nHeads"]
    hkv = CONFIG["nKvHeads"]
    dh = CONFIG["headDim"]
    groups = hq // hkv

    q = F.linear(x, q_weight, q_bias).view(b, s, hq, dh).transpose(1, 2)
    k = F.linear(x, k_weight, k_bias).view(b, s, hkv, dh).transpose(1, 2)
    v = F.linear(x, v_weight, v_bias).view(b, s, hkv, dh).transpose(1, 2)
    q = q.reshape(b, hkv, groups, s, dh)
    scores = torch.matmul(q, k.unsqueeze(2).transpose(-2, -1)) / math.sqrt(dh)
    probs = torch.softmax(scores.float(), dim=-1).to(dtype=q.dtype)
    grouped = torch.matmul(probs, v.unsqueeze(2))
    merged = grouped.reshape(b, hq, s, dh).transpose(1, 2).reshape(b, s, hq * dh)
    return F.linear(merged, o_weight, o_bias)


def learner_failure(exc: Exception) -> bool:
    return isinstance(exc, protocol.ProtocolError) and exc.code.startswith("LEARNER_")


def diagnostic(exc: Exception) -> str:
    if isinstance(exc, protocol.ProtocolError):
        return f"{exc.code}: {exc.message}"[:600]
    return "Unexpected public-test runtime failure."


def run_invariant(group_id: str, invariant_id: str, fn: Callable[[], tuple[bool, str, dict[str, Any] | None]]) -> dict[str, Any]:
    try:
        passed, summary, evidence = fn()
    except Exception as exc:
        if not learner_failure(exc):
            raise
        passed = False
        summary = diagnostic(exc)
        evidence = {"diagnosticCode": getattr(exc, "code", "LEARNER_FAILURE")}
    result: dict[str, Any] = {
        "groupId": group_id,
        "invariantId": invariant_id,
        "passed": bool(passed),
        "summary": summary[:1000],
    }
    if evidence is not None:
        result["evidence"] = evidence
    return result


def test_shape() -> tuple[bool, str, dict[str, Any]]:
    request = payload(batch=2, sequence=5, seed=101, parameter_seed=11)
    response = adapter.handle("attention.forward", request)
    observed = response["output"]["shape"]
    expected = [2, 5, CONFIG["dModel"]]
    passed = observed == expected
    return passed, "Output shape matches [B,S,d_model]." if passed else f"Expected {expected}; observed {observed}.", {"expected": expected, "observed": observed}


def test_causal() -> tuple[bool, str, dict[str, Any]]:
    first = payload(batch=1, sequence=6, seed=202, parameter_seed=12)
    second = json.loads(json.dumps(first))
    width = CONFIG["dModel"]
    prefix = 3
    mutated = values(909, (6 - prefix) * width)
    second["input"]["values"][prefix * width :] = mutated
    first_result = adapter.handle("attention.forward", first)
    second_result = adapter.handle("attention.forward", second)

    import torch

    a = decode_tensor(first_result["output"], torch)
    b = decode_tensor(second_result["output"], torch)
    delta = float((a[:, :prefix] - b[:, :prefix]).abs().max().item())
    passed = delta <= 2e-5
    return passed, "Future-token perturbations do not alter earlier outputs." if passed else f"Earlier outputs changed by max abs {delta:.3e}.", {"prefixLength": prefix, "maxAbsDelta": delta, "tolerance": 2e-5}


def test_gqa_reference() -> tuple[bool, str, dict[str, Any]]:
    # S=1 keeps RoPE at position zero equal to the identity while still testing
    # the grouped-query head mapping and projection/output algebra.
    request = payload(batch=2, sequence=1, seed=303, parameter_seed=13)
    response = adapter.handle("attention.forward", request)

    import torch

    observed = decode_tensor(response["output"], torch)
    expected = reference_single_token(request, response)
    delta = float((observed - expected).abs().max().item())
    passed = torch.allclose(observed, expected, rtol=2e-4, atol=2e-5)
    return bool(passed), "Grouped-query output matches the explicit reference computation." if passed else f"Reference mismatch; max abs error {delta:.3e}.", {"maxAbsError": delta, "rtol": 2e-4, "atol": 2e-5, "trialSequenceLength": 1}


def test_gradients() -> tuple[bool, str, dict[str, Any]]:
    request = payload(batch=2, sequence=4, seed=404, parameter_seed=14, check_gradients=True)
    response = adapter.handle("attention.forward", request)
    gradients = response.get("gradients", {})
    passed = gradients == {"q": True, "k": True, "v": True, "o": True}
    return passed, "Finite non-zero gradients reach Q/K/V/O projection weights." if passed else "At least one Q/K/V/O projection did not receive a finite non-zero gradient.", {"projectionGradients": gradients}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument("--visibility", required=True, choices=["public"])
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.bundle_id != TEST_BUNDLE_ID:
        raise SystemExit("TEST_BUNDLE_ID_MISMATCH")

    results = [
        run_invariant("shape", "attention.shape", test_shape),
        run_invariant("causal", "attention.causal", test_causal),
        run_invariant("gqa", "attention.gqa_equivalence", test_gqa_reference),
        run_invariant("grad", "attention.gradients", test_gradients),
    ]
    document = {"schemaVersion": "1", "testBundleId": TEST_BUNDLE_ID, "results": results}
    output = Path(args.output)
    output.write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

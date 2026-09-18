from __future__ import annotations

import argparse
import json
import math
import socket

PROTOCOL = "fpllm-probe/1"


def payload() -> dict:
    values = [math.sin(i * 0.173) * 0.3 for i in range(4 * 32)]
    return {
        "protocol": PROTOCOL,
        "requestId": "ci-memory-trace-1",
        "operation": "attention.memory_trace",
        "payload": {
            "config": {
                "dModel": 32,
                "nHeads": 4,
                "nKvHeads": 2,
                "headDim": 8,
                "maxSeqLen": 32,
            },
            "parameterSeed": 17,
            "checkGradients": False,
            "input": {
                "shape": [1, 4, 32],
                "values": values,
                "positions": [0, 1, 2, 3],
            },
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True)
    parser.add_argument("--expect", choices=["clean", "materialized"], required=True)
    args = parser.parse_args()

    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(20)
        client.connect(args.socket)
        stream = client.makefile("rwb", buffering=0)
        stream.write(json.dumps(payload(), separators=(",", ":")).encode() + b"\n")
        line = stream.readline(1024 * 1024 + 2)

    if not line or len(line) > 1024 * 1024 + 1:
        raise SystemExit("probe response missing or oversized")
    response = json.loads(line)
    if response.get("protocol") != PROTOCOL or response.get("requestId") != "ci-memory-trace-1":
        raise SystemExit(f"probe response identity mismatch: {response!r}")
    if response.get("ok") is not True:
        raise SystemExit(f"probe returned error: {response.get('error')!r}")

    trace = response["result"]["memoryTrace"]
    if trace.get("schemaVersion") != "2":
        raise SystemExit(f"unexpected memory trace schema: {trace!r}")
    events = trace.get("materializedKvExpansionEvents")
    if not isinstance(events, list):
        raise SystemExit("materializedKvExpansionEvents missing")

    if args.expect == "clean" and events:
        raise SystemExit(f"known-good fixture produced KV materialization events: {events!r}")
    if args.expect == "materialized" and not events:
        raise SystemExit("known-bad repeat_interleave fixture produced no KV materialization events")

    print(json.dumps({"expectation": args.expect, "materializedKvExpansionEvents": len(events)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

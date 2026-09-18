from __future__ import annotations

import argparse
import os
import socket
import sys
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from probe import protocol
from probe.adapters import causal_attention_v1

IPC_ROOT = Path("/run/fpllm-ipc")
INTERFACES = {
    causal_attention_v1.INTERFACE_ID: causal_attention_v1,
}


def _contained_ipc_path(value: str, *, kind: str) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute():
        raise protocol.ProtocolError("IPC_PATH_INVALID", f"{kind} path must be absolute.")
    parent = candidate.parent.resolve(strict=False)
    if parent != IPC_ROOT:
        raise protocol.ProtocolError("IPC_PATH_INVALID", f"{kind} path must live directly under {IPC_ROOT}.")
    if candidate.name in {"", ".", ".."} or len(candidate.name) > 128:
        raise protocol.ProtocolError("IPC_PATH_INVALID", f"{kind} filename is invalid.")
    return candidate


def _serve_connection(conn: socket.socket, adapter: Any) -> None:
    seen_request_ids: set[str] = set()
    with conn, conn.makefile("rwb", buffering=0) as stream:
        for _request_number in range(1, protocol.MAX_REQUESTS + 1):
            try:
                frame = protocol.read_frame(stream)
            except EOFError:
                return
            except protocol.ProtocolError:
                return

            request_id = "invalid-request"
            try:
                request_id, operation, payload = protocol.validate_request(frame)
                if request_id in seen_request_ids:
                    raise protocol.ProtocolError("REQUEST_ID_DUPLICATE", "requestId was already used on this connection.")
                seen_request_ids.add(request_id)

                if operation == "describe":
                    if payload:
                        raise protocol.ProtocolError("DESCRIBE_PAYLOAD_INVALID", "describe payload must be empty.")
                    result = adapter.describe()
                else:
                    result = adapter.handle(operation, payload)
                protocol.write_frame(stream, protocol.ok_response(request_id, result))
            except Exception as exc:
                try:
                    protocol.write_frame(stream, protocol.error_response(request_id, exc))
                except Exception:
                    return


def main() -> int:
    parser = argparse.ArgumentParser(description="Bounded learner probe server")
    parser.add_argument("--socket", required=True)
    parser.add_argument("--ready-file", required=True)
    parser.add_argument("--interface", required=True, choices=sorted(INTERFACES))
    args = parser.parse_args()

    socket_path = _contained_ipc_path(args.socket, kind="socket")
    ready_path = _contained_ipc_path(args.ready_file, kind="ready-file")
    adapter = INTERFACES[args.interface]

    IPC_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        socket_path.unlink(missing_ok=True)
        ready_path.unlink(missing_ok=True)
        os.umask(0o077)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(str(socket_path))
            os.chmod(socket_path, 0o600)
            server.listen(1)
            ready_path.write_text(protocol.PROTOCOL_ID + "\n", encoding="utf-8")
            os.chmod(ready_path, 0o600)
            conn, _ = server.accept()
            _serve_connection(conn, adapter)
        return 0
    finally:
        ready_path.unlink(missing_ok=True)
        socket_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())

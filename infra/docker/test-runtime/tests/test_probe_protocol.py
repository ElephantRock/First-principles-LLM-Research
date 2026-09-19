from __future__ import annotations

import io
import socket
import sys
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from probe import protocol
from probe import serve
from probe.adapters import causal_attention_v1


class ProbeProtocolTests(unittest.TestCase):
    def _round_trip(self, frames: list[dict]) -> list[dict]:
        server_sock, client_sock = socket.socketpair()
        thread = threading.Thread(
            target=serve._serve_connection,
            args=(server_sock, causal_attention_v1),
            daemon=True,
        )
        thread.start()
        responses: list[dict] = []
        with client_sock, client_sock.makefile("rwb", buffering=0) as stream:
            for frame in frames:
                protocol.write_frame(stream, frame)
                responses.append(protocol.read_frame(stream))
        thread.join(timeout=2)
        self.assertFalse(thread.is_alive())
        return responses

    def test_describe_handshake(self) -> None:
        response = self._round_trip([
            {
                "protocol": protocol.PROTOCOL_ID,
                "requestId": "r-1",
                "operation": "describe",
                "payload": {},
            }
        ])[0]
        self.assertTrue(response["ok"])
        self.assertEqual(response["requestId"], "r-1")
        self.assertEqual(response["result"]["interface"], "causal-attention-v1")
        self.assertEqual(
            response["result"]["capabilities"],
            ["attention.forward", "attention.memory_trace"],
        )

    def test_duplicate_request_id_is_rejected(self) -> None:
        request = {
            "protocol": protocol.PROTOCOL_ID,
            "requestId": "same-id",
            "operation": "describe",
            "payload": {},
        }
        first, second = self._round_trip([request, request])
        self.assertTrue(first["ok"])
        self.assertFalse(second["ok"])
        self.assertEqual(second["error"]["code"], "REQUEST_ID_DUPLICATE")

    def test_unknown_operation_is_structured_error(self) -> None:
        response = self._round_trip([
            {
                "protocol": protocol.PROTOCOL_ID,
                "requestId": "r-unknown",
                "operation": "python.eval",
                "payload": {},
            }
        ])[0]
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "OPERATION_NOT_ALLOWED")

    def test_non_object_payload_is_rejected(self) -> None:
        request = {
            "protocol": protocol.PROTOCOL_ID,
            "requestId": "r-payload",
            "operation": "describe",
            "payload": [],
        }
        response = self._round_trip([request])[0]
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "PAYLOAD_INVALID")

    def test_oversized_frame_is_rejected_before_json_parse(self) -> None:
        raw = b"{" + b"x" * protocol.MAX_FRAME_BYTES + b"}\n"
        with self.assertRaises(protocol.ProtocolError) as context:
            protocol.read_frame(io.BytesIO(raw))
        self.assertEqual(context.exception.code, "FRAME_TOO_LARGE")

    def test_response_encoder_enforces_one_mebibyte_limit(self) -> None:
        sink = io.BytesIO()
        with self.assertRaises(protocol.ProtocolError) as context:
            protocol.write_frame(
                sink,
                protocol.ok_response("r-big", {"payload": "x" * protocol.MAX_FRAME_BYTES}),
            )
        self.assertEqual(context.exception.code, "RESPONSE_TOO_LARGE")


if __name__ == "__main__":
    unittest.main()

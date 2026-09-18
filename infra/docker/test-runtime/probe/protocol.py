from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, BinaryIO

PROTOCOL_ID = "fpllm-probe/1"
MAX_FRAME_BYTES = 1024 * 1024
MAX_REQUESTS = 512
MAX_REQUEST_ID_CHARS = 128
MAX_OPERATION_CHARS = 96
MAX_DIAGNOSTIC_CHARS = 1000


@dataclass(frozen=True)
class ProtocolError(Exception):
    code: str
    message: str

    def __str__(self) -> str:
        return self.message


def _bounded_text(value: object, limit: int = MAX_DIAGNOSTIC_CHARS) -> str:
    text = str(value).replace("\x00", "�")
    return text[:limit]


def read_frame(stream: BinaryIO) -> dict[str, Any]:
    raw = stream.readline(MAX_FRAME_BYTES + 2)
    if raw == b"":
        raise EOFError
    if len(raw) > MAX_FRAME_BYTES + 1 or not raw.endswith(b"\n"):
        raise ProtocolError("FRAME_TOO_LARGE", "Protocol frame exceeded the 1 MiB JSONL limit.")
    payload = raw[:-1]
    if len(payload) > MAX_FRAME_BYTES:
        raise ProtocolError("FRAME_TOO_LARGE", "Protocol frame exceeded the 1 MiB JSONL limit.")
    try:
        decoded = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ProtocolError("FRAME_UTF8_INVALID", "Protocol frame was not valid UTF-8.") from exc
    try:
        value = json.loads(decoded)
    except json.JSONDecodeError as exc:
        raise ProtocolError("FRAME_JSON_INVALID", "Protocol frame was not valid JSON.") from exc
    if not isinstance(value, dict):
        raise ProtocolError("FRAME_OBJECT_REQUIRED", "Protocol frames must be JSON objects.")
    return value


def write_frame(stream: BinaryIO, value: dict[str, Any]) -> None:
    encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(encoded) > MAX_FRAME_BYTES:
        raise ProtocolError("RESPONSE_TOO_LARGE", "Protocol response exceeded the 1 MiB JSONL limit.")
    stream.write(encoded + b"\n")
    stream.flush()


def validate_request(value: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    if value.get("protocol") != PROTOCOL_ID:
        raise ProtocolError("PROTOCOL_MISMATCH", f"Expected protocol {PROTOCOL_ID}.")
    request_id = value.get("requestId")
    if not isinstance(request_id, str) or not request_id or len(request_id) > MAX_REQUEST_ID_CHARS:
        raise ProtocolError("REQUEST_ID_INVALID", "requestId must be a non-empty bounded string.")
    operation = value.get("operation")
    if not isinstance(operation, str) or not operation or len(operation) > MAX_OPERATION_CHARS:
        raise ProtocolError("OPERATION_INVALID", "operation must be a non-empty bounded string.")
    payload = value.get("payload")
    if not isinstance(payload, dict):
        raise ProtocolError("PAYLOAD_INVALID", "payload must be a JSON object.")
    return request_id, operation, payload


def ok_response(request_id: str, result: dict[str, Any]) -> dict[str, Any]:
    return {
        "protocol": PROTOCOL_ID,
        "requestId": request_id,
        "ok": True,
        "result": result,
    }


def error_response(request_id: str, error: ProtocolError | Exception) -> dict[str, Any]:
    if isinstance(error, ProtocolError):
        code = error.code
        message = error.message
    else:
        code = "ADAPTER_EXECUTION_FAILED"
        message = "The runtime-owned adapter could not complete the request."
    return {
        "protocol": PROTOCOL_ID,
        "requestId": request_id,
        "ok": False,
        "error": {
            "code": code,
            "message": _bounded_text(message),
        },
    }

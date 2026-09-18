from __future__ import annotations

import importlib
import inspect
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Iterable

from ..protocol import ProtocolError

INTERFACE_ID = "causal-attention-v1"
CAPABILITIES = ("attention.forward", "attention.memory_trace")

MAX_BATCH = 2
MAX_SEQUENCE = 16
MAX_D_MODEL = 64
MAX_TENSOR_VALUES = MAX_BATCH * MAX_SEQUENCE * MAX_D_MODEL
MAX_PARAMETER_VALUES = 32_768


@dataclass(frozen=True)
class AttentionConfig:
    d_model: int
    n_heads: int
    n_kv_heads: int
    head_dim: int
    max_seq_len: int

    @property
    def group_size(self) -> int:
        return self.n_heads // self.n_kv_heads


def describe() -> dict[str, Any]:
    return {
        "interface": INTERFACE_ID,
        "capabilities": list(CAPABILITIES),
        "limits": {
            "maxBatch": MAX_BATCH,
            "maxSequence": MAX_SEQUENCE,
            "maxDModel": MAX_D_MODEL,
            "maxTensorValues": MAX_TENSOR_VALUES,
        },
    }


def _integer(value: Any, *, name: str, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum or value > maximum:
        raise ProtocolError("ADAPTER_CONFIG_INVALID", f"{name} is outside the supported adapter bounds.")
    return value


def _parse_config(payload: dict[str, Any]) -> AttentionConfig:
    raw = payload.get("config")
    if not isinstance(raw, dict):
        raise ProtocolError("ADAPTER_CONFIG_INVALID", "config must be an object.")
    d_model = _integer(raw.get("dModel"), name="dModel", minimum=8, maximum=MAX_D_MODEL)
    n_heads = _integer(raw.get("nHeads"), name="nHeads", minimum=1, maximum=16)
    n_kv_heads = _integer(raw.get("nKvHeads"), name="nKvHeads", minimum=1, maximum=n_heads)
    head_dim = _integer(raw.get("headDim"), name="headDim", minimum=1, maximum=MAX_D_MODEL)
    max_seq_len = _integer(raw.get("maxSeqLen", MAX_SEQUENCE), name="maxSeqLen", minimum=1, maximum=128)
    if d_model != n_heads * head_dim or n_heads % n_kv_heads != 0:
        raise ProtocolError("ADAPTER_CONFIG_INVALID", "dModel/head counts do not form a legal grouped-query configuration.")
    return AttentionConfig(
        d_model=d_model,
        n_heads=n_heads,
        n_kv_heads=n_kv_heads,
        head_dim=head_dim,
        max_seq_len=max_seq_len,
    )


def _runtime_config(config: AttentionConfig) -> SimpleNamespace:
    return SimpleNamespace(
        vocab_size=256,
        max_seq_len=config.max_seq_len,
        n_layers=1,
        d_model=config.d_model,
        n_heads=config.n_heads,
        n_kv_heads=config.n_kv_heads,
        head_dim=config.head_dim,
        d_ff=max(32, config.d_model * 2),
        dropout=0.0,
        bias=False,
        rms_norm_eps=1e-5,
        rope_theta=10_000.0,
        tie_embeddings=True,
    )


def _import_attention_class() -> type[Any]:
    workspace = Path("/workspace")
    for candidate in (workspace / "src", workspace):
        text = str(candidate)
        if text not in sys.path:
            sys.path.insert(0, text)
    try:
        module = importlib.import_module("fpllm.model.attention")
    except Exception as exc:
        raise ProtocolError("LEARNER_IMPORT_FAILED", "Could not import fpllm.model.attention.") from exc
    cls = getattr(module, "CausalSelfAttention", None)
    if not inspect.isclass(cls):
        raise ProtocolError("LEARNER_INTERFACE_MISSING", "CausalSelfAttention was not found in fpllm.model.attention.")
    return cls


def _construct_attention(config: AttentionConfig) -> Any:
    cls = _import_attention_class()
    runtime_config = _runtime_config(config)
    signature = inspect.signature(cls)
    parameters = list(signature.parameters.values())
    if len(parameters) == 1 and parameters[0].kind in (
        inspect.Parameter.POSITIONAL_ONLY,
        inspect.Parameter.POSITIONAL_OR_KEYWORD,
    ):
        try:
            return cls(runtime_config)
        except Exception as exc:
            raise ProtocolError("LEARNER_CONSTRUCTION_FAILED", "CausalSelfAttention(config) failed.") from exc

    known = {
        "config": runtime_config,
        "d_model": config.d_model,
        "n_heads": config.n_heads,
        "n_kv_heads": config.n_kv_heads,
        "head_dim": config.head_dim,
        "max_seq_len": config.max_seq_len,
        "dropout": 0.0,
        "bias": False,
    }
    kwargs: dict[str, Any] = {}
    required_unknown: list[str] = []
    accepts_kwargs = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in parameters)
    for parameter in parameters:
        if parameter.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if parameter.name in known:
            kwargs[parameter.name] = known[parameter.name]
        elif parameter.default is inspect.Parameter.empty:
            required_unknown.append(parameter.name)
    if required_unknown:
        raise ProtocolError(
            "LEARNER_CONSTRUCTOR_UNSUPPORTED",
            "CausalSelfAttention constructor does not match the course adapter contract.",
        )
    if accepts_kwargs:
        kwargs = {**known, **kwargs}
    try:
        return cls(**kwargs)
    except Exception as exc:
        raise ProtocolError("LEARNER_CONSTRUCTION_FAILED", "CausalSelfAttention construction failed.") from exc


def _parse_input(payload: dict[str, Any], config: AttentionConfig, torch: Any) -> tuple[Any, Any | None]:
    raw = payload.get("input")
    if not isinstance(raw, dict):
        raise ProtocolError("ADAPTER_INPUT_INVALID", "input must be an object.")
    shape = raw.get("shape")
    values = raw.get("values")
    if (
        not isinstance(shape, list)
        or len(shape) != 3
        or any(not isinstance(v, int) or isinstance(v, bool) for v in shape)
    ):
        raise ProtocolError("ADAPTER_INPUT_INVALID", "input.shape must be [B,S,D].")
    batch, sequence, width = shape
    if batch < 1 or batch > MAX_BATCH or sequence < 1 or sequence > MAX_SEQUENCE or width != config.d_model:
        raise ProtocolError("ADAPTER_INPUT_INVALID", "input shape is outside the bounded causal-attention domain.")
    expected = batch * sequence * width
    if expected > MAX_TENSOR_VALUES or not isinstance(values, list) or len(values) != expected:
        raise ProtocolError("ADAPTER_INPUT_INVALID", "input.values does not match the declared bounded shape.")
    if any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(float(v)) for v in values):
        raise ProtocolError("ADAPTER_INPUT_INVALID", "input.values must contain finite numbers only.")
    x = torch.tensor(values, dtype=torch.float32).reshape(batch, sequence, width)

    positions_raw = raw.get("positions")
    positions = None
    if positions_raw is not None:
        if (
            not isinstance(positions_raw, list)
            or len(positions_raw) != sequence
            or any(not isinstance(v, int) or isinstance(v, bool) or v < 0 or v >= config.max_seq_len for v in positions_raw)
        ):
            raise ProtocolError("ADAPTER_INPUT_INVALID", "positions must be a bounded integer vector with length S.")
        positions = torch.tensor(positions_raw, dtype=torch.long)
    return x, positions


def _call_forward(model: Any, x: Any, positions: Any | None) -> Any:
    try:
        if positions is None:
            return model(x)
        return model(x, positions=positions)
    except TypeError:
        try:
            return model(x, positions)
        except Exception as exc:
            raise ProtocolError("LEARNER_FORWARD_FAILED", "CausalSelfAttention.forward failed.") from exc
    except Exception as exc:
        raise ProtocolError("LEARNER_FORWARD_FAILED", "CausalSelfAttention.forward failed.") from exc


def _normalize_projection_name(name: str) -> str | None:
    lowered = name.lower().replace(".", "_")
    patterns = {
        "q": ("q_proj", "query", "wq", "to_q"),
        "k": ("k_proj", "key", "wk", "to_k"),
        "v": ("v_proj", "value", "wv", "to_v"),
        "o": ("o_proj", "out_proj", "output", "wo", "to_out"),
    }
    for key, aliases in patterns.items():
        if any(alias in lowered for alias in aliases):
            return key
    return None


def _projection_parameters(model: Any, config: AttentionConfig) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    total_values = 0
    for name, parameter in model.named_parameters():
        key = _normalize_projection_name(name)
        if key is None:
            continue
        suffix = "bias" if name.lower().endswith("bias") else "weight" if name.lower().endswith("weight") else None
        if suffix is None:
            continue
        tensor = parameter.detach().to(dtype=parameter.dtype, device="cpu").float().contiguous()
        values = tensor.numel()
        total_values += values
        if total_values > MAX_PARAMETER_VALUES:
            raise ProtocolError("ADAPTER_PARAMETER_LIMIT", "Projection parameters exceeded the bounded probe limit.")
        result.setdefault(key, {})[suffix] = {
            "shape": list(tensor.shape),
            "values": tensor.reshape(-1).tolist(),
        }
    missing = [key for key in ("q", "k", "v", "o") if key not in result or "weight" not in result[key]]
    if missing:
        raise ProtocolError("LEARNER_PROJECTIONS_UNRESOLVED", "Could not resolve Q/K/V/O projection weights from named parameters.")

    expected_shapes = {
        "q": [config.d_model, config.d_model],
        "k": [config.n_kv_heads * config.head_dim, config.d_model],
        "v": [config.n_kv_heads * config.head_dim, config.d_model],
        "o": [config.d_model, config.d_model],
    }
    for key, expected in expected_shapes.items():
        if result[key]["weight"]["shape"] != expected:
            raise ProtocolError("LEARNER_PROJECTION_SHAPE_INVALID", f"{key.upper()} projection shape did not match grouped-query attention.")
    return result


def _gradient_summary(model: Any) -> dict[str, bool]:
    summary = {"q": False, "k": False, "v": False, "o": False}
    for name, parameter in model.named_parameters():
        key = _normalize_projection_name(name)
        if key not in summary or not name.lower().endswith("weight"):
            continue
        grad = parameter.grad
        if grad is not None:
            finite = bool(grad.detach().isfinite().all().item())
            nonzero = bool((grad.detach().abs() > 0).any().item())
            summary[key] = finite and nonzero
    return summary


def _flatten_shapes(value: Any) -> Iterable[list[int]]:
    try:
        import torch
    except Exception:
        return []
    shapes: list[list[int]] = []
    if isinstance(value, torch.Tensor):
        shapes.append(list(value.shape))
    elif isinstance(value, (list, tuple)):
        for item in value:
            shapes.extend(_flatten_shapes(item))
    elif isinstance(value, dict):
        for item in value.values():
            shapes.extend(_flatten_shapes(item))
    return shapes


class _HeadExpansionTrace:
    """Record learner-visible KV materialization before attention matmul.

    PyTorch may internally expand/clone a broadcast operand while lowering
    matmul/bmm. Those backend temporaries are not evidence that learner code
    permanently duplicated K/V. The stronger signal is a materialized grouped
    KV tensor that is flattened back into an Hq-shaped learner-visible tensor
    *before* the first attention bmm, or a direct materializing op that maps an
    Hkv-shaped tensor to an Hq-shaped tensor before that bmm.
    """

    MATERIALIZING_TOKENS = ("repeat", "repeat_interleave", "clone", "index_select", "gather", "cat")

    def __init__(self, torch: Any, config: AttentionConfig):
        self.torch = torch
        self.config = config
        self.events: list[dict[str, Any]] = []
        self.materialized_kv_events: list[dict[str, Any]] = []
        self._mode = None
        self._seen_attention_bmm = False
        self._pending_grouped_clone = False

    def _is_grouped_shape(self, shape: list[int]) -> bool:
        return (
            len(shape) == 5
            and shape[1] == self.config.n_kv_heads
            and shape[2] == self.config.group_size
            and shape[-1] == self.config.head_dim
        )

    def _is_query_head_shape(self, shape: list[int]) -> bool:
        return (
            len(shape) == 4
            and shape[1] == self.config.n_heads
            and shape[-1] == self.config.head_dim
        )

    def _is_kv_head_shape(self, shape: list[int]) -> bool:
        return (
            len(shape) == 4
            and shape[1] == self.config.n_kv_heads
            and shape[-1] == self.config.head_dim
        )

    def _record(self, reason: str, func_name: str, before: list[list[int]], after: list[list[int]]) -> None:
        if len(self.materialized_kv_events) >= 16:
            return
        event = {
            "reason": reason,
            "op": func_name[:160],
            "inputShapes": before[:8],
            "outputShapes": after[:8],
        }
        self.materialized_kv_events.append(event)
        self.events.append(event)

    def __enter__(self) -> "_HeadExpansionTrace":
        try:
            from torch.utils._python_dispatch import TorchDispatchMode
        except Exception:
            return self

        owner = self

        class Mode(TorchDispatchMode):
            def __torch_dispatch__(self, func, types, args=(), kwargs=None):
                kwargs = kwargs or {}
                before = list(_flatten_shapes(args)) + list(_flatten_shapes(kwargs))
                result = func(*args, **kwargs)
                after = list(_flatten_shapes(result))
                func_name = str(func)

                if owner._seen_attention_bmm:
                    return result

                if "aten.bmm" in func_name:
                    owner._seen_attention_bmm = True
                    owner._pending_grouped_clone = False
                    return result

                materializing = any(token in func_name for token in owner.MATERIALIZING_TOKENS)
                if materializing and any(owner._is_grouped_shape(shape) for shape in after):
                    owner._pending_grouped_clone = True

                direct_kv_to_hq = (
                    materializing
                    and any(owner._is_kv_head_shape(shape) for shape in before)
                    and any(owner._is_query_head_shape(shape) for shape in after)
                )
                if direct_kv_to_hq:
                    owner._record("direct-materialized-kv-to-query-heads", func_name, before, after)
                    owner._pending_grouped_clone = False
                    return result

                grouped_to_hq_view = (
                    owner._pending_grouped_clone
                    and ("view" in func_name or "reshape" in func_name)
                    and any(owner._is_grouped_shape(shape) for shape in before)
                    and any(owner._is_query_head_shape(shape) for shape in after)
                )
                if grouped_to_hq_view:
                    owner._record("materialized-grouped-kv-flattened-to-query-heads", func_name, before, after)
                    owner._pending_grouped_clone = False

                return result

        self._mode = Mode()
        self._mode.__enter__()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._mode is not None:
            self._mode.__exit__(exc_type, exc, tb)


def _execute_forward(payload: dict[str, Any], *, trace_memory: bool) -> dict[str, Any]:
    try:
        import torch
    except Exception as exc:
        raise ProtocolError("RUNTIME_TORCH_UNAVAILABLE", "The learner runtime does not contain PyTorch.") from exc

    config = _parse_config(payload)
    seed = _integer(payload.get("parameterSeed", 0), name="parameterSeed", minimum=0, maximum=2**31 - 1)
    torch.manual_seed(seed)
    model = _construct_attention(config)
    if not hasattr(model, "named_parameters"):
        raise ProtocolError("LEARNER_INTERFACE_INVALID", "CausalSelfAttention must be a torch.nn.Module.")
    model.eval()
    x, positions = _parse_input(payload, config, torch)
    check_gradients = bool(payload.get("checkGradients", False))
    if check_gradients:
        x.requires_grad_(True)

    trace = _HeadExpansionTrace(torch, config)
    with trace if trace_memory else _NullContext():
        output = _call_forward(model, x, positions)
    if not isinstance(output, torch.Tensor):
        raise ProtocolError("LEARNER_OUTPUT_INVALID", "CausalSelfAttention.forward must return a tensor.")
    output_shape = list(output.shape)

    gradient_summary = None
    if check_gradients:
        try:
            output.float().square().mean().backward()
        except Exception as exc:
            raise ProtocolError("LEARNER_BACKWARD_FAILED", "Backward through CausalSelfAttention failed.") from exc
        gradient_summary = _gradient_summary(model)

    result: dict[str, Any] = {
        "output": {
            "shape": output_shape,
            "values": output.detach().to(device="cpu").float().contiguous().reshape(-1).tolist(),
        },
        "parameters": _projection_parameters(model, config),
        "runtime": {
            "torchVersion": str(torch.__version__)[:80],
            "device": "cpu",
        },
    }
    if gradient_summary is not None:
        result["gradients"] = gradient_summary
    if trace_memory:
        result["memoryTrace"] = {
            "schemaVersion": "2",
            "headExpansionEvents": trace.events,
            "materializedKvExpansionEvents": trace.materialized_kv_events,
            "decisionHint": "fail-if-materializedKvExpansionEvents-nonempty",
        }
    return result


class _NullContext:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return None


def handle(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    if operation == "attention.forward":
        return _execute_forward(payload, trace_memory=False)
    if operation == "attention.memory_trace":
        return _execute_forward(payload, trace_memory=True)
    raise ProtocolError("OPERATION_NOT_ALLOWED", "The requested operation is not allowlisted by causal-attention-v1.")

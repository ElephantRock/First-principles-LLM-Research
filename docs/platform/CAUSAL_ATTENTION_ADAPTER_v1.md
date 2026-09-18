# First Principles LLM Research
## Causal Attention Runtime Adapter Contract v1

**Date:** 2026-09-18  
**Status:** IMPLEMENTED / RELEASE-CANDIDATE ABI  
**Interface:** `causal-attention-v1`  
**Test bundle:** `phase1-causal-attention@1.0`

## 1. Purpose

This contract defines the runtime-owned bridge between immutable learner source and the public/private test machinery. It is deliberately narrower than the learner repository as a whole.

The adapter imports exactly:

```text
fpllm.model.attention.CausalSelfAttention
```

from the submitted workspace and evaluates the course-defined forward surface:

```python
forward(x: torch.Tensor, positions: torch.Tensor | None = None) -> torch.Tensor
```

The adapter itself lives in the immutable learner-runtime image. A learner submission cannot replace the adapter, choose arbitrary import targets, or ask the hidden evaluator to execute an arbitrary callable.

## 2. Construction compatibility

The preferred constructor is:

```python
CausalSelfAttention(config)
```

where `config` exposes at least the canonical attention fields:

```text
d_model
n_heads
n_kv_heads
head_dim
max_seq_len
dropout
bias
rope_theta
```

For compatibility with equivalent first-principles implementations, the runtime also accepts a constructor exposing these dimensions directly as named parameters. Unknown required constructor parameters are rejected.

This compatibility rule is an adapter concern; it does not expand the lab's semantic requirements.

## 3. Bounded evaluation domain

The v1 adapter is intentionally a micro-model evaluator. It does not instantiate the 100M model for correctness tests.

Limits:

```text
batch             <= 2
sequence length   <= 16
d_model           <= 64
n_heads           <= 16
max_seq_len       <= 128
input values      <= 2 * 16 * 64
projection values <= 32,768 total
```

Legal grouped-query configurations must satisfy:

\[
d_{model}=H_qd_h
\]

and

\[
H_q \bmod H_{kv}=0.
\]

## 4. `attention.forward`

Request payload:

```json
{
  "config": {
    "dModel": 32,
    "nHeads": 4,
    "nKvHeads": 2,
    "headDim": 8,
    "maxSeqLen": 32
  },
  "parameterSeed": 13,
  "checkGradients": false,
  "input": {
    "shape": [2, 1, 32],
    "values": ["bounded finite float values"],
    "positions": [0]
  }
}
```

Response result:

```json
{
  "output": {
    "shape": [2, 1, 32],
    "values": ["float32 values"]
  },
  "parameters": {
    "q": {"weight": {"shape": [32, 32], "values": []}},
    "k": {"weight": {"shape": [16, 32], "values": []}},
    "v": {"weight": {"shape": [16, 32], "values": []}},
    "o": {"weight": {"shape": [32, 32], "values": []}}
  },
  "runtime": {
    "torchVersion": "...",
    "device": "cpu"
  }
}
```

When `checkGradients=true`, the result additionally contains:

```json
{
  "gradients": {
    "q": true,
    "k": true,
    "v": true,
    "o": true
  }
}
```

The parameter export is bounded and exists so a separate evaluator can compute an independent reference output for the same learner model. Expected outputs are never sent to the learner process.

## 5. Projection resolution

The adapter resolves Q/K/V/O projection weights only from learner `named_parameters()` using bounded, allowlisted name families such as:

```text
q_proj / query / wq / to_q
k_proj / key   / wk / to_k
v_proj / value / wv / to_v
o_proj / out_proj / output / wo / to_out
```

The expected weight shapes are:

```text
Q: [d_model, d_model]
K: [n_kv_heads * head_dim, d_model]
V: [n_kv_heads * head_dim, d_model]
O: [d_model, d_model]
```

A submission whose projection structure cannot be resolved through this course adapter fails the interface invariant rather than causing arbitrary reflection or evaluator-controlled imports.

## 6. Public numerical reference

The public `attention.gqa_equivalence` check uses a sequence length of one at position zero. This intentionally makes RoPE the identity for the numerical-reference trial while still exercising Q/K/V projection shapes, grouped-query head mapping, FP32 score softmax, value aggregation, and output projection.

Causality is checked separately by changing only future tokens and verifying earlier outputs remain invariant.

## 7. `attention.memory_trace`

`attention.memory_trace` executes the same bounded forward pass under runtime-owned PyTorch dispatch instrumentation.

The response adds:

```json
{
  "memoryTrace": {
    "schemaVersion": "1",
    "headExpansionEvents": [
      {
        "op": "bounded aten operation name",
        "inputShapes": [[1, 2, 8, 8]],
        "outputShapes": [[1, 4, 8, 8]]
      }
    ]
  }
}
```

The trace records only bounded shape transitions for operations relevant to KV-head expansion (`repeat`, `repeat_interleave`, `expand`, `clone`, `contiguous`, `reshape`, `view`). The private evaluator, not the learner probe, decides whether the trace violates `attention.no_permanent_kv_repeat`.

This is intentionally structural evidence rather than source-code inspection.

## 8. Failure classification

Learner-facing deterministic failures use bounded `LEARNER_*` adapter error codes such as:

```text
LEARNER_IMPORT_FAILED
LEARNER_INTERFACE_MISSING
LEARNER_CONSTRUCTOR_UNSUPPORTED
LEARNER_CONSTRUCTION_FAILED
LEARNER_FORWARD_FAILED
LEARNER_BACKWARD_FAILED
LEARNER_PROJECTIONS_UNRESOLVED
LEARNER_PROJECTION_SHAPE_INVALID
```

Runtime/protocol failures remain infrastructure failures and must not be converted into learner mastery failures.

## 9. Security properties

The adapter does not accept from the evaluator:

- Python import paths;
- callable names;
- source code;
- pickle/marshal payloads;
- shell commands;
- filesystem paths;
- environment variables.

All executable mapping is fixed by the immutable runtime image and interface version.

## 10. Versioning rule

Any change that alters accepted learner symbols, tensor semantics, payload fields, projection-resolution rules, numerical tolerances, trace schema, or evaluation limits requires either:

1. a new adapter/interface version; or
2. an explicit compatible patch accompanied by regression evidence against the known-good and known-bad fixture commits.

The test-bundle identity and runtime-image digest together determine the executable evaluation contract.

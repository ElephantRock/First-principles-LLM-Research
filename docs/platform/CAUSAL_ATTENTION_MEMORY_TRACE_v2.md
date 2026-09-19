# First Principles LLM Research
## Causal Attention Memory Trace Contract v2

**Date:** 2026-09-19  
**Status:** IMPLEMENTED / REGRESSION-TESTED CONTRACT  
**Adapter:** `causal-attention-v1`  
**Test bundle:** `phase1-causal-attention@1.0`

This document supersedes **Section 7 (`attention.memory_trace`)** of `CAUSAL_ATTENTION_ADAPTER_v1.md` wherever the earlier schema-1 description conflicts with this contract.

## Purpose

`attention.memory_trace` supplies bounded structural evidence for the documented invariant:

```text
attention.no_permanent_kv_repeat
```

It is not a general memory profiler and it is not source-code inspection.

## Why raw expand/clone events are not evidence

PyTorch may introduce temporary `expand` or `clone` operations internally while lowering a mathematically broadcasted `matmul`/`bmm`. Therefore the presence of an expansion-shaped backend event alone is not evidence that learner code permanently duplicated K/V heads.

The v2 trace instead detects learner-visible materialization from `H_kv` to `H_q` **before the first attention BMM**. It recognizes two bounded patterns:

1. a materializing operation such as `repeat`, `repeat_interleave`, `index_select`, `gather`, or `cat` maps `[B,H_kv,S,d_h]` to `[B,H_q,S,d_h]`; or
2. a materialized grouped tensor `[B,H_kv,G,S,d_h]` is subsequently flattened/viewed into `[B,H_q,S,d_h]` before attention BMM.

Backend temporaries introduced as part of BMM lowering are excluded from the verdict signal.

## Response schema

```json
{
  "memoryTrace": {
    "schemaVersion": "2",
    "headExpansionEvents": [],
    "materializedKvExpansionEvents": [],
    "decisionHint": "fail-if-materializedKvExpansionEvents-nonempty"
  }
}
```

`materializedKvExpansionEvents` is the evaluator-facing evidence field. The learner probe records at most 16 bounded events. The private evaluator owns the final invariant verdict.

For this adapter/test-bundle version:

```text
materializedKvExpansionEvents == []     => no detected permanent K/V head materialization
materializedKvExpansionEvents nonempty  => detected K/V materialization to H_q before attention BMM
```

## Immutable regression fixtures

```text
Known-good broadcast GQA
c29f8a28cb56d2b50d5139bae1a7747ddf495c89
expected: 0 materializedKvExpansionEvents

Known-bad repeat_interleave K/V
3ccf5ba08f37c5d35b56e66b9e78993eb117d93f
expected: >0 materializedKvExpansionEvents

Known-bad missing RoPE
636251fd92b7e81de63c40e767bef981ec9ca88a
used by randomized numerical evaluation, not by the K/V materialization verdict
```

Branch names are transport conveniences only. Evidence identity is the immutable commit SHA.

## Versioning

Changing the event semantics, accepted structural patterns, event bounds, or verdict interpretation requires either a new memory-trace schema version or an explicitly compatible patch with regression evidence against the immutable fixtures above.

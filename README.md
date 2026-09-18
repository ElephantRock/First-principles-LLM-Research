# Causal Attention release fixture: bad RoPE v1

This branch is an immutable negative worker/staging fixture for `phase1-causal-attention@1.0`.

It preserves causal grouped-query attention but deliberately omits RoPE from Q/K.

Expected hidden evidence:

- `attention.randomized_numerics` fails;
- `attention.no_permanent_kv_repeat` passes.

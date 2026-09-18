# Causal Attention release fixture: good v1

This branch is an immutable worker/staging fixture for `phase1-causal-attention@1.0`.

Expected evidence:

- all four public invariants pass;
- `attention.randomized_numerics` passes;
- `attention.no_permanent_kv_repeat` passes.

The fixture uses adjacent-pair RoPE, causal masking, grouped-query broadcasting without permanent K/V replication, FP32 score softmax, and Q/K/V/O projections.

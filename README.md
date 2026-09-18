# Causal Attention release fixture: bad KV replication v1

This branch is an immutable negative worker/staging fixture for `phase1-causal-attention@1.0`.

It is numerically correct but deliberately materializes K/V from the KV-head cardinality to the query-head cardinality with `repeat_interleave` before attention matmul.

Expected hidden evidence:

- `attention.randomized_numerics` passes;
- `attention.no_permanent_kv_repeat` fails.

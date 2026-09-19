# `phase1-causal-attention@1.0` public bundle

This directory is intentionally public. It implements the documented Causal Attention invariants used by the platform worker:

- `attention.shape`
- `attention.causal`
- `attention.gqa_equivalence`
- `attention.gradients`

The runner imports the runtime-owned `causal-attention-v1` adapter from the learner execution image; it does not import helper code from the learner repository other than the course-defined `fpllm.model.attention.CausalSelfAttention` implementation.

Hidden randomized cases, seed schedules, evaluator decisions, and private fixtures do **not** belong in this directory.

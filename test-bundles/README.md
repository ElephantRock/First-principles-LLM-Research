# Versioned execution test bundles

`test-bundles/public/` contains test logic that learners are allowed to inspect. Public bundle IDs are immutable execution identities once released.

Production private bundles are **not** stored in this public repository. Workers receive them from `FPLLM_PRIVATE_TEST_BUNDLE_ROOT` and mount them only into the separate hidden-evaluator container.

For the current vertical slice:

```text
phase1-causal-attention@1.0
```

is paired with runtime interface:

```text
causal-attention-v1
```

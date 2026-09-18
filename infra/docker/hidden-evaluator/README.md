# Hidden evaluator runtime image

The evaluator image contains the trusted Python/PyTorch runtime needed by private test bundles. It does **not** contain learner source and it does not embed production private test bundles in this public repository.

At execution time the worker mounts only:

- the private versioned test bundle read-only;
- the per-execution IPC directory;
- the bounded output directory.

`apps/worker` requires the evaluator image to be supplied by immutable digest through `FPLLM_HIDDEN_EVALUATOR_IMAGE`.

# Learner test runtime image

This image contains only runtime-owned execution machinery and PyTorch. Learner repositories are mounted read-only at `/workspace` by the worker.

The hidden-test path starts `/opt/fpllm/probe/serve.py` in this image. The probe exposes only `fpllm-probe/1` over the worker-created Unix socket and only the allowlisted `causal-attention-v1` operations.

The image tag used by a worker is not accepted as evidence identity. `apps/worker` requires a digest-pinned `FPLLM_TEST_RUNTIME_IMAGE` value at startup.

The base-image tag in this development Dockerfile is not the production provenance record. Release builds must record the resolved base digest, produced image digest, build source commit, and test-bundle identity.

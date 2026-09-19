FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea

ARG SOURCE_COMMIT=unknown

LABEL org.opencontainers.image.source="https://github.com/ElephantRock/First-principles-LLM-Research" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.title="FPLLM learner test runtime" \
      io.fpllm.runtime-role="learner-runtime" \
      io.fpllm.test-bundle="phase1-causal-attention@1.0" \
      io.fpllm.adapter-interface="causal-attention-v1" \
      io.fpllm.memory-trace-schema="2"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0

RUN useradd --system --uid 65532 --gid nogroup --home-dir /nonexistent --shell /usr/sbin/nologin fpllm-runtime \
    && mkdir -p /opt/fpllm/probe /run/fpllm-ipc \
    && chown -R 65532:65534 /run/fpllm-ipc

COPY probe /opt/fpllm/probe

USER 65532:65534
WORKDIR /workspace

ENTRYPOINT []

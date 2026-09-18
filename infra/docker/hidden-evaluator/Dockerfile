FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0

RUN useradd --system --uid 65532 --gid nogroup --home-dir /nonexistent --shell /usr/sbin/nologin fpllm-evaluator

USER 65532:65534
WORKDIR /opt/fpllm/tests

ENTRYPOINT []

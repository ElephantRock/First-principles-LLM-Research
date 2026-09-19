# First Principles LLM Research
## Runtime Image Provenance Contract v0.3

**Date:** 2026-09-19  
**Status:** IMPLEMENTED FOR CI-BUILT RELEASE CANDIDATES / REGISTRY PUBLICATION OUTSTANDING  
**Applies to:** learner runtime and hidden evaluator runtime for `phase1-causal-attention@1.0`

## 1. Purpose

A test result is not reproducible if the executable runtime is identified only by a mutable image tag. v0.3 therefore treats runtime image identity as evidence and separates two concepts that must not be conflated:

```text
local Docker image ID != published registry digest
```

A CI-built image may prove that a source revision builds and executes correctly. It does **not** become production evidence identity until the exact image is published and addressed by an immutable registry digest.

## 2. Base-image pinning

Both runtime Dockerfiles pin the Python base image by digest:

```text
python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea
```

A mutable `FROM python:3.12-slim` is not permitted for a release-candidate runtime build.

The source Dockerfiles also pin the direct PyTorch requirement to `torch==2.8.0`. Full transitive dependency lock/hashing may be strengthened later; the current provenance artifact records the Dockerfile and runtime build-input hashes so a change is visible.

## 3. Required OCI/FPLLM labels

Every runtime image must carry:

```text
org.opencontainers.image.source
org.opencontainers.image.revision
org.opencontainers.image.title
io.fpllm.runtime-role
io.fpllm.test-bundle
io.fpllm.adapter-interface
io.fpllm.memory-trace-schema
```

For this release candidate:

```text
io.fpllm.test-bundle = phase1-causal-attention@1.0
io.fpllm.adapter-interface = causal-attention-v1
io.fpllm.memory-trace-schema = 2
```

`org.opencontainers.image.revision` is the full 40-character source commit used to construct the image, not the synthetic pull-request merge commit.

## 4. CI provenance document

`scripts/release/runtime_image_provenance.py` emits one JSON document per built image. Required evidence includes:

```text
schema version
source repository
full source commit
runtime role
test-bundle identity
adapter identity
memory-trace schema
Dockerfile SHA-256
build-input SHA-256
base image reference and pinned digest
local Docker image ID
OS / architecture
OCI/FPLLM labels
GitHub Actions run identity when present
publication status
registry digest when published
```

CI artifacts use:

```text
.artifacts/runtime-release/
  learner-runtime.provenance.json
  hidden-evaluator.provenance.json
  known-good-public-evidence.json
  sandbox-topology.json
```

These artifacts are uploaded from the CI run with bounded retention. They are build evidence, not a substitute for a registry-published immutable runtime.

## 5. Publication states

### `local-built`

The image was built and inspected in a CI or staging Docker daemon. `localImageId` is available. `registryDigest` is null.

This state is sufficient for regression testing but not for production test-evidence identity.

### `published`

The exact image was pushed to the selected OCI registry and the registry returned an immutable digest:

```text
sha256:<64 lowercase hex>
```

Only this digest may be stored as the production runtime image identity used by a worker/test run.

## 6. Sandbox-topology evidence

The same release-candidate CI path starts learner-probe and hidden-evaluator containers under the intended security controls and records a bounded `sandbox-topology.json` document. The inspection asserts:

```text
learner private-test mount absent
evaluator learner-workspace mount absent
forbidden GitHub/database control-plane environment keys absent
network disabled
read-only root filesystem
all Linux capabilities dropped
no-new-privileges enabled
CPU / memory / PID limits present
unprivileged UID:GID used
```

The evidence intentionally records mount destinations and environment **key names**, not host source paths or environment values.

This is structural CI evidence. The v0.3 release gate still requires the same assertions from the real staging worker using a real private evaluator bundle and published image digests.

## 7. Registry publication gate

Before v0.3 may leave draft status, the chosen registry and naming convention must be frozen and both images must be published. The release record must bind:

```text
source commit
Dockerfile/input hashes
base image digest
registry repository
registry digest
test-bundle ID
adapter interface
memory-trace schema
build run identity
```

Workers must reject a runtime configuration that is not digest-pinned.

## 8. Rebuild interpretation

Two builds from identical inputs are not assumed to have identical local image IDs unless the toolchain/build process demonstrates that property. Reproducibility for v0.3 therefore means that the full inputs and immutable distributed image identity are recorded and that the resulting behavior passes the frozen fixture/evidence suite.

A future reproducible-build milestone may additionally require byte-for-byte identical OCI manifests across independent builders.

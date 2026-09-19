# First Principles LLM Research
## Worker Host Hardening & Deployment Policy v0.3

**Status:** RELEASE-GATE CONTRACT  
**Applies to:** untrusted learner-code execution workers  
**Verifier:** `scripts/ops/verify_worker_host.py`

## 1. Security boundary

The execution worker is a separate trust tier from the web/control plane. A production deployment must preserve both of these invariants:

```text
web/control-plane process != learner-code execution process
learner mount namespace ∩ private-test mount namespace = ∅
```

The worker may hold the minimum credentials required to lease durable jobs and retrieve immutable source, but learner and evaluator containers must not inherit those credentials. Learner code must never receive access to a Docker/container-runtime socket, the PostgreSQL control plane, GitHub App credentials, or private evaluator source.

## 2. Required host properties

A production worker host must satisfy all of the following before it may accept learner jobs:

- Linux host with cgroup v2 available;
- supported container runtime with seccomp enabled;
- worker daemon runs as a non-root host identity;
- runtime socket is accessible only to the worker host process and is never mounted into execution containers;
- learner and hidden-evaluator images are referenced by registry digest, not mutable tags;
- worker temporary storage, public test bundle storage, and private evaluator storage are distinct non-overlapping roots;
- private evaluator distribution is read-only to evaluator containers and absent from learner containers;
- learner execution network policy is default-deny;
- sandbox root filesystem is read-only;
- all Linux capabilities are dropped;
- `no-new-privileges` is enforced;
- learner/evaluator processes execute under the unprivileged numeric UID/GID selected by the runtime contract;
- CPU, memory, PID, wall-clock, temporary-filesystem, and output limits are enforced;
- all disposable containers and per-execution temporary directories are removed after terminal success/failure;
- infrastructure failures are retried only according to the bounded durable-job retry policy; deterministic learner failures are retained as evidence and are not retried as infrastructure failures.

## 3. Secret and credential separation

The worker host process may receive control-plane configuration required for job leasing and immutable source retrieval. Those values must not be passed through to learner or evaluator container environments.

At minimum, execution containers must not receive:

```text
DATABASE_URL
GITHUB_TOKEN
GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
FPLLM_PRIVATE_TEST_BUNDLE_ROOT
FPLLM_PUBLIC_TEST_BUNDLE_ROOT
```

The verifier executes a live sandbox sentinel and fails if any of these names appear inside the container environment.

The private evaluator bundle root is host-only configuration. The learner container never mounts it. The evaluator container receives only the selected versioned private bundle as a read-only mount.

## 4. Runtime-socket rule

The worker daemon may require access to the container-runtime socket in the Docker-backed v0.3 deployment. That socket is a privileged host capability and therefore belongs to the worker trust boundary, not the learner boundary.

Production policy:

```text
worker daemon -> may access runtime socket
learner container -> runtime socket absent
evaluator container -> runtime socket absent
```

A future rootless/containerd or dedicated sandbox service may narrow this host privilege further without changing the learner/evaluator contract.

## 5. Image identity

Production execution requires both runtime images to be digest addressed:

```text
ghcr.io/<owner>/<learner-image>@sha256:<64 hex>
ghcr.io/<owner>/<evaluator-image>@sha256:<64 hex>
```

Mutable tags are not execution identity. The image labels must bind at least:

- source revision;
- runtime role;
- test bundle ID;
- adapter interface;
- memory-trace schema.

The runtime-image release gate records the registry digest and provenance. The worker-host preflight independently inspects the selected image before accepting the host as release evidence.

## 6. Preflight command

A production worker host is checked with:

```bash
python scripts/ops/verify_worker_host.py \
  --learner-image "$FPLLM_TEST_RUNTIME_IMAGE" \
  --evaluator-image "$FPLLM_HIDDEN_EVALUATOR_IMAGE" \
  --worker-temp-root "$FPLLM_WORKER_TEMP_ROOT" \
  --public-bundle-root "$FPLLM_PUBLIC_TEST_BUNDLE_ROOT" \
  --private-bundle-root "$FPLLM_PRIVATE_TEST_BUNDLE_ROOT" \
  --output worker-host-preflight.json
```

`--allow-local-image` and `--allow-root` are diagnostic/CI escape hatches only and do not satisfy the production release gate.

The verifier checks host identity, cgroup v2, Docker/seccomp, path separation, immutable image identity, and then launches live learner/evaluator sentinels with the same hardened container controls used by the worker.

## 7. Required evidence

A production preflight artifact must record:

- host platform and effective UID;
- cgroup-v2 availability;
- container-runtime/server version and security options;
- worker/public/private root paths and permissions;
- digest-addressed learner/evaluator image identities;
- image source revisions and runtime-role labels;
- sandbox sentinel results proving:
  - runtime socket absent;
  - forbidden control-plane environment absent;
  - external network blocked;
  - root filesystem write blocked;
  - effective capabilities zero;
  - `NoNewPrivs=1`;
  - unprivileged UID/GID.

The artifact contains identities and assertions only; it must not contain private evaluator source or credentials.

## 8. Logging and artifact policy

Worker logs may include execution IDs, job IDs, terminal states, bounded diagnostic text, stdout/stderr hashes, and non-secret test evidence. They must not include:

- GitHub App private keys or installation tokens;
- database credentials;
- GHCR credentials;
- private evaluator source;
- randomized hidden cases or seeds;
- full hidden-test request/response payloads when those payloads would reveal private evaluation inputs.

Learner stdout/stderr are bounded before persistence. Release artifacts expose cryptographic identities and invariant outcomes, not hidden evaluator internals.

## 9. Cleanup and failure semantics

Each execution receives a unique disposable workspace and IPC/output directory. Terminal cleanup removes containers and temporary execution state regardless of pass/fail outcome.

Failure classification remains explicit:

```text
learner/invariant failure -> persist evidence -> needs_revision -> no infrastructure retry
infrastructure failure   -> bounded durable retry policy -> terminal infrastructure_error if exhausted
```

Worker restart/recovery relies on PostgreSQL lease expiry rather than assuming in-memory ownership is durable.

## 10. v0.3 acceptance

Worker-host hardening is accepted for v0.3 only when all of the following are true:

1. the verifier is exercised in normal CI against the CI Docker host and locally built release-candidate images;
2. the production/staging worker host runs the verifier without `--allow-local-image` or `--allow-root`;
3. the resulting artifact reports every required sandbox sentinel as passing and both runtime images as digest pinned;
4. the real staging submission gate completes against the same runtime-image digests;
5. the host-preflight artifact and staging artifact can be tied to the same immutable v0.3 candidate commit.

CI-local host evidence is necessary but not sufficient for production-host acceptance.

## 11. Out of scope for v0.3

This contract does not claim multi-tenant kernel isolation equivalent to a dedicated VM per learner, confidential computing, GPU isolation, production autoscaling, or incident-response automation. Those remain later operational/security milestones. The v0.3 claim is narrower: the single-host worker boundary is explicit, fail-closed, machine-checked, and tied to immutable source/runtime evidence.

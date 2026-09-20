# Platform v0.5 — Maintainer Corrections Round 4 to the P0 Production Provider Record

**Status:** AUTHORITATIVE P0 CORRECTION DELTA / IMPLEMENTATION NOT YET VERIFIED  
**Date:** 2026-09-20  
**Fourth-review baseline:** `738e1e5a73fe0421fc655710327d20f45e139dc1`  
**Governing contract:** `PLATFORM_PRODUCTION_BETA_v0.5.md` §5  

---

## 0. Authority and why round 4 exists

The exact-HEAD maintainer review of the round-3 candidate found one remaining release-supply-chain gap: round 3 removed GitHub's authority to publish/promote `fpllm/worker` and the final `fpllm/hidden-evaluator`, but still allowed GitHub Actions to publish `fpllm/hidden-evaluator-base`.

That base image becomes executable trusted evaluator code after the protected sensitive builder adds the private evaluator bundle. A compromised GitHub release job could therefore publish arbitrary base-image bytes that contain no private material and no Docker `ONBUILD` trigger yet later leak, distort, or mishandle the private evaluator through the evaluator protocol at runtime. Network-disabled execution and the `ONBUILD` check do not prove that the executable base bytes correspond to the reviewed source.

This correction removes GitHub from the evaluator-base byte-production path and makes the complete trusted execution tier independently built from an exact source context that a trusted release approver verifies against the reviewed commit.

Precedence inside the P0 provider/operations record is now:

```text
PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R4_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R3_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_R2_v0.5.md
    > PRODUCTION_PROVIDER_MAINTAINER_CORRECTIONS_v0.5.md
    > conflicting text in the three parent/companion P0 records
```

Non-conflicting decisions remain in force. This round closes decision/specification gaps only.

---

# 1. GitHub-hosted release outputs — REVISED

The GitHub-hosted production release runner may directly build/publish only:

```text
fpllm/web
fpllm/test-runtime
```

It may not build, push, or promote:

```text
fpllm/worker
fpllm/hidden-evaluator-base
fpllm/hidden-evaluator
```

The GitHub runner may still create deterministic **non-secret source-context archives** from the exact frozen platform source SHA and upload those archives to the versioned content-addressed release-context S3 namespace. Those bytes are never trusted merely because GitHub uploaded them; the trusted release approver independently verifies the exact context hash/object version against a clean checkout of the reviewed commit before any protected builder can consume them.

`fpllm/test-runtime` remains an untrusted sandbox image and is constrained by the frozen gVisor/network/filesystem/capability/resource controls.

## 1.1 Explicit accepted trust boundary for `fpllm/web`

The web image is different from the trusted execution tier. GitHub Actions remains an accepted production release authority for the **web/control plane** in v0.5. That means a compromised production release workflow could indirectly influence code that later runs with the frozen web workload's application/database/secret authority even though the GitHub runner does not directly receive those secret values.

This is an explicit accepted beta trust decision, not a claim that GitHub Actions is cryptographically isolated from all production application authority.

The accepted boundary is narrow:

- GitHub Actions may release the web/control plane and the untrusted test runtime;
- it receives no private evaluator object/KMS authority;
- it cannot publish or promote worker/evaluator executable bytes;
- it cannot mutate the protected execution-tier stack, worker infrastructure, protected ECR policies, approved-candidate state, or protected builder roles;
- web workload roles receive no hidden-evaluator repository content authority and no worker-host administration authority.

If the project later requires GitHub Actions to be outside the web runtime trust boundary as well, that is a P0 amendment requiring an independently protected web build/promotion path.

---

# 2. One independently verified execution source context

Freeze one deterministic public execution-source archive per platform source SHA:

```text
release-context/execution/<platform-source-sha>/<context-sha256>.tar.gz
```

The context contains only reviewed public repository material required to build:

```text
fpllm/worker
fpllm/hidden-evaluator-base
```

It contains no private evaluator archive, production secret, database credential, GitHub App private key, webhook secret, or hidden-evaluator final image.

The trusted release approver independently regenerates or independently verifies this deterministic archive from a clean checkout of the exact reviewed source SHA and records:

```text
platform source SHA
S3 bucket/key/version
archive byte size
SHA-256
verification procedure/version
approver audit identity + timestamp
```

A GitHub-provided checksum, object tag, OCI label, or workflow artifact is insufficient by itself.

The approved execution candidate in the protected DynamoDB release-control table now contains one immutable execution-source-context identity shared by the protected worker and evaluator-base builders.

---

# 3. Protected evaluator-base builder — SELECTED

Add a third protected CodeBuild project:

```text
project:             fpllm-beta-hidden-evaluator-base
region:              eu-west-1
source type:         NO_SOURCE
buildspec:           fixed in protected infrastructure configuration
cache:               NO_CACHE unless P1 proves reusable cache contains no executable/source state across approvals
artifacts:           NO_ARTIFACTS except non-secret release provenance
service role:        fixed evaluator-base-builder role
timeout:             <= 30 minutes
concurrent builds:   1
output:              fpllm/hidden-evaluator-base@sha256:<digest>
private evaluator:   no access
```

The fixed buildspec:

1. downloads the exact approved execution-source-context object version;
2. verifies its SHA-256 and platform source identity;
3. builds the evaluator-base image from the reviewed source/lockfile/frozen dependency process;
4. proves the image contains no private evaluator bundle/material;
5. proves the resulting image has no Docker `ONBUILD` triggers;
6. records OCI/source/testBundle/runtime provenance;
7. pushes only to `fpllm/hidden-evaluator-base`;
8. records the resulting immutable digest into the approved candidate.

The evaluator-base-builder role may read only the approved non-secret execution context, write its dedicated logs, authenticate to ECR, and push only `fpllm/hidden-evaluator-base`. It receives:

```text
no private evaluator S3 access
no release-material KMS decrypt
no final hidden-evaluator ECR push/read authority except where a digest-existence check is strictly required and separately justified
no worker ECR push authority
no production DB credentials
no GitHub App/OAuth/webhook secrets
no worker-host administration authority
```

Because it handles no private evaluator material, this builder may use the ordinary outbound dependency/package-registry access required to reproduce the reviewed lockfile build. P1 records the realized egress and dependency-integrity controls.

GitHub Actions has no push/layer-upload authority on `fpllm/hidden-evaluator-base`.

---

# 4. Protected broker orchestration — THREE COMPONENTS

Round 3's protected execution-release broker remains selected, but it now orchestrates three protected build components for one approved candidate:

```text
1. fpllm-beta-worker
2. fpllm-beta-hidden-evaluator-base
3. fpllm-beta-hidden-evaluator
```

The final hidden-evaluator build is not eligible to start until the evaluator-base component has succeeded and its immutable digest has been conditionally recorded in the trusted candidate.

Per component:

```text
one active CodeBuild execution per approvalId
maximum starts per approvalId/component: 3
successful component: never rebuilt under same approvalId
third failed start: component -> failed_locked
```

Candidate state records independently:

```text
worker build state/start count/active build ID/digest
evaluator-base build state/start count/active build ID/digest
hidden-evaluator build state/start count/active build ID/digest
```

Overall state becomes `built` only when all three protected outputs have succeeded under the same `approvalId` and `platform source SHA`.

The GitHub caller still supplies only the bounded `requestId`; it cannot select a component, source context, base digest, private object, buildspec, environment, role, cache, logs, artifacts, image, or output repository.

---

# 5. Sensitive hidden-evaluator assembly consumes only protected base output

The round-3 private/no-Internet hidden-evaluator CodeBuild remains in force, with one stronger admission rule:

```text
accepted base image = the evaluator-base digest recorded by
                      fpllm-beta-hidden-evaluator-base
                      under the same approvalId/platform source SHA
```

The sensitive builder may not consume a base digest that came from:

```text
GitHub Actions
an arbitrary ECR tag
a caller-supplied environment value
a different approvalId
a different platform source SHA
an operator-selected digest outside the candidate record
```

Before private material is introduced, the sensitive builder verifies the protected base digest/provenance and confirms `ONBUILD` is empty. It then applies only the already-frozen fixed protected packaging recipe, performs no arbitrary `RUN` command after private material is introduced, and operates with no Internet/NAT path.

This creates the required chain:

```text
reviewed platform source SHA
-> independently verified execution source context
-> protected evaluator-base build
-> immutable protected base digest
-> protected private-bundle assembly
-> final hidden-evaluator digest
```

No GitHub-built executable image sits inside that chain.

---

# 6. ECR policy correction for `fpllm/hidden-evaluator-base`

Move `fpllm/hidden-evaluator-base` into the protected execution release boundary for repository-write policy purposes.

Frozen policy intent:

```text
push/layer-upload:
  evaluator-base-builder role only

pull:
  sensitive hidden-evaluator builder
  explicitly required trusted verification path only

GitHub OIDC/deploy roles:
  no push/layer-upload

worker builder:
  no push

web/test-runtime roles:
  no read/write authority unless a separately justified non-content metadata query is required
```

Repository/lifecycle-policy mutation remains unavailable to the ordinary GitHub deployment role where it could widen these protections.

P1 must prove with effective-policy negative tests that GitHub cannot push the base repository even if an identity policy elsewhere attempts to grant it.

---

# 7. Protected stack additions

The protected execution/sensitive-release stack now includes:

```text
fpllm-beta-hidden-evaluator-base CodeBuild project + fixed buildspec
its service role
evaluator-base protected ECR repository policy
broker permissions for the third project
candidate schema/state for evaluator-base build identity
```

The existing protected worker builder, final hidden-evaluator builder, worker infrastructure, release broker, DynamoDB table, private release-material S3/KMS policies, final protected ECR policies, and private-build networking remain in force.

The ordinary GitHub OIDC/CDK path may synthesize/inspect committed source but cannot apply mutations to these protected resources or assume their protected CloudFormation execution role.

---

# 8. Required P1 evidence additions

In addition to every non-conflicting earlier P1 requirement, retain evidence that:

1. the exact execution-source-context hash/version independently reproduces from the reviewed source SHA;
2. GitHub Actions cannot push/layer-upload `fpllm/hidden-evaluator-base`;
3. only the evaluator-base protected builder can push that repository;
4. the evaluator-base builder has no private evaluator object/KMS/final-image/worker-host authority;
5. the evaluator-base digest recorded in the candidate came from the approved execution context under the same `approvalId`/source SHA;
6. the final sensitive evaluator build refuses any base digest not recorded by that protected component;
7. successful evaluator-base output cannot be rebuilt under the same approval and is subject to the same three-start abuse bound;
8. the base has no private evaluator material and no `ONBUILD` trigger;
9. web release authority is tested separately from execution-tier authority: the GitHub deploy role can perform only its accepted web/test-runtime release operations and cannot mutate execution-tier protected resources;
10. the production security/evidence record explicitly identifies GitHub Actions as an accepted web/control-plane release TCB, not as an authority isolated from every production secret-bearing runtime.

---

# 9. Cost/failure/exit consequence

This correction adds one protected CodeBuild project and moves evaluator-base repository-write authority into the protected execution release boundary. Its low-volume beta cost must be included in the mandatory fresh AWS estimate. The existing USD 900/month stop/review threshold remains authoritative.

Failure of the evaluator-base builder blocks a new execution-tier release but does not rewrite already-running learner evidence. Three failed starts lock that component/candidate until trusted reapproval. Source-context mismatch, provenance mismatch, unexpected private material, or unexpected `ONBUILD` state fails closed before the final private evaluator build can start.

Replacing the independently protected evaluator-base build path later is a P0 amendment because it changes who controls executable code that receives private evaluator material at runtime.

---

# 10. Review-state boundary

This round closes the residual evaluator-base supply-chain gap found in the exact-HEAD review of `738e1e5...` and makes the accepted GitHub web/control-plane trust boundary explicit.

It does not claim P1 implementation or production evidence.

The merge gate restarts again:

```text
CI/affected gates on the new exact HEAD
-> fresh exhaustive maintainer review of the complete P0 record
-> fix/repeat if any material flaw remains
-> fresh Codex independent review on that exact HEAD
-> disposition all actionable review threads
-> rerun affected gates if the candidate changes
-> final exact-HEAD CI/review/thread check
-> squash merge
```

No earlier maintainer-clean statement or Codex review on an older commit satisfies this restarted gate.

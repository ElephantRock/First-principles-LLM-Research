# First Principles LLM Research
## Staging Submission E2E v0.3

**Status:** RELEASE-GATE HARNESS  
**Workflow:** `.github/workflows/staging-submission-e2e.yml`  
**Target gate:** real GitHub App identity -> durable job -> worker -> isolated Docker execution -> persisted evidence

## 1. Purpose

The normal CI suite proves structural correctness with public fixtures, local runtime-image builds, database integration tests, and container-topology inspection. It does not prove that the platform's own GitHub App can resolve and materialize an immutable learner commit and carry that exact identity through the production worker control path.

The staging workflow closes that gap without weakening the private-test boundary.

It is deliberately `workflow_dispatch` only and requires the operator to enter `STAGING` explicitly.

## 2. Required staging configuration

Repository or environment secrets:

```text
FPLLM_STAGING_GITHUB_APP_ID
FPLLM_STAGING_GITHUB_APP_PRIVATE_KEY
FPLLM_STAGING_GITHUB_INSTALLATION_ID
FPLLM_PRIVATE_BUNDLE_TAR_B64
```

The GitHub App installation must have read access to the repository selected by the workflow inputs.

The private bundle secret is a base64-encoded gzip tar archive containing the contents of the versioned hidden bundle. The archive is extracted under:

```text
<private-root>/phase1-causal-attention@1.0/
```

and must contain at least:

```text
runner.py
manifest.json
```

The public repository contains only a cryptographic commitment at:

```text
hidden-tests/phase1/causal-attention/private-bundle-commitment.json
```

For private evaluator version `1.0.0`, that commitment binds the staging secret to the exact archive SHA-256, byte size, test-bundle identity, adapter interface, memory-trace schema, and hidden invariant list. The staging materializer refuses to extract or execute an archive whose bytes do not match that commitment. It also requires `manifest.json` inside the committed archive to match the public runtime contract.

This preserves two properties simultaneously:

```text
public repo can verify private evaluator identity
public repo does not disclose private evaluator source, randomized cases, or seeds
```

The materializer additionally rejects absolute paths, `..`, symlinks, hardlinks, devices, FIFOs, oversized archives, and oversized expanded contents. The archive contents are never committed to this public repository or uploaded as a staging artifact.

For larger private evaluators, replace the secret archive transport with a private artifact-store or private-repository retrieval step while preserving the same public digest commitment and worker mount boundary. The base64 secret mechanism is a staging bootstrap, not the intended long-term distribution mechanism.

## 3. Runtime-image inputs

The workflow requires two already-published immutable image references:

```text
<learner-runtime-repository>@sha256:<64 hex>
<hidden-evaluator-repository>@sha256:<64 hex>
```

Mutable tags are rejected.

The images are pulled before execution. Their publication provenance should come from the separate `Runtime image release candidate` workflow.

## 4. Execution sequence

For the selected repository and GitHub App installation the staging runner:

1. verifies that the private evaluator secret matches the committed public archive identity and manifest contract;
2. resolves the known-good SHA through the platform `GitHubAppClient`;
3. resolves the known-bad SHA through the same installation;
4. verifies both resolutions return exactly the submitted 40-character immutable SHA and the same provider repository identity;
5. binds that provider identity to the staging demo learner in PostgreSQL;
6. queues the good commit through `createVerifiedSubmissionAndQueueForDemo`;
7. starts the actual worker entrypoint once;
8. requires the worker to lease the durable PostgreSQL job, fetch the exact Git tree/blobs through the GitHub App, run public tests, run the split hidden evaluator topology, and finalize persisted evidence;
9. verifies the good submission is `passed`, all six required invariants pass, and a verified experiment can be created;
10. repeats the exact same good source/test/runtime identity as a second submission and requires a distinct submission, test run, and execution ID;
11. queues the known-bad immutable commit, runs the worker again, requires a hidden invariant failure, requires submission state `needs_revision`, and verifies experiment creation remains blocked.

No worker runtime or GitHub source client is replaced by a test double in this workflow.

## 5. Evidence artifact

A successful run uploads:

```text
staging-submission-e2e-<workflow-run-id>/
  staging-submission-e2e.json
```

The JSON records:

- repository/provider identity;
- GitHub installation ID;
- exact good/bad commit SHAs;
- digest-addressed learner and evaluator images;
- test-bundle/interface/schema identities;
- submission/test-run/job IDs and terminal states;
- persisted execution IDs;
- invariant pass/fail results;
- durable job event names;
- experiment unlocked/blocked result;
- explicit release-gate assertions.

The private bundle's public SHA-256/size/version commitment remains independently available in the repository. The staging evidence does **not** contain the GitHub App private key, installation access token, private evaluator source, randomized hidden cases or seeds, database credentials, or GHCR credentials.

## 6. Acceptance criteria

The staging gate is satisfied only when the evidence artifact asserts all of the following and the workflow itself is green:

```text
githubAppResolvedExactGoodSha = true
githubAppResolvedExactBadSha = true
goodCommitPassedAndUnlockedExperiment = true
badCommitProducedHiddenFailureAndBlockedExperiment = true
identicalGoodIdentityReexecutedAsDistinctEvidence = true
```

In addition, the staging workflow must have accepted the private bundle against the repository commitment before the worker starts. A CI-local fixture run is not a substitute for this staging artifact.

## 7. Remaining boundary after this gate

A successful staging run proves the real platform submission/execution path for the selected GitHub App installation, the committed private evaluator identity, and immutable runtime images. It does not, by itself, prove production worker-host hardening, registry retention policy, incident recovery, multi-tenant isolation, or long-term private evaluator distribution. Those remain operational release concerns.

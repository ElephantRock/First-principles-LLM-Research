# v0.3 Release-Gate Bootstrap

**Status:** OPERATIONAL BOOTSTRAP  
**Purpose:** make the v0.3 manual release gates dispatchable before the v0.3 implementation PR itself is merged.

GitHub only accepts `workflow_dispatch` events for workflows whose workflow file exists on the repository default branch. The v0.3 implementation intentionally remains a draft until published-image and real-staging evidence exist, so placing the first dispatchable workflow definitions only inside that draft branch creates a circular dependency.

This bootstrap adds two narrow workflow definitions to `main`:

- `.github/workflows/v03-runtime-image-release-gate.yml`
- `.github/workflows/v03-staging-submission-gate.yml`

Both workflows accept a `candidate_ref` input and then explicitly check out that candidate before executing any v0.3 scripts. The workflow definition is therefore stable on `main`, while the code under evaluation remains the selected immutable candidate revision.

## Runtime-image gate

The runtime gate validates the candidate's actual runtime Dockerfiles and CI validation script. Publication remains disabled by default. Pushing to GHCR requires both:

```text
publish=true
confirm_publish=PUBLISH
```

When publication is enabled, the gate records the exact candidate commit and registry-returned SHA-256 digests.

## Staging submission gate

The staging gate requires:

```text
confirm_staging=STAGING
```

and the configured staging GitHub App/private evaluator secrets. It checks out the selected candidate, pulls digest-addressed runtime images, verifies the private evaluator secret against the candidate's public cryptographic commitment, and invokes the candidate's real staging runner.

The uploaded evidence is amended with the selected `candidate_ref` and the resolved immutable candidate commit SHA.

## Lifecycle

These workflows are control-plane launchers, not an alternate implementation of v0.3. The candidate branch owns the executable runtime, staging runner, test contracts, and provenance logic. Once v0.3 is merged and its final workflow organization is settled, these bootstrap launchers may be retained as stable release gates or replaced in a dedicated cleanup change.

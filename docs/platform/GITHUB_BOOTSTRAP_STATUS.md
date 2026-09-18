# GitHub Bootstrap Status

**Date:** 2026-09-18

The canonical public repository has been materialized from the authoritative platform v0.2 source archive on branch `bootstrap/platform-v0.2`.

## Verified bootstrap facts

- Pull request #1 now exposes the complete source tree rather than bootstrap archive fragments.
- The pull request contains 111 changed files relative to `main`.
- The temporary `bootstrap/` archive staging directory and `bootstrap-source.yml` workflow are absent from the materialized source commit.
- The persistent CI workflow remains at `.github/workflows/ci.yml`.
- The learner-code security invariant remains unchanged: learner-supplied code must never execute in the web process.

## Verification gate

The next gate is the first dependency-installed Node.js 24 + PostgreSQL CI run over the materialized source. The pull request must not be merged until this CI has run and any application/runtime failures are resolved or explicitly documented.

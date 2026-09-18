# Persistence-Backed Evidence Flow v0.2

**Status:** implementation scaffold; runtime certification pending.

Prototype v0.2 replaces the principal mock evidence paths with PostgreSQL/Prisma-backed domain boundaries and adds the GitHub App integration boundary.

## Implemented model

The persistence schema covers:

- users and enrollment;
- immutable course/unit versions;
- compute/environment evidence;
- GitHub installations and repository bindings;
- immutable submissions;
- public/hidden test runs and results;
- locked experiments and predictions;
- experiment runs, measurements, and artifacts;
- versioned journal entries;
- mastery requirements, evidence, and state;
- durable jobs/events;
- audit and idempotency records.

The intended state flow is:

```text
immutable submission
→ passed test evidence
→ draft experiment
→ locked prediction
→ validated artifact
→ experiment evidence
→ versioned interpretation
→ mastery projection
```

## Evidence integrity

Experiment artifacts are checked against the persisted experiment identity, experiment type, schema version, and full Git commit SHA before they can become evidence. Partial and failed sequence-length runs are representable rather than silently omitted.

## Course content

The Causal Attention unit is loaded from the Git-versioned YAML/MDX source under `course/`. `course/content-manifest.json` records SHA-256 identities for the published source files.

## GitHub boundary

The scaffold contains GitHub App primitives for installation-token acquisition, repository/commit resolution, webhook verification, installation persistence, and repository binding. Repository integration remains separate from platform authentication.

## Security boundary

Learner code must never execute in the web application process. Hidden tests belong in a disposable isolated worker with no platform secrets, network disabled by default, strict resource/time limits, and teardown after each run.

## Verification status

The source has been parser-checked in the artifact-generation environment, but full dependency installation, Prisma migration execution, Next.js build, and persistence-backed HTTP integration still require a Node.js 24 + PostgreSQL environment.

GitHub Actions CI is the first external runtime-verification path for this import.

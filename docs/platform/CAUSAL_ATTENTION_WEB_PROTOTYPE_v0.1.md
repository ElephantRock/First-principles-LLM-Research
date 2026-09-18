# Causal Attention Web Prototype Scaffold v0.1

**Date:** 2026-09-18  
**Status:** Scaffold complete; dependency-installed runtime verification outstanding  
**Authoritative dependencies:** Project Decision Register v1.1, Interaction & Wireframe Specification v1.0, Web Platform Technical Architecture v1.0

## Implemented

### Application shell

- 56 px desktop top bar
- 224 px primary navigation
- 304 px contextual evidence panel
- responsive compact navigation below 1280 px
- mobile bottom navigation below 768 px
- persistent compute profile context
- semantic pass/warning/failure/research states

### Product routes

- Dashboard
- Phase 1 dependency map
- Causal Attention Learning Unit
- Causal Attention Lab
- immutable submission detail
- passing hidden/public test result
- failure/assistance-ladder test result
- experiment draft/lock interaction
- experiment result with accessible SVG chart + data table
- Research Journal timeline
- experiment-linked journal entry
- Phase 1 mastery matrix
- compute onboarding
- repository onboarding

### Course content contracts

`course/phase1/causal-attention/` contains:

- `unit.yaml`
- `lesson.mdx`
- `lab.yaml`
- `experiment.yaml`
- `mastery.yaml`
- `readings.yaml`

The content uses real Causal Attention/GQA course semantics rather than placeholder copy.

### Shared architecture packages

- `@fpllm/domain`
- `@fpllm/api-contracts`
- `@fpllm/content`
- `@fpllm/ui`
- `@fpllm/db`
- `@fpllm/observability`
- `@fpllm/test-sandbox`

### Persistence scaffold

The Prisma schema models:

- users
- enrollments
- hardware profiles
- repositories
- submissions
- test runs
- experiments
- experiment measurements
- journal entries
- mastery evidence

No database is required for the mock vertical slice yet.

### Worker/sandbox boundary

The worker application exists only as a boundary scaffold. It deliberately does not execute learner code. The sandbox protocol specifies immutable commit identity, resource limits, network-off semantics, and invariant-oriented public reporting.

### Test scaffold

The web package includes Playwright examples for:

- navigating the evidence loop;
- automated accessibility scanning of the Learning Unit.

## Validation performed in the artifact-generation environment

- `packages/domain` successfully type-checks with the locally available TypeScript compiler.
- every `package.json` parses as JSON.
- every course/config YAML file parses successfully.
- TypeScript syntax scan of the web source reported no parser-level diagnostics.

## Validation not performed here

This environment has:

- Node.js 22.16 rather than the frozen Node.js 24 target;
- no pnpm installation;
- no usable npm-registry network access.

Therefore the following remain required on a networked Node 24 machine:

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @fpllm/web test:e2e
```

The absence of a generated `pnpm-lock.yaml` is intentional until the first successful Node 24 dependency installation. The architecture requires that resulting lockfile to be committed before production work continues.

## Deliberately mocked in v0.1

- authentication;
- GitHub App installation/API;
- database reads/writes;
- object storage;
- durable jobs/SSE;
- hidden-test execution;
- CLI synchronization;
- server-computed mastery persistence.

The web prototype uses stable mock data shaped like the intended domain contracts so learner UX can be evaluated before those integrations are built.

## Next implementation milestone

**Prototype v0.2 — persistence-backed evidence flow**

Recommended order:

1. establish Node 24 + pnpm lockfile and green build;
2. wire course-content loader from MDX/YAML instead of hand-bound view data;
3. stand up PostgreSQL and Prisma migrations;
4. replace mock submission/experiment/journal/mastery state with repositories/services;
5. add artifact import validation using the shared Zod contracts;
6. only then implement GitHub App integration;
7. isolated test execution remains after Git integration, never inside the web process.

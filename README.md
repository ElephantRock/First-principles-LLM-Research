# First Principles LLM Research

Canonical development repository for **First Principles LLM Research**: a mastery-based course and research platform in which learners build, measure, optimize, post-train, and scientifically study language models.

The current repository focus is **Causal Attention Web Prototype v0.2 — Persistence-Backed Evidence Flow**.

## Learning-product loop

```text
Learn
→ implement locally
→ submit immutable Git commit
→ receive test evidence
→ run controlled experiment
→ interpret result
→ earn mastery
→ preserve research evidence
```

## Current platform implementation

The monorepo contains:

```text
apps/
  web/        Next.js learner experience and /api/v1 surface
  worker/     isolated-worker boundary

packages/
  api-contracts/
  content/
  db/
  domain/
  github/
  observability/
  test-sandbox/
  ui/

course/
  phase1/causal-attention/

docs/platform/
hidden-tests/
infra/
```

### Implemented vertical-slice surfaces

- learner dashboard;
- Phase 1 dependency map;
- Causal Attention Learning Unit;
- lab specification;
- immutable Git-submission flow;
- public/hidden test-result states;
- progressive diagnostic assistance;
- hypothesis/prediction locking;
- attention memory-scaling results;
- interpretation and conclusion flow;
- research journal;
- mastery evidence;
- compute and repository onboarding.

### Persistence-backed v0.2 work

The current schema and service boundaries add durable models for submissions, test evidence, experiments, measurements, artifacts, journal entries, mastery, compute evidence, jobs/events, and GitHub App repository binding.

See:

- `docs/platform/PERSISTENCE_BACKED_EVIDENCE_FLOW_v0.2.md`
- `docs/platform/WEB_PLATFORM_TECHNICAL_ARCHITECTURE_v1.0.md`
- `docs/platform/INTERACTION_WIREFRAME_SPEC_v1.0.md`
- `PROJECT_DECISIONS.md`

## Runtime baseline

- Node.js 24
- TypeScript 5.9+
- Next.js 16.x App Router
- React 19.3-compatible
- pnpm workspaces + Turborepo
- PostgreSQL 18
- Prisma 7

## Local development

```bash
corepack enable
pnpm install

docker compose -f infra/docker/compose.dev.yaml up -d

pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm content:validate
pnpm typecheck
pnpm test
pnpm build
```

Then:

```bash
pnpm --filter @fpllm/web dev
```

Open `http://localhost:3000/home`.

## Verification status

The artifact-generation environment did not provide the frozen Node.js 24 runtime, pnpm registry access, or a usable PostgreSQL service. Consequently, the current v0.2 source is implementation-complete enough for external runtime verification but is **not yet build-certified**.

GitHub Actions CI is included to perform the first real Node 24 + PostgreSQL verification.

## Security invariant

Learner-supplied code must never execute inside the web process. Hidden-test execution is reserved for a disposable isolated worker/sandbox boundary.

## Authoritative project documents

`PROJECT_DECISIONS.md` is the project-wide decision source of truth. Platform specifications live under `docs/platform/`.

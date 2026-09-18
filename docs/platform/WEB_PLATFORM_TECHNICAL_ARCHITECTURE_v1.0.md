# First Principles LLM Research
## Web Platform Technical Architecture & Component System v1.0

**Document version:** 1.0  
**Date:** 2026-09-18  
**Status:** Architecture baseline for the Causal Attention vertical slice  
**Authoritative dependencies:** Consolidated Decision Register v1.0+; Interaction & Wireframe Specification v1.0

---

# 0. Purpose

This document turns the product and interaction specifications into an implementation architecture for the learning platform.

It freezes the architecture required to build one complete evidence-producing vertical slice without prematurely building a general-purpose LMS, browser IDE, managed GPU cloud, or social platform.

The target loop is:

\[
\boxed{
\text{learn}
\rightarrow
\text{implement locally}
\rightarrow
\text{submit immutable commit}
\rightarrow
\text{receive test evidence}
\rightarrow
\text{run experiment}
\rightarrow
\text{interpret}
\rightarrow
\text{master}
}
\]

The platform remains **local-first, web-coordinated**.

---

# 1. Architecture decisions at a glance

The following choices are **FROZEN for the first implementation** unless later evidence justifies revision.

| Layer | Decision |
|---|---|
| Runtime | Node.js 24 LTS |
| Language | TypeScript 5.9+ with `strict` enabled |
| Web framework | Next.js 16.x, App Router |
| UI runtime | React 19.3-compatible |
| Package manager | pnpm workspaces |
| Monorepo orchestration | Turborepo |
| Styling | Tailwind CSS 4.x with project-owned CSS design tokens |
| Accessible primitives | Radix Primitives |
| Component scaffolding | shadcn CLI/components may be copied into the source tree, but do not define the visual system |
| Course content | Git-versioned MDX 3 + YAML/JSON schemas |
| Math | KaTeX/MathML-capable rendering through the MDX pipeline |
| Code highlighting | server-side Shiki |
| Validation | Zod schemas at all trust boundaries |
| Database | PostgreSQL 18.x |
| ORM/data mapper | Prisma ORM 7, explicitly pinned to major 7 for the first production implementation |
| Object/artifact storage | S3-compatible object storage, provider-neutral |
| Queue | PostgreSQL-backed durable jobs; no Redis requirement for MVP |
| Search | PostgreSQL full-text search + trigram indexes for MVP |
| Repository integration | GitHub App, not broad OAuth repository access |
| Test execution | separate worker service; untrusted code never executes in the web process |
| Sandbox | ephemeral isolated runtime with network off by default and no platform secrets |
| Test progress | persisted job events + Server-Sent Events; polling fallback |
| Observability | structured JSON logs + OpenTelemetry-compatible traces/metrics |
| Frontend tests | Vitest + Testing Library |
| End-to-end tests | Playwright |
| Accessibility regression | axe-core/Playwright checks plus manual keyboard/screen-reader review |
| Deployment | web and worker deploy independently; exact hosting providers remain open |

Version policy: lock exact package versions in the lockfile; use supported stable/LTS release lines rather than floating `latest` in production.

---

# 2. Why this architecture

The architecture is optimized around the course's unusual constraints rather than generic SaaS conventions.

## 2.1 The web application is not the execution environment

Learners must continue to use:

- Git;
- terminal workflows;
- Python environments;
- CUDA;
- profilers;
- local files;
- experiment management.

The website coordinates these activities and stores evidence. It does not hide them behind a browser IDE.

## 2.2 Learner code is untrusted

A submission is arbitrary code controlled by a learner. It must be treated as hostile input from an infrastructure perspective.

Therefore:

\[
\boxed{
\text{web process}
\neq
\text{test execution process}
}
\]

No submitted repository code is imported or executed by the Next.js application.

## 2.3 Evidence is more important than engagement telemetry

The primary durable objects are:

- immutable Git commits;
- test runs;
- experiment definitions;
- locked predictions;
- metrics;
- artifacts;
- interpretations;
- mastery evidence.

This drives both the database model and the API design.

## 2.4 Content needs code-like versioning

Course content contains equations, source interfaces, tests, experiment definitions, and executable contracts. It therefore belongs in version control rather than only in an opaque CMS.

---

# 3. Current-version rationale

The implementation baseline deliberately chooses supported stable/LTS lines rather than the newest prerelease software.

As of 2026-09-18:

- Node.js 24 is an LTS release line, while Node.js 26 is Current.
- React 19.3 is the current stable React release.
- Next.js 16.3 is available in the Next.js 16 line.
- Tailwind CSS 4.3 is the current Tailwind 4 release.
- PostgreSQL 18.6 is a supported stable release, while PostgreSQL 19 is still beta.
- Prisma ORM 8 is still a release candidate; Prisma ORM 7 remains fully supported. The platform therefore pins Prisma 7 rather than adopting an RC ORM in the first production build.

The project must re-check patch/security releases at implementation and deployment time.

---

# 4. Monorepo structure

The web-platform source should live beside the course/reference implementation but remain cleanly separated from it.

Recommended structure:

```text
first-principles-llm-research/
├── apps/
│   ├── web/                    # Next.js application
│   └── worker/                 # job coordinator / test-run worker service
├── packages/
│   ├── ui/                     # project-owned design-system components
│   ├── content/                # content schemas, loader, MDX component map
│   ├── db/                     # Prisma schema/client/repositories
│   ├── domain/                 # domain types + state machines + policy engine
│   ├── api-contracts/          # Zod request/response schemas shared with CLI
│   ├── observability/          # logger, tracing, correlation IDs
│   └── test-sandbox/           # runner protocol, not learner hidden tests
├── course/
│   ├── course.yaml
│   └── phase1/
│       └── causal-attention/
│           ├── unit.yaml
│           ├── lesson.mdx
│           ├── lab.yaml
│           ├── experiment.yaml
│           ├── mastery.yaml
│           ├── readings.yaml
│           └── diagrams/
├── hidden-tests/               # private deployment source; never learner-visible
│   └── phase1/
│       └── causal-attention/
├── infra/
│   ├── docker/
│   ├── migrations/
│   └── deployment/
├── tests/
│   ├── e2e/
│   └── accessibility/
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

The existing Python `fpllm` reference implementation remains the learner/course implementation and is not rewritten in TypeScript.

---

# 5. Application topology

```text
                         ┌──────────────────────────┐
                         │        Browser           │
                         │ React / Next.js client   │
                         └────────────┬─────────────┘
                                      │ HTTPS
                                      ▼
                         ┌──────────────────────────┐
                         │        Web App           │
                         │ Next.js / Node 24 LTS    │
                         │                          │
                         │ server rendering         │
                         │ browser API/BFF          │
                         │ content delivery         │
                         │ authorization            │
                         │ mastery projection       │
                         └──────┬───────┬───────────┘
                                │       │
                   SQL/notify   │       │ signed URLs
                                ▼       ▼
                      ┌─────────────┐  ┌──────────────┐
                      │ PostgreSQL  │  │ S3-compatible│
                      │ state/jobs  │  │ artifacts    │
                      └──────┬──────┘  └──────────────┘
                             │
                             │ leased durable jobs
                             ▼
                      ┌─────────────────┐
                      │ Worker Service  │
                      │ no web session  │
                      │ secrets minimal │
                      └──────┬──────────┘
                             │
                             │ ephemeral sandbox
                             ▼
               ┌──────────────────────────────┐
               │ Untrusted Test Environment   │
               │ immutable Git SHA            │
               │ hidden tests read-only       │
               │ network disabled by default  │
               │ CPU/RAM/time limits          │
               └──────────────────────────────┘

GitHub App ──webhooks/API──► Web App / Worker

Local fpllm CLI ──HTTPS API / signed upload──► Web App + Object Storage
```

---

# 6. Web application architecture

## 6.1 Next.js App Router

Use the App Router.

Primary reasons:

- nested layouts match the global shell + course/lab/research surfaces;
- server rendering is appropriate for long-form technical content;
- route-level loading/error boundaries map cleanly to the interaction specification;
- server/client component boundaries reduce unnecessary client JavaScript;
- route handlers can expose the stable browser/CLI API where needed.

## 6.2 Server-first rendering

Default rule:

\[
\boxed{
\text{server component unless interaction requires client state}
}
\]

Server-render:

- course map data;
- Learning Unit content;
- lab contracts;
- submission history;
- test summaries;
- experiment result tables;
- mastery projections;
- journal timeline.

Client components are reserved for:

- command palette;
- drawers/popovers;
- hypothesis/prediction forms;
- lock confirmations;
- artifact uploads;
- live test progress;
- charts with interaction;
- autosave editors;
- responsive navigation.

## 6.3 No browser-global state store initially

Do not introduce Redux or another global client store for MVP.

State categories:

- URL → navigation/selected section;
- server database → durable state;
- React local state → transient UI;
- form state → component/form library;
- server push → test/job progress.

A global state library is added only if a concrete cross-tree state problem emerges.

---

# 7. Content architecture

## 7.1 Source of truth

Course instructional content lives in Git as MDX/YAML.

A published course version is immutable.

Changing published content creates a new version rather than silently mutating what a historical submission refers to.

## 7.2 Content files

For Causal Attention:

```text
course/phase1/causal-attention/
├── unit.yaml
├── lesson.mdx
├── lab.yaml
├── experiment.yaml
├── mastery.yaml
├── readings.yaml
└── diagrams/
```

## 7.3 Build-time validation

Every structured content file is validated with Zod during CI/content build.

A release fails if:

- IDs collide;
- prerequisite references are missing;
- mastery requirements reference nonexistent evidence types;
- routes/slugs collide;
- an experiment references an unknown lab/version;
- hidden-test invariant IDs do not match documented invariant IDs.

## 7.4 Trusted vs untrusted Markdown

**Trusted course MDX** may embed approved components.

**Learner-authored text must never be executed as MDX/JSX.**

Journal entries, hypotheses, interpretations, and notes are rendered with a sanitized Markdown subset or plain structured rich text.

This is a security boundary.

## 7.5 MDX component allowlist

The course content layer may expose only approved components, for example:

```text
<Equation>
<TensorShapes>
<CodeExample>
<ConceptCheck>
<WorkedExample>
<FailureMode>
<ReadingReference>
<LabLink>
<ExperimentLink>
<Invariant>
```

Arbitrary imports from lesson MDX are prohibited in published course content unless approved by the content build.

## 7.6 Math and code

- Math is rendered during content processing using KaTeX-compatible output with accessible MathML where available.
- Code is syntax highlighted server-side with Shiki.
- Code blocks must retain selectable/copyable plain text.
- Learner-facing assignment solution code is never accidentally injected through a content component.

---

# 8. Design system and component architecture

## 8.1 Ownership rule

The project owns its components.

Radix supplies low-level behavior/accessibility primitives. shadcn may accelerate initial source generation, but generated files become normal project source.

The product must not look like an unmodified component-library demo.

## 8.2 Package structure

```text
packages/ui/src/
├── primitives/
│   ├── button.tsx
│   ├── dialog.tsx
│   ├── popover.tsx
│   ├── tabs.tsx
│   ├── tooltip.tsx
│   ├── select.tsx
│   └── ...
├── layout/
│   ├── app-shell.tsx
│   ├── primary-nav.tsx
│   ├── context-panel.tsx
│   └── section-rail.tsx
├── scientific/
│   ├── equation-block.tsx
│   ├── tensor-shape-table.tsx
│   ├── metric-table.tsx
│   ├── experiment-chart.tsx
│   └── provenance-panel.tsx
├── learning/
│   ├── concept-check.tsx
│   ├── mastery-matrix.tsx
│   ├── requirement-checklist.tsx
│   └── invariant-callout.tsx
├── operational/
│   ├── compute-badge.tsx
│   ├── loading-stepper.tsx
│   ├── sync-indicator.tsx
│   └── diagnostic-error.tsx
└── tokens/
    └── theme.css
```

## 8.3 Component layering

Use three layers:

### Primitive
Behavior/accessibility only.

Examples:

- Dialog
- Popover
- Tabs
- Select
- Tooltip

### Product component
Stable FPLLM semantics.

Examples:

- ComputeBadge
- SubmissionCard
- TestSummary
- ExperimentHeader
- MasteryMatrix

### Screen composition
Route-specific layout.

Examples:

- CausalAttentionLabScreen
- ExperimentResultScreen

A screen must not duplicate primitive behavior that belongs in the UI package.

## 8.4 Design tokens

Use CSS custom properties as the authoritative token surface.

Token families:

```text
--font-*
--text-*
--space-*
--radius-*
--border-*
--surface-*
--shadow-*
--status-neutral-*
--status-positive-*
--status-warning-*
--status-negative-*
--status-research-*
--focus-*
```

Exact color values are **OPEN** until the visual-design phase.

Semantic naming is frozen; avoid component-specific raw hex values.

## 8.5 Density

Default product density should be information-efficient.

Do not create a “card for everything.”

Use cards when they establish a real conceptual or operational boundary.

Tables, rails, inline metadata, and grouped sections are preferred for dense scientific information.

---

# 9. Scientific visualization contract

The chart implementation library is **not frozen** yet; the component API is.

Every chart must:

1. render an accessible textual title;
2. expose the exact underlying data table;
3. avoid color-only series distinction;
4. support keyboard focus where interaction is meaningful;
5. preserve values during responsive reflow;
6. export or copy data independently of the image;
7. avoid misleading smoothed curves unless explicitly justified.

For the Attention prototype, use separate figures for:

- sequence length vs peak reserved VRAM;
- sequence length vs tokens/sec.

Do not use a dual-axis chart.

---

# 10. Database architecture

## 10.1 PostgreSQL as system of record

PostgreSQL stores durable application state and evidence metadata.

Large binary artifacts live in object storage, not database byte columns.

## 10.2 Prisma version policy

Use Prisma ORM **7.x**, pinned to major 7.

Reason: as of the architecture date Prisma 8 remains a release candidate, while Prisma 7 is explicitly supported for production.

Re-evaluate Prisma 8 only after general availability and after the platform has a migration test plan.

## 10.3 Core tables/domains

The logical schema should include at least:

```text
users
identities
sessions

enrollments
course_versions
unit_versions
learner_unit_state

compute_profiles
environment_reports

github_installations
repositories
repository_bindings

submissions
test_runs
test_results

experiments
experiment_runs
experiment_metrics
experiment_artifacts

journal_entries
journal_entry_versions

mastery_requirements
mastery_evidence
mastery_state

jobs
job_events

audit_events
```

## 10.4 ID strategy

Use sortable, globally unique opaque IDs for platform objects, e.g. UUIDv7.

Human-facing experiment labels such as `E-014` are presentation identifiers, not database primary keys.

## 10.5 Append-only evidence

The following objects are effectively append-only after finalization:

- submitted commit identity;
- completed test result;
- locked experiment prediction;
- imported artifact hash;
- submitted interpretation version;
- mastery evidence link.

Corrections create new records/versions rather than rewriting history.

---

# 11. Domain model and state machines

State transitions are enforced server-side.

The browser may request a transition; it does not define whether that transition is valid.

## 11.1 Submission

```text
draft
  ↓
submitted
  ↓
testing
  ├──→ needs_revision
  └──→ passed
```

A `passed` submission remains immutable.

A revision means a new submission tied to a new commit SHA.

## 11.2 Experiment

```text
draft
  ↓
locked
  ↓
awaiting_run
  ↓
running
  ├──→ failed
  └──→ complete
            ↓
        interpreted
```

`draft → locked` is irreversible for that experiment ID.

## 11.3 Mastery

Mastery is a projection over evidence, not a manually toggled boolean.

Example Causal Attention requirement policy:

```text
conceptual_check          satisfied
submission.passed         satisfied
test_run.public_pass      satisfied
test_run.hidden_pass      satisfied
experiment.complete       satisfied
interpretation.finalized  satisfied
```

Only then:

```text
mastery_state = mastered
```

---

# 12. GitHub integration

## 12.1 GitHub App — FROZEN

Repository integration uses a GitHub App rather than requesting broad OAuth `repo` scope.

Reasons:

- repository-specific installation;
- granular permissions;
- installation lifecycle webhooks;
- installation access tokens;
- easier least-privilege design.

## 12.2 Minimum repository permissions

Initial target:

```text
Metadata      read
Contents      read
Checks        write       # if platform posts check results to commits
```

Add permissions only when a concrete feature requires them.

No repository administration permission.

## 12.3 Webhook events

Expected initial events:

```text
installation
installation_repositories
push
```

Potential later events:

```text
repository
pull_request
```

Every webhook request must verify the GitHub signature before processing.

## 12.4 Submission resolution

When the learner submits commit `7bc81ea`, the server resolves and persists the full immutable commit SHA.

Short SHAs are display-only.

The test run always checks out the persisted full SHA.

## 12.5 Authentication is separate

GitHub repository access and user identity are separate concepts.

A learner may authenticate to the learning platform without granting repository access yet.

The exact production identity/auth provider remains **OPEN**.

---

# 13. API architecture

## 13.1 Stable API boundary

The platform exposes a versioned JSON API for the CLI and any cross-service integration:

```text
/api/v1/...
```

Browser-only route mutations may use framework-native server mechanisms internally, but stable external contracts must not depend on opaque framework action identifiers.

## 13.2 Initial API resources

```text
GET    /api/v1/me
GET    /api/v1/enrollments/:id
GET    /api/v1/units/:id/state

POST   /api/v1/repositories/bind
POST   /api/v1/submissions
GET    /api/v1/submissions/:id
POST   /api/v1/submissions/:id/test-runs
GET    /api/v1/test-runs/:id
GET    /api/v1/test-runs/:id/events

POST   /api/v1/experiments
POST   /api/v1/experiments/:id/lock
GET    /api/v1/experiments/:id
POST   /api/v1/experiments/:id/artifacts
POST   /api/v1/experiments/:id/interpretations

POST   /api/v1/environment-reports
POST   /api/v1/artifacts/presign

GET    /api/v1/mastery/:unitId
GET    /api/v1/journal
```

## 13.3 Validation

Every API boundary validates:

- path/query parameters;
- request body;
- authorization;
- object ownership/visibility;
- state transition;
- content size/type where relevant.

Use shared Zod contracts in `packages/api-contracts`.

## 13.4 Idempotency

Mutations that may be retried by CLI/network should support an idempotency key.

Examples:

- environment report upload;
- artifact registration;
- test-run creation;
- experiment artifact import.

---

# 14. CLI integration

The existing Python `fpllm` CLI becomes the local bridge to the web platform rather than being replaced by a Node CLI.

## 14.1 MVP

MVP may use:

- explicit command output;
- manual JSON artifact upload;
- browser-based repository connection.

## 14.2 Planned authenticated CLI

Later:

```text
fpllm login
fpllm doctor --sync
fpllm experiment run E-014
fpllm sync
```

Authentication should use a browser-assisted device/login flow with scoped platform tokens.

Do not ask learners to paste long-lived GitHub personal access tokens into the course CLI.

## 14.3 CLI token scopes

Conceptually:

```text
environment:write
experiments:read
artifacts:write
journal:write
```

CLI tokens must not have administrative platform privileges.

---

# 15. Artifact storage

## 15.1 Object storage

Use an S3-compatible API so the provider can be changed without changing the domain model.

Artifact examples:

- qualification JSON;
- experiment result JSON;
- plots/images;
- profiler traces;
- logs approved for upload;
- capstone bundles.

## 15.2 Direct upload

Large artifacts should upload directly to object storage through short-lived signed URLs rather than streaming through the Next.js server.

## 15.3 Integrity metadata

Every stored artifact records:

```text
sha256
byte_size
media_type
artifact_type
creator/source
experiment_id if applicable
submission_id if applicable
created_at
visibility
storage_key
```

The server verifies expected size/hash after upload where feasible.

## 15.4 Privacy

Default artifact visibility:

```text
private
```

Downloads use authorization + short-lived signed URLs.

---

# 16. Durable jobs

## 16.1 No Redis requirement in MVP

Use PostgreSQL for the first durable queue.

A `jobs` table supports:

- queued/running/succeeded/failed state;
- job type;
- payload reference;
- attempt count;
- lease owner;
- lease expiry;
- next attempt time;
- created/started/completed timestamps.

Workers claim jobs with row locking such as `FOR UPDATE SKIP LOCKED`.

## 16.2 Why

This avoids operating another stateful system before scale requires it and keeps job state auditable alongside evidence state.

If queue throughput becomes a measured bottleneck, introduce a dedicated queue later without changing the domain-level job contract.

## 16.3 Job events

A separate append-only `job_events` table stores:

```text
queued
snapshot_acquired
environment_prepared
public_tests_started
public_tests_completed
hidden_tests_started
hidden_test_group_completed
finalizing
succeeded
failed
```

These events power the staged progress UI.

---

# 17. Live progress

Use Server-Sent Events for test/job status where supported.

Endpoint concept:

```text
GET /api/v1/test-runs/:id/events
```

The stream delivers persisted events, so reconnecting does not lose history.

Client fallback:

```text
poll GET /api/v1/test-runs/:id
```

WebSockets are not required for the first slice.

---

# 18. Hidden-test execution architecture

This is the highest-risk part of the MVP.

## 18.1 Hard boundary

Learner code is untrusted.

Never execute it:

- in the web server process;
- in the database host;
- on a long-lived runner containing platform secrets;
- with access to the container/host runtime socket;
- with unrestricted network access.

## 18.2 Execution sequence

```text
1. server validates passed submission + GitHub installation
2. durable test job created
3. worker claims job
4. worker obtains short-lived repository installation token
5. immutable commit SHA fetched into disposable workspace
6. token discarded before learner code executes where possible
7. sandbox created
8. learner repository mounted/copied into sandbox
9. hidden tests mounted read-only
10. network disabled by default
11. test process runs with CPU/RAM/PID/time limits
12. machine-readable result emitted
13. output scrubbed for hidden-fixture leakage
14. artifacts/results persisted
15. sandbox destroyed
16. mastery projection recomputed
```

## 18.3 Production sandbox requirements

Production requires an ephemeral isolation boundary designed for untrusted code, such as a microVM or hardened container sandbox.

Exact technology/provider remains **OPEN**, but the contract requires:

- non-root execution;
- disposable filesystem;
- no platform secrets;
- no Docker/host socket;
- network off unless a test explicitly requires allowlisted egress;
- CPU quota;
- memory limit;
- PID/process limit;
- wall-clock timeout;
- file-size/output limit;
- read-only hidden tests;
- no persistence between learners;
- complete teardown after run.

Plain long-lived self-hosted CI runners are not accepted as the security boundary for arbitrary learner code.

## 18.4 Local development

Docker may emulate the runner locally for developer convenience.

Local Docker is not evidence that production isolation is sufficient.

## 18.5 Hidden-test secrecy

Hidden tests are never:

- committed to learner-accessible repositories;
- included in browser bundles;
- returned in API responses;
- printed verbatim in failure output.

Failure reports expose only:

- documented invariant ID;
- category;
- sanitized diagnostic summary;
- permitted assistance ladder.

---

# 19. Mastery engine

## 19.1 Server-side policy

Mastery is computed by a domain service from immutable evidence.

The browser does not submit `mastered=true`.

## 19.2 Policy definition

`mastery.yaml` defines requirement IDs and evidence predicates.

Example:

```yaml
unit: phase1.causal-attention
version: 1.0
requires:
  - concept.attention-scaling.completed
  - submission.causal-attention.passed
  - tests.causal-attention.public.passed
  - tests.causal-attention.hidden.passed
  - experiment.attention-memory-scaling.complete
  - interpretation.attention-memory-scaling.finalized
```

The content build validates these identifiers against known evidence types.

## 19.3 Recompute

Mastery state is recomputed when relevant evidence changes.

The resulting state stores:

- policy version;
- evaluated evidence IDs;
- evaluation timestamp;
- result.

Historical mastery remains interpretable after course revisions.

---

# 20. Search architecture

MVP search uses PostgreSQL.

Index:

- published unit titles/headings;
- lab titles;
- experiment titles/IDs;
- learner journal text permitted by ownership rules;
- code reference metadata.

Use:

- PostgreSQL full-text search;
- trigram index for identifiers/near matches.

Do not deploy Elasticsearch/OpenSearch solely for the first vertical slice.

---

# 21. Authorization and privacy

## 21.1 Roles

Initial roles:

```text
learner
reviewer
admin
```

Reviewer/admin functionality may be minimal initially, but authorization semantics must exist from the start.

## 21.2 Ownership rule

Learner-created research objects default to owner-only.

Visibility values:

```text
private
reviewer
public
```

Changing to `public` requires an explicit action.

## 21.3 Authorization location

Authorization is enforced in server domain/repository services, not only by hiding UI controls.

Every object-fetch mutation checks ownership/visibility.

## 21.4 Audit events

Record security/academic-reproducibility events such as:

- repository bound/unbound;
- submission created;
- experiment locked;
- artifact registered;
- interpretation finalized;
- visibility changed;
- mastery granted/revoked by policy revision.

---

# 22. Authentication boundary

The exact end-user identity provider remains **OPEN** because enrollment/payment strategy is not yet frozen.

The implementation must expose an internal auth interface roughly equivalent to:

```ts
interface AuthContext {
  userId: string
  roles: Role[]
  sessionId: string
}
```

Requirements:

- secure HTTP-only session cookies for the browser;
- CSRF-safe mutation design;
- support for linking GitHub identity separately from GitHub App installations;
- ability to add passkey/OIDC/email flows without changing domain object ownership IDs.

Do not use a GitHub access token as the platform session.

---

# 23. Security threat model

Initial threat classes:

## 23.1 Untrusted learner code

Mitigation: isolated ephemeral runner described above.

## 23.2 Forged GitHub webhooks

Mitigation: signature verification, event ID deduplication.

## 23.3 Overbroad repository permission

Mitigation: GitHub App least privilege; repository-specific installation.

## 23.4 Hidden-test exfiltration

Mitigation: no network, read-only hidden tests, output scrubbing, disposable sandbox.

## 23.5 Artifact tampering

Mitigation: content hash, server-issued upload identity, post-upload verification.

## 23.6 Cross-user data access

Mitigation: server authorization on every learner-owned resource; private default.

## 23.7 XSS through learner text

Mitigation: learner content is never MDX/JSX; sanitize rendered Markdown; prohibit arbitrary HTML.

## 23.8 Unsafe remote content in course MDX

Mitigation: course content is trusted Git source and compiled through an allowlisted component map; no runtime fetch-and-eval MDX.

## 23.9 SSRF/file abuse

Mitigation: do not fetch arbitrary learner URLs server-side; artifact uploads use signed object-storage URLs and strict size/type limits.

---

# 24. Performance architecture

## 24.1 Content pages

Learning Units should be cacheable by immutable course/unit version.

The learner-specific shell/state can be composed around versioned content.

## 24.2 Avoid unnecessary hydration

Math, prose, highlighted code, tables, and static diagrams do not need client JavaScript.

Interactive islands should be explicit.

## 24.3 Pagination

Paginate:

- journal timelines;
- experiment history;
- submission history;
- audit history.

Do not load an entire multi-year research history into one page.

## 24.4 Artifact delivery

Large artifacts bypass the web server via signed URLs/CDN.

---

# 25. Observability

Every incoming request/job should carry a correlation ID.

Structured logs include:

```text
timestamp
level
service
request_id/job_id
user_id where appropriate
route/job_type
duration_ms
result/error_code
```

Never log:

- session cookies;
- GitHub installation tokens;
- raw hidden tests;
- private artifact bodies;
- learner secrets.

Use OpenTelemetry-compatible tracing/metrics so the provider can be selected later.

Core operational metrics:

- request latency/error rate;
- DB pool saturation;
- queue depth/age;
- worker claim/run duration;
- sandbox timeout/OOM rate;
- artifact upload failures;
- GitHub webhook failures;
- SSE reconnect frequency.

Educational product metrics remain separate from infrastructure telemetry.

---

# 26. Testing strategy for the web platform

## 26.1 Unit/domain tests

Test:

- state transitions;
- mastery policy evaluation;
- artifact integrity rules;
- authorization predicates;
- content-schema validation.

## 26.2 Component tests

Use Vitest + Testing Library for:

- form interaction;
- status semantics;
- assistance ladder;
- lock confirmation;
- evidence linking.

Prefer behavior assertions over snapshots.

## 26.3 End-to-end

Use Playwright for the complete Attention loop:

```text
login fixture
→ dashboard
→ learning unit
→ lab
→ submit mock commit
→ watch mock test progress
→ experiment draft
→ lock
→ import fixture artifact
→ interpret
→ mastery
→ journal
```

## 26.4 Accessibility

Automated axe checks are required for principal routes, but do not replace manual testing.

Manual prototype acceptance includes:

- keyboard-only traversal;
- focus order;
- dialogs/drawers;
- chart-table alternative;
- zoom;
- at least one screen-reader pass.

---

# 27. API/data consistency rules

## 27.1 Timestamps

Store timestamps in UTC; render in learner locale.

## 27.2 Configs

Store important experiment/test configuration as immutable structured JSON plus schema/version identifiers.

## 27.3 Hashes

Use SHA-256 for:

- uploaded artifacts;
- content manifests;
- tokenizer/dataset identities already defined by the course;
- any evidence package where integrity matters.

## 27.4 Full Git SHA

Persist full Git commit SHA, never only the short form.

## 27.5 Scientific numerical data

Store raw numeric metric values separately from display formatting.

Do not store `"3.1 GB"` as the only representation of memory; store bytes and format for display.

---

# 28. Course version publication

A publish step produces an immutable content manifest:

```json
{
  "courseVersion": "1.0",
  "contentSha256": "...",
  "units": [
    {
      "id": "phase1.causal-attention",
      "version": "1.0",
      "contentHash": "...",
      "labVersion": "1.0",
      "masteryVersion": "1.0"
    }
  ]
}
```

Learner evidence references these versions.

A content edit after publication either:

- produces a new unit version; or
- is classified as a non-semantic editorial patch under a separately defined policy.

The platform must not silently reinterpret an old submission using a materially different mastery contract.

---

# 29. Environment/compute evidence

Environment reports are immutable observations, not mutable profile fields.

Example:

```text
environment_report
  python
  pytorch
  os
  cuda
  gpu model
  total VRAM
  BF16 support
  selected course profile
  fpllm version
  repository commit
  captured_at
```

The learner profile may point to the latest report, but historical experiments retain the report that applied when they ran.

---

# 30. Experiment artifact contract

The Attention memory probe result should normalize to a platform schema resembling:

```json
{
  "schemaVersion": "1",
  "experimentId": "<opaque-id>",
  "experimentType": "attention_memory_scaling",
  "submissionCommit": "<full-sha>",
  "environmentReportId": "<id>",
  "runs": [
    {
      "sequenceLength": 128,
      "peakAllocatedBytes": 0,
      "peakReservedBytes": 0,
      "tokensPerSecond": 0,
      "stepSeconds": 0,
      "status": "complete"
    }
  ]
}
```

Server validation rejects:

- wrong experiment ID;
- wrong commit;
- unsupported schema version;
- malformed numeric values;
- artifact larger than policy allows.

A failed/OOM run is represented explicitly rather than omitted.

---

# 31. Error-code taxonomy

UI errors should be driven by stable machine codes where practical.

Examples:

```text
REPOSITORY_NOT_AUTHORIZED
COMMIT_NOT_FOUND
COMMIT_NOT_REACHABLE
SUBMISSION_ALREADY_FINAL
TEST_SANDBOX_TIMEOUT
TEST_SANDBOX_OOM
HIDDEN_INVARIANT_FAILED
EXPERIMENT_ALREADY_LOCKED
ARTIFACT_COMMIT_MISMATCH
ARTIFACT_SCHEMA_INVALID
ARTIFACT_HASH_MISMATCH
MASTERY_EVIDENCE_INCOMPLETE
```

The UI maps codes to the diagnostic four-part structure:

\[
\text{what failed}
+
\text{evidence}
+
\text{likely area}
+
\text{next action}
\]

---

# 32. Frontend route/component map for the vertical slice

```text
app/
├── (learner)/
│   ├── layout.tsx                 # AppShell
│   ├── home/page.tsx
│   ├── learn/
│   │   └── phase-1/
│   │       └── causal-attention/page.tsx
│   ├── lab/
│   │   └── phase-1/
│   │       └── causal-attention/
│   │           ├── page.tsx
│   │           ├── submission/[id]/page.tsx
│   │           └── tests/[id]/page.tsx
│   ├── experiments/
│   │   └── attention-memory-scaling/
│   │       ├── new/page.tsx
│   │       └── [id]/page.tsx
│   ├── research/
│   │   └── journal/
│   │       ├── page.tsx
│   │       └── [id]/page.tsx
│   └── progress/
│       └── phase-1/page.tsx
├── setup/
│   ├── compute/page.tsx
│   └── repository/page.tsx
└── api/
    └── v1/
        └── ...
```

Route groups may vary, but the user-facing URLs and state boundaries should stay stable.

---

# 33. Component contract examples

## 33.1 `StatusBadge`

```ts
type StatusTone =
  | "neutral"
  | "positive"
  | "warning"
  | "negative"
  | "research"

type StatusBadgeProps = {
  label: string
  tone: StatusTone
  icon?: ReactNode
}
```

Status must include visible text; tone alone is insufficient.

## 33.2 `EvidenceLink`

```ts
type EvidenceLinkProps = {
  kind: "submission" | "test_run" | "experiment" | "journal_entry"
  id: string
  title: string
  state: string
  href: string
}
```

## 33.3 `DiagnosticError`

```ts
type DiagnosticErrorProps = {
  title: string
  evidence?: ReactNode
  likelyAreas?: string[]
  actions: DiagnosticAction[]
}
```

## 33.4 `ExperimentChart`

```ts
type ExperimentChartProps<T> = {
  title: string
  data: T[]
  x: MetricAccessor<T>
  y: MetricAccessor<T>
  table: ReactNode
  description: string
}
```

The table prop is mandatory.

---

# 34. Deployment topology

Production should support independent scaling/deployment of:

```text
web
worker
postgres
object storage
sandbox capacity
```

A reasonable initial deployment shape:

```text
CDN / edge TLS
      │
      ▼
Next.js web replicas
      │
      ├────────► Managed PostgreSQL 18
      │
      ├────────► S3-compatible storage
      │
      └────────► GitHub API/webhooks

Worker replicas
      │
      ├────────► PostgreSQL jobs
      ├────────► object storage
      ├────────► GitHub short-lived installation token
      └────────► isolated sandbox runtime
```

The exact vendors are deliberately not frozen.

The web application should not require deployment to a specific framework vendor to remain functional.

---

# 35. Local developer environment

Local platform development should be reproducible with:

```text
Node 24 LTS
pnpm
PostgreSQL container
S3-compatible local object store or filesystem adapter
mock GitHub integration
mock sandbox/test runner
```

Provide a single developer bootstrap command eventually, e.g.:

```text
pnpm dev:setup
pnpm dev
```

The local prototype does not require a real GPU because the web app consumes fixture experiment artifacts.

---

# 36. CI pipeline

Required checks on every platform pull request:

```text
typecheck
lint
unit tests
component tests
content schema validation
course reference validation
build
Playwright smoke slice
accessibility smoke checks
```

Security-sensitive worker/sandbox code additionally requires dedicated integration tests.

Published course-content changes must run content-contract validation even if no TypeScript changed.

---

# 37. Migration discipline

Database migrations are committed and reviewed.

Production deployment follows:

```text
expand
→ deploy compatible application
→ backfill if necessary
→ contract later
```

Do not combine destructive schema migration and dependent application change into an unrecoverable single step.

Backups and restore tests are part of production readiness, even though they are not required for the static UX prototype.

---

# 38. MVP implementation boundary

## Included

The first technical implementation supports:

- learner shell;
- versioned Causal Attention content;
- lab contract;
- repository binding;
- immutable commit submission;
- mock then real test-run pipeline;
- public/hidden result model;
- experiment draft/lock/import/result;
- journal entry linkage;
- mastery projection;
- progress view;
- compute-profile display;
- artifact storage;
- auditability.

## Deferred

Still deferred:

- browser IDE;
- managed learner GPU fleet;
- real-time collaboration;
- social feed/forum;
- payments;
- full instructor console;
- rich paper editor;
- peer marketplace;
- generalized LMS authoring UI;
- dedicated Redis/search cluster;
- WebSocket infrastructure unless measured need appears.

---

# 39. Technical risks and mitigations

| Risk | Mitigation |
|---|---|
| Hidden-test worker becomes remote-code-execution path | hard sandbox boundary; no secrets; no network; ephemeral runtime |
| Course content and learner state drift across versions | immutable content manifests + version references |
| GitHub permissions become too broad | GitHub App + least privilege + repository-specific installation |
| Evidence can be rewritten after result | append-only/finalized records + audit events |
| Client state becomes source of truth | server state machines and mastery policy |
| MDX becomes code-injection surface | trusted course MDX only; learner text never MDX |
| Infrastructure becomes overcomplicated too early | PostgreSQL queue/search first; provider-neutral storage; no Redis/OpenSearch by default |
| Component library dictates visual identity | own source components/tokens; Radix only as primitive layer |
| Scientific charts become inaccessible | mandatory raw data table + non-color semantics |
| Framework-specific API becomes CLI contract | explicit `/api/v1` JSON boundary |

---

# 40. Architecture acceptance criteria

The architecture is considered successfully implemented for the first vertical slice when:

1. a learner can read the versioned Causal Attention unit;
2. the platform knows the learner's selected compute profile;
3. a GitHub App can bind one selected repository with least-privilege access;
4. the learner can submit an immutable full commit SHA;
5. the web process never executes learner repository code;
6. a separate worker can produce staged test events and persisted results;
7. hidden failures return invariant-oriented feedback without leaking fixtures;
8. the learner can create and irreversibly lock a prediction;
9. an experiment artifact with a mismatching commit is rejected;
10. valid results render as an accessible chart + exact data table;
11. interpretation is versioned and linked to the experiment;
12. mastery is computed from evidence, not manually toggled;
13. the completed experiment appears in the journal;
14. historical evidence remains tied to course/lab/policy versions;
15. the core route can be completed using keyboard navigation;
16. private learner evidence cannot be fetched by another learner;
17. all artifact downloads require authorization or time-limited signed access;
18. a Playwright test covers the complete mocked evidence loop.

---

# 41. Architecture decisions frozen by this document

This document newly freezes:

1. **Next.js 16.x App Router + React 19.3-compatible + TypeScript on Node 24 LTS** for the first web implementation.
2. **pnpm + Turborepo monorepo**.
3. **Tailwind 4.x + Radix Primitives + project-owned source components/design tokens**.
4. **Git-versioned MDX/YAML content**, with build-time schema validation.
5. **PostgreSQL 18.x as the system of record**.
6. **Prisma ORM 7.x**, explicitly avoiding Prisma 8 RC for the first production baseline.
7. **S3-compatible provider-neutral artifact storage**.
8. **PostgreSQL-backed durable jobs and search for MVP**, avoiding Redis/OpenSearch without measured need.
9. **GitHub App for repository access**, separate from platform authentication.
10. **Separate isolated worker/sandbox for all untrusted learner code**.
11. **SSE + persisted job events** for live test progress, with polling fallback.
12. **Server-side mastery policy computed from immutable evidence**.
13. **`/api/v1` stable JSON boundary** for the Python CLI and future integrations.
14. **Trusted MDX only for course content; learner text never executes as MDX/JSX**.
15. **OpenTelemetry-compatible observability** with provider choice deferred.
16. **Vitest/Testing Library + Playwright + accessibility checks** as the web test baseline.

---

# 42. Decisions intentionally left open

The following remain **OPEN**:

- exact hosting provider;
- exact PostgreSQL provider;
- exact S3-compatible provider;
- exact identity/auth provider;
- payment provider;
- exact production sandbox technology/provider;
- exact chart library;
- exact visual color/typography token values;
- reviewer/instructor product scope;
- managed GPU provider;
- whether/when Redis, dedicated search, or WebSockets become justified.

These choices should be made from concrete product/scale/security requirements rather than frozen prematurely.

---

# 43. Recommended next build artifact

The next artifact should be:

**Causal Attention Web Prototype Scaffold v0.1**

It should contain the actual monorepo skeleton with:

```text
apps/web
packages/ui
packages/content
packages/domain
course/phase1/causal-attention
```

and implement the vertical slice initially against fixture/mock backend data.

The sequence should be:

\[
\boxed{
\text{static shell}
\rightarrow
\text{real course content}
\rightarrow
\text{mock evidence flow}
\rightarrow
\text{real persistence}
\rightarrow
\text{GitHub integration}
\rightarrow
\text{isolated test worker}
}
\]

This prevents infrastructure work from blocking validation of the core learning experience.

---

# 44. External technology notes checked for this architecture

Current-version decisions in this document were checked against first-party documentation on 2026-09-18:

- Next.js: https://nextjs.org/blog and https://nextjs.org/docs
- React: https://react.dev/versions
- Node.js: https://nodejs.org/en/about/previous-releases
- Tailwind CSS: https://tailwindcss.com/blog
- PostgreSQL: https://www.postgresql.org/about/newsarchive/pgsql/
- Prisma ORM: https://www.prisma.io/docs/orm/release-status
- GitHub Apps: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps
- GitHub Actions runner security: https://docs.github.com/en/actions/reference/security/secure-use
- Radix accessibility: https://www.radix-ui.com/primitives/docs/overview/accessibility
- MDX: https://mdxjs.com/docs/what-is-mdx/

---

**End of Web Platform Technical Architecture & Component System v1.0**

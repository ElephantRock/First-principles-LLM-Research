# Contributing

First Principles LLM Research is developed as a reproducible research and learning system rather than a conventional content site.

## Development principles

1. Preserve the decisions in `PROJECT_DECISIONS.md` unless a deliberate project decision changes them.
2. Keep course content versioned under `course/`.
3. Treat Git commits, configs, datasets/content identities, seeds, and environment metadata as reproducibility evidence.
4. Do not execute learner-supplied code inside the web process.
5. Public tests should teach documented contracts; hidden tests must not rely on undocumented requirements.
6. Prefer a complete evidence-producing vertical slice over broad but shallow feature coverage.

## Web development

Target runtime: Node.js 24.

```bash
corepack enable
pnpm install
pnpm db:generate
pnpm content:validate
pnpm typecheck
pnpm test
pnpm build
```

Local PostgreSQL is described in `infra/docker/compose.dev.yaml`.

## Pull requests

Keep pull requests focused. State the decision/specification being implemented and provide verification evidence. Architectural changes that alter frozen decisions should update the decision register in the same pull request.

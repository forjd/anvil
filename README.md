# Anvil

A local-first Electron coding agent for working with repositories using Codex.

## Status

This repo is at the initial scaffold stage. The current focus is:

- shaping the product and technical plan
- defining the Electron + Codex app-server architecture
- putting repo hygiene in place early

## Planned stack

- Electron
- React
- TypeScript
- electron-vite
- ESLint + Prettier
- Husky + lint-staged
- Conventional Commits
- release-please for SemVer releases

## Repo layout

```text
.
├── .github/workflows/     # CI, release, and PR title checks
├── docs/plans/            # Product and architecture planning docs
├── src/main/              # Electron main process
├── src/preload/           # Electron preload bridge
├── src/renderer/          # React renderer app
├── electron.vite.config.ts
├── eslint.config.mjs
└── release-please-config.json
```

## Getting started

```bash
corepack enable
pnpm install
pnpm dev
```

Other useful commands:

```bash
pnpm lint
pnpm typecheck
pnpm format
pnpm build
```

## Conventions

### Commits

Use Conventional Commits:

- `feat: add repo picker shell`
- `fix: handle missing workspace path`
- `docs: add MVP scope draft`

### Releases

Releases are managed with `release-please`.

- `fix:` -> patch release
- `feat:` -> minor release
- `!` or `BREAKING CHANGE:` -> major release

A semantic PR title workflow is included so squash merges can still drive versioning correctly.

## Next docs to write

- `docs/plans/mvp-scope.md`
- `docs/plans/desktop-runtime.md`
- `docs/plans/approval-and-sandboxing.md`
- `docs/plans/release-strategy.md`

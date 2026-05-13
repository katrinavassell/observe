# Contributing to observe

## Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or use Docker)

## Setup

```bash
git clone https://github.com/katrinalaszlo/observe.git
cd observe
npm install
cp .env.example .env    # fill in DATABASE_URL, CLERK_SECRET_KEY, SESSION_SECRET, INTEGRATION_ENCRYPTION_KEY
npm run dev             # frontend :5173 | API :3001
```

Or with Docker:

```bash
docker compose up
```

## Project structure

```
src/                  Vue 3 frontend (Vite + TypeScript)
  pages/              Route-level page components
  components/         UI components
  lib/                API clients, utilities, formatters
  layouts/            App layout with sidebar navigation
server/               Express API backend
  index.ts            Entry point (routes, migrations, middleware)
  routes/             Route modules
  providers/          LLM provider adapters
  lib/                Revenue enrichment, model pricing, encryption
packages/sdk/         @tansohq/observe npm SDK
docs/                 Documentation
```

## Development commands

```bash
npm run dev          # start frontend + backend
npm run test         # run tests (Vitest)
npm run typecheck    # type-check (vue-tsc)
npm run lint         # lint (ESLint)
npm run build        # production build
```

## Submitting a PR

1. Fork the repo, create a branch from `main`.
2. Make your changes. Add tests if applicable.
3. Run `npm run test && npm run typecheck` to verify.
4. Open a PR with a clear title and description of what changed and why.

Keep PRs focused — one feature or fix per PR.

## Code style

- TypeScript throughout. No `any` unless unavoidable.
- Vue 3 Composition API with `<script setup>`. No Options API.
- Prefer readability over cleverness. Three similar lines > a premature abstraction.
- No comments unless the "why" is non-obvious.

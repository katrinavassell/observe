# Contributing to Observe

Thanks for your interest in contributing! This guide will help you get set up.

## Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or use Docker)

## Setup

```bash
git clone https://github.com/tanso/observe.git
cd observe
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL and a SESSION_SECRET
npm run dev
```

This starts the API server on `http://localhost:3001` and the frontend on `http://localhost:5173`.

Alternatively, run everything with Docker:

```bash
docker compose up
```

## Project Structure

```
src/                  Vue 3 frontend (Vite + TypeScript)
  components/         UI components (charts, dashboard, onboarding, etc.)
  composables/        Vue composables (data fetching, state)
  lib/                Shared utilities, API clients, analyzers
  pages/              Route-level page components
server/               Express API backend
  index.ts            Main server entry point
  stripe-client.ts    Stripe integration
  tanso-client.ts     Tanso billing client
  api-key-store.ts    API key management
docs/                 Documentation
```

## Development

- `npm run dev` — Start frontend + backend concurrently
- `npm run test` — Run tests
- `npm run typecheck` — Type-check with vue-tsc
- `npm run lint` — Lint with ESLint

## Submitting a PR

1. Fork the repo and create a branch from `main`.
2. Make your changes. Add tests if applicable.
3. Run `npm run test` and `npm run typecheck` to verify.
4. Open a pull request with a clear description of what changed and why.

Keep PRs focused — one feature or fix per PR makes review easier.

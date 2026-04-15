# Contributing to Observe

Thanks for your interest in contributing! This guide will help you get set up.

## Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or use Docker)

## Setup

```bash
git clone https://github.com/tansohq/observe.git
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
  components/         UI components (charts, dashboard, integrations, onboarding, etc.)
  composables/        Vue composables (auth, data mode, entitlements, teams)
  layouts/            App layout with sidebar navigation
  lib/                Shared utilities, API clients, analyzers
  pages/              Route-level page components
server/               Express API backend
  index.ts            Main server entry point (routes + inline handlers)
  routes/             Route modules (auth, data, integrations, tanso, alerts)
  stripe-client.ts    Stripe integration
  tanso-client.ts     Tanso billing client
  model-pricing.ts    AI model pricing data
docs/                 Documentation
packages/sdk/         @tansohq/observe SDK
```

## Development

- `npm run dev` -- Start frontend + backend concurrently
- `npm run test` -- Run tests with Vitest
- `npm run typecheck` -- Type-check with vue-tsc
- `npm run lint` -- Lint with ESLint

## Submitting a PR

1. Fork the repo and create a branch from `main`.
2. Make your changes. Add tests if applicable.
3. Run `npm run test` and `npm run typecheck` to verify.
4. Open a pull request with a clear description of what changed and why.

Keep PRs focused -- one feature or fix per PR makes review easier.

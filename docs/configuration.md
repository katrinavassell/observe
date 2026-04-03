# Configuration Reference

Observe is configured through environment variables. Copy `.env.example` to `.env` and fill in the values relevant to your deployment.

Variables marked as optional will gracefully degrade -- the app runs without them, but the corresponding features are disabled.

## Required

The app will not start without these.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string (e.g., `postgresql://user:pass@host/dbname?sslmode=require`) |
| `SESSION_SECRET` | Yes | -- | Random string for signing session cookies. Must be at least 32 characters. |

## Stripe Billing

All features are unlocked if these are not set. Set them to enable paid plans and metered billing.

| Variable | Required | Default | Description |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | No | -- | Stripe secret key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_PUBLISHABLE_KEY` | No | -- | Stripe publishable key (`pk_test_...` or `pk_live_...`) |
| `STRIPE_GROWTH_PRICE_ID` | No | -- | Stripe Price ID for the growth plan (`price_...`) |
| `STRIPE_WEBHOOK_SECRET` | No | -- | Stripe webhook signing secret (`whsec_...`) |

## AI Providers

Proxy mode and AI-powered suggestions are disabled if these are not set.

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | No | -- | OpenAI API key for proxy mode and AI Insights generation |
| `ANTHROPIC_API_KEY` | No | -- | Anthropic API key for proxy mode |

## Email Alerts

Alerts can still be created without these, but notification emails will never be sent.

| Variable | Required | Default | Description |
|---|---|---|---|
| `RESEND_API_KEY` | No | -- | Resend API key for sending alert notification emails |
| `ALERT_FROM_EMAIL` | No | `alerts@yourdomain.com` | Sender email address for alert notifications |
| `APP_URL` | No | -- | Base URL of your deployment, used in alert email links (e.g., `https://yourdomain.com`) |

## Model Pricing

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENROUTER_API_KEY` | No | -- | OpenRouter API key for refreshing model pricing data. Uses seed data if not set. |

## Deployment

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | -- | Set to `production` for production deployments. Enables secure cookies and static file serving. |
| `PORT` | No | `3001` (dev), `3000` (Docker) | Server port |
| `ALLOWED_ORIGINS` | No | `http://localhost:5000,http://localhost:5173` | Comma-separated list of allowed CORS origins |
| `DB_DRIVER` | No | Neon serverless | Database driver selection. Set to `pg` for standard PostgreSQL; omit for Neon (`@neondatabase/serverless`). |
| `ADMIN_EMAILS` | No | -- | Comma-separated admin email addresses for elevated access |
| `VERCEL` | No | -- | Set automatically by Vercel. When present, disables local static file serving. |

## Generating Secrets

Generate a session secret:

```sh
openssl rand -hex 32
```

---

`.env.example` is the canonical source for this list. If this document and `.env.example` disagree, trust `.env.example`.

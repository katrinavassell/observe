# Security Model

Technical reference for the Observe project's security architecture.

## Authentication

- Email/password auth is handled by Supabase Auth. The server verifies Supabase JWTs on each request via `supabase.auth.getUser(token)` in `ensureVisitor` middleware.
- No local password hashing — the legacy `accounts.password_hash` column stores the literal `'supabase-managed'` for rows created after the Supabase migration.
- Password reset is handled by Supabase.
- Demo mode allows unauthenticated exploration with sample data (no account required).

## Data Isolation

- All database queries filter by `user_id` (visitor session ID). Each user only sees their own data — no cross-tenant access.
- Team access: the `visitor_org_map` table maps visitors to organizations for shared data access.
- Organization members can have `admin` or `viewer` role.
- The `ensureVisitor` middleware creates a visitor ID if one is not already present in the session.

## API Key Security

- SDK API keys authenticate requests to the `/events/ingest` endpoint (public, key-authenticated).
- Keys are hashed with SHA-256 and stored as `key_hash` in the `sdk_api_keys` table.
- Only the key prefix (first 8 characters) is stored in plaintext for display purposes.
- Keys can be revoked via a `revoked_at` timestamp.
- A partial index on `key_hash WHERE revoked_at IS NULL` enables fast lookups of active keys.

## Rate Limiting

Rate limiting is handled by `express-rate-limit` middleware.

| Scope | Limit | Window |
|---|---|---|
| Auth endpoints (`/auth/*`) | 20 requests | 15 minutes |
| API endpoints (`/api/*`) | 60 requests | 1 minute |
| Expensive operations (insights generation) | 5 requests | 1 minute |

- Standard `RateLimit` headers are included in responses.
- Error response format: `{ "error": "Too many attempts, please try again later" }`

## Security Headers

- Helmet middleware with default configuration.
- Sets `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, and other standard headers.

## CORS

- Origins restricted to the `ALLOWED_ORIGINS` environment variable (comma-separated list).
- Defaults: `http://localhost:5000`, `http://localhost:5173`
- `credentials: true` is enabled for cookie-based auth.
- Production: set `ALLOWED_ORIGINS` to your actual domain(s).

## Request Parsing

- JSON body limit: 2mb.
- The Stripe webhook endpoint is excluded from JSON parsing (it needs the raw body for signature verification).

## Trust Proxy

- `trust proxy` is set to `1` — necessary when running behind a reverse proxy (nginx, Caddy, load balancer).
- Ensures `req.ip` and secure cookies work correctly behind a proxy.

## What's NOT Covered (Limitations)

- No encryption at rest (relies on database-level encryption if needed).
- No audit logging (no record of who accessed what data when).
- No MFA / 2FA.
- No OAuth / SSO.
- No IP allowlisting.
- No API request signing.
- Integration API keys (OpenAI, Anthropic, Stripe) are stored with limited protection — an `encrypted_api_key` column exists but encryption implementation varies.

## Recommendations for Production

- Always set a strong `SESSION_SECRET` (at least 64 hex chars): `openssl rand -hex 32`
- Set `NODE_ENV=production` to enable secure cookies.
- Set `ALLOWED_ORIGINS` to your actual domain.
- Use HTTPS (via reverse proxy) — required for secure cookies.
- Regularly rotate `SESSION_SECRET` (will invalidate all active sessions).
- Use PostgreSQL SSL connections (`sslmode=require` in `DATABASE_URL`).

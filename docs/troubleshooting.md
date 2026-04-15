# Troubleshooting & FAQ

Common issues and how to fix them.

---

## "Cannot connect to database"

**Problem:** The app fails to start or crashes with a database connection error.

**Cause / Fix:**

- **Wrong URL scheme.** The connection string must start with `postgresql://`, not `postgres://`. Some providers (like Neon) generate URLs with `postgres://` -- update it manually.

- **SSL required.** If you're using Neon or another cloud-hosted Postgres, append `?sslmode=require` to your `DATABASE_URL`.

- **Connection timeout.** The default pool settings are:
  - `max`: 20 connections
  - `idleTimeoutMillis`: 30000 (30s)
  - `connectionTimeoutMillis`: 5000 (5s)

  If your database is slow to respond (cold starts on serverless Postgres, for example), you may need to increase `connectionTimeoutMillis`.

- **Docker networking.** Inside Docker Compose, use the service name as the host, not `localhost`:
  ```
  postgres://tanso:tanso_local@postgres:5432/tanso
  ```

---

## "Session cookie not working / logged out on every request"

**Problem:** You can log in, but every subsequent request acts like you're unauthenticated.

**Cause / Fix:**

- **Cross-origin mismatch.** The `ALLOWED_ORIGINS` environment variable must include your frontend URL (e.g., `http://localhost:5173`). Without this, the browser blocks the `Set-Cookie` header.

- **Missing credentials in fetch.** All API calls must include `credentials: 'include'`. This is handled by `src/lib/api.ts` -- if you're making direct fetch calls elsewhere, add it manually.

- **Secure cookies in dev.** When `NODE_ENV=production`, cookies are set with `Secure: true`, which requires HTTPS. For local development, use `NODE_ENV=development` (or don't set it) so cookies work over HTTP.

- **Cookie details:** The session cookie is named `pa.sid` with a `maxAge` of 7 days.

- **Reverse proxy.** `trust proxy` is set to `1`. This is required when running behind a reverse proxy (Vercel, nginx, etc.) so Express reads the correct protocol from `X-Forwarded-Proto`.

---

## "Proxy returns 401 or 403"

**Problem:** Requests through the AI proxy endpoint return 401 Unauthorized or 403 Forbidden.

**Cause / Fix:**

- The proxy never blocks or modifies your requests. A 401 or 403 always comes from the upstream provider (OpenAI, Anthropic, etc.).

- Your OpenAI or Anthropic API key must be in the `Authorization` header as you would normally send it to the provider.

- The `Observe-Key` header is optional. Without it, the request is still proxied to the upstream provider -- it just won't log a usage event in Observe.

---

## "No data showing after CSV upload"

**Problem:** You uploaded a CSV file but the dashboard shows no data.

**Cause / Fix:**

- **Column mapping.** Revenue CSVs require at minimum: `customer_id`, `plan_id`, `price_amount`. If your columns have different names, map them during upload.

- **Cost CSV month format.** The `month` column must use `YYYY-MM` format (e.g., `2025-03`).

- **Data mode not switched.** After uploading, check the `/data/status` endpoint. Verify that `data_mode` has switched to `"user"`. If it still shows `"sample"`, the upload may not have completed successfully.

- **Mixed data.** Clear sample data before uploading real data to avoid mixing sample and real records. Use the Clear All button on the Data Sources page or the `DELETE /data/clear` endpoint.

---

## "Alerts not sending emails"

**Problem:** Alerts are created and appear in the UI, but no email notifications are sent.

**Cause / Fix:**

- **Missing environment variables.** All three are required for email delivery:
  - `RESEND_API_KEY`
  - `ALERT_FROM_EMAIL`
  - `APP_URL`

  Without these, alerts are still created and evaluated on schedule -- they just won't send emails.

- **Cooldown window.** Each alert has a `cooldown_minutes` setting (default: 60). An alert won't fire again within that window, even if the condition is still met. Check whether the alert already fired recently.

---

## "Docker Compose fails to start"

**Problem:** `docker compose up` errors out or a service keeps restarting.

**Cause / Fix:**

- **Port 3000 already in use.** Another process is bound to port 3000. Either stop it or change the port mapping in `docker-compose.yml`:
  ```yaml
  ports:
    - "3001:3000"
  ```

- **PostgreSQL volume permissions.** If the Postgres container fails to initialize, try resetting the volume:
  ```bash
  docker compose down -v
  docker compose up
  ```

- **Health check dependency.** The app container depends on the Postgres service passing `pg_isready`. If Postgres is slow to start, the app will wait. Check the Postgres container logs for errors.

---

## "Rate limited (429 responses)"

**Problem:** API requests return HTTP 429 Too Many Requests.

**Cause / Fix:**

Rate limits are per-IP and vary by endpoint:

| Endpoint type | Limit |
|---|---|
| Auth endpoints (login, register) | 20 requests per 15 minutes |
| API endpoints (general) | 60 requests per minute |
| Expensive operations (insights) | 5 requests per minute |

All responses include `RateLimit-*` standard headers showing your current limit, remaining quota, and reset time.

If you're hitting limits during development, wait for the window to reset. There is no override.

---

## "How to reset all data and start fresh"

**Problem:** You want to clear all uploaded data and start over.

**Fix:**

Two options:

1. **UI:** Use the "Clear All" button on the Data Sources page.
2. **API:** Send `DELETE /data/clear`.

This clears `observe_events` and legacy tables for the current user only. Other users' data is isolated by `user_id` and is not affected.

---

## "App works locally but not on Vercel"

**Problem:** Everything runs fine in local dev, but the Vercel deployment fails or returns errors.

**Cause / Fix:**

- **Rewrites.** `vercel.json` must have rewrites that route `/api/*` to the serverless function. Without this, API requests hit the static frontend and return HTML instead of JSON.

- **Environment variables.** These must be set in the Vercel project settings (not just in your local `.env`):
  - `DATABASE_URL` -- your Neon (or other cloud Postgres) connection string.
  - `SESSION_SECRET` -- required for session encryption.

- **DB driver.** `DB_DRIVER` can typically be left as the default for Vercel deployments, which uses the Neon serverless driver.

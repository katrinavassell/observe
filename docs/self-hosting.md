# Self-Hosting Guide

Production deployment guide for running Observe on your own infrastructure.

## Prerequisites

You need one of the following:

- **Docker 20+** and **Docker Compose v2** (recommended)
- **Node.js 20+** with **PostgreSQL 16+** (manual setup)

Hardware requirements:

- Minimum: 1 CPU, 512 MB RAM (single-process Express server)
- A domain name with HTTPS (required for secure session cookies)

---

## Docker Deployment (Recommended)

The included `docker-compose.yml` runs PostgreSQL 16 Alpine and the app:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: tanso
      POSTGRES_PASSWORD: tanso_local
      POSTGRES_DB: tanso
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tanso"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://tanso:tanso_local@postgres:5432/tanso
      DB_DRIVER: pg
      SESSION_SECRET: change-me-in-production
      PORT: 3000
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

Start the stack:

```bash
docker compose up -d
```

### Production Overrides

Create a `docker-compose.prod.yml` to override defaults for production:

```yaml
services:
  postgres:
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "1.0"
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  app:
    restart: unless-stopped
    environment:
      SESSION_SECRET: <run: openssl rand -hex 32>
      ALLOWED_ORIGINS: https://observe.yourdomain.com
      NODE_ENV: production
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "1.0"
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Generate a strong session secret:

```bash
openssl rand -hex 32
```

Run with the production override:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## Reverse Proxy

A reverse proxy handles HTTPS termination and forwards traffic to the app on port 3000.

### Caddy (simplest -- auto-HTTPS)

Caddy automatically provisions and renews TLS certificates via Let's Encrypt.

```
observe.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Save this as `Caddyfile` and run:

```bash
caddy run
```

That's it. Caddy handles certificate issuance, renewal, and HTTPS redirects automatically.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name observe.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/observe.crt;
    ssl_certificate_key /etc/ssl/private/observe.key;

    location / {
        proxy_pass http://localhost:3000;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (good practice for future use)
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    server_name observe.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

Note: Express has `trust proxy` set to `1`, so `X-Forwarded-*` headers are respected for correct IP detection, protocol awareness, and secure cookies.

---

## PostgreSQL in Production

### Backups

Daily backup with `pg_dump`:

```bash
pg_dump -U tanso -h localhost -d tanso -F c -f /backups/tanso_$(date +%Y%m%d).dump
```

Automate with cron (runs daily at 2 AM):

```cron
0 2 * * * pg_dump -U tanso -h localhost -d tanso -F c -f /backups/tanso_$(date +\%Y\%m\%d).dump
```

Restore from a backup:

```bash
psql -U tanso -h localhost -d tanso < /backups/tanso_20260401.dump
```

For custom-format dumps (created with `-F c`), use `pg_restore` instead:

```bash
pg_restore -U tanso -h localhost -d tanso /backups/tanso_20260401.dump
```

### Using Neon Serverless

[Neon](https://neon.tech) provides serverless PostgreSQL, which works well for Vercel deployments.

- Set `DATABASE_URL` to your Neon connection string (it includes `sslmode=require`)
- Leave `DB_DRIVER` unset or empty (defaults to the Neon driver)

```env
DATABASE_URL=postgres://user:password@ep-cool-name-123456.us-east-2.aws.neon.tech/tanso?sslmode=require
```

### Connection Pooling

The Express app pool defaults:

- Max connections: 20
- Idle timeout: 30 seconds
- Connection timeout: 5 seconds

For high traffic, consider [PgBouncer](https://www.pgbouncer.org/) in front of PostgreSQL, or use Neon's built-in connection pooling.

---

## Database Setup

No manual migration step is needed:

- Tables are created automatically on first request (`CREATE TABLE IF NOT EXISTS`)
- Migrations run via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- Schema is always forward-compatible (new columns are added, never removed)

---

## Vercel Deployment

Observe includes a `vercel.json` with rewrites already configured.

1. Push your repo to GitHub and import it into Vercel.
2. Set environment variables in the Vercel dashboard:
   - `DATABASE_URL` -- your Neon connection string
   - `SESSION_SECRET` -- strong random value (`openssl rand -hex 32`)
3. `DB_DRIVER` defaults to Neon, which is recommended for Vercel.
4. The serverless function at `api/index.ts` wraps the Express app.
5. Function max duration: 30 seconds.

---

## Environment Hardening

See [docs/configuration.md](configuration.md) for the full environment variable reference.

Key production settings:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | Strong random value (64+ hex chars) |
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | Your domain(s), comma-separated |
| `ADMIN_EMAILS` | Comma-separated emails with admin dashboard access |

HTTPS should be handled by your reverse proxy (Caddy, nginx, or your hosting platform). Do not terminate TLS at the Express server.

---

## Health Checks

**Application:** `GET /session/init` returns `{ visitorId: "..." }`. Use this as a liveness/readiness probe.

**PostgreSQL (Docker):** The `pg_isready -U tanso` healthcheck in `docker-compose.yml` ensures the database is accepting connections before the app starts.

---

## Scaling Considerations

Observe runs as a single-process Node.js/Express server. This handles roughly 100-500 concurrent users comfortably.

- **Vertical scaling** (more RAM/CPU) is the simplest path and goes a long way.
- **Horizontal scaling:** Run multiple app containers behind a load balancer. Session cookies require sticky sessions, or you need to switch to a shared session store (e.g., Redis).
- **Database:** PostgreSQL is typically the bottleneck first. Indexes are already optimized for common queries. Monitor slow queries with `pg_stat_statements`.

---

## Monitoring

- Application logs go to stdout (Docker captures them via the configured logging driver).
- Key log messages to watch for:
  - `"Database connection verified"` -- app connected to PostgreSQL successfully
  - `"Server running on http://localhost:PORT"` -- app is ready to serve requests
- Database errors are logged to stderr.
- No built-in metrics endpoint. If you need metrics, consider adding Prometheus middleware (e.g., `express-prom-bundle`).

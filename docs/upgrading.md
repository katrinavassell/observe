# Upgrading Observe

## How Schema Migrations Work

Observe does not use a migration framework. There are no migration files, no migration CLI, and no separate migration step.

Instead, schema is managed directly in the `_doDbInit()` function in `server/index.ts`:

- Tables are created with `CREATE TABLE IF NOT EXISTS`
- New columns are added with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`

Schema is applied on the first request after server start, not at build time.

This means:

- **Upgrading is just pulling new code and restarting.** No migration commands to run.
- **No data loss.** Existing tables and rows are preserved. New columns are added alongside them.
- **New columns get default values.** Queries against old rows work without backfilling.
- **Downgrades are not officially supported.** New columns will remain in the database but are ignored by older code.

## Upgrade Steps

### Docker

```bash
# 1. Back up your database
docker exec <postgres-container> pg_dump -U tanso tanso > backup-$(date +%Y%m%d).sql

# 2. Pull latest code
git pull origin main

# 3. Rebuild and restart
docker compose down
docker compose build
docker compose up -d

# 4. Verify
curl -s http://localhost:3000/session/init
```

### Local Development

```bash
# 1. Back up your database
pg_dump -h localhost -U <user> <dbname> > backup-$(date +%Y%m%d).sql

# 2. Pull latest
git pull origin main

# 3. Install dependencies
npm install

# 4. Restart
npm run dev
```

### Vercel

- Push to main or merge a PR -- Vercel auto-deploys.
- Schema updates happen on the first request to the new deployment.
- No manual migration step needed.

## Backup and Restore

### Create a Backup

```bash
pg_dump -h <host> -U <user> <dbname> > backup.sql
```

### Restore from Backup

```bash
psql -h <host> -U <user> <dbname> < backup.sql
```

## Breaking Changes

- Observe follows semantic versioning for breaking changes.
- Breaking changes will be documented in GitHub Releases.
- The database schema is append-only (columns added, never removed), so schema changes are non-breaking by default.

## Version History

This section will be populated as versions are released.

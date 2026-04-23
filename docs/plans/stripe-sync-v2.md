# Stripe Sync v2 — Incremental Upsert + Webhooks

**Status**: Backlog
**Date**: 2026-04-22
**Context**: Current sync does DELETE all + re-INSERT on every Stripe connect/re-sync. This caused a retroactive enrichment bug (see `fix/stripe-backfill-retroactive`) and will not scale.

## Problem

1. Destructive sync wipes SDK-created customer records
2. No incremental updates — every re-sync is a full rebuild
3. Fire-and-forget backfill silently fails
4. No webhook listener — changes in Stripe only appear on manual re-sync

## Proposed Architecture

```
First connect:  Full paginated sync (list endpoints) → upsert
Ongoing:        Stripe webhooks → persist raw → async upsert
Recovery:       If event cursor >30d stale, auto full-refresh
Manual:         "Re-sync" button triggers full refresh (escape hatch)
```

## Priority 1: Upsert + Timestamp Protection

Replace DELETE + INSERT with idempotent, out-of-order-safe upsert. ~15 lines of SQL.

```sql
INSERT INTO customers (id, name, email, stripe_customer_id, last_synced_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, email = EXCLUDED.email,
  last_synced_at = EXCLUDED.last_synced_at
WHERE customers.last_synced_at IS NULL
   OR customers.last_synced_at < EXCLUDED.last_synced_at;
```

**Source**: Supabase stripe-sync-engine. They use this for every entity. The `last_synced_at` WHERE clause rejects stale out-of-order updates silently.

**Migration**: Add `last_synced_at TIMESTAMPTZ` to customers, subscriptions, plans tables.

**Note**: Observe has dual unique constraints on customers that break ON CONFLICT (see `bugs_customer_upsert.md`). Fix the constraint first or use a CTE-based upsert.

## Priority 2: Inbound Webhook Table

Store raw webhook payloads, ACK immediately, process async.

```sql
CREATE TABLE inbound_webhooks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  source          TEXT NOT NULL DEFAULT 'stripe',
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  signature       TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending/processing/succeeded/failed
  processing_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_inbound_webhooks_retry
  ON inbound_webhooks (status, created_at) WHERE status IN ('pending', 'processing');
```

Clock job retries stuck webhooks after 2 hours. 90-day retention.

**Source**: Lago. Their two-phase pattern (persist + ACK, then process async) means Stripe never sees failures.

**Event types to handle**: `customer.created`, `customer.updated`, `customer.deleted`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `price.created`, `price.updated`.

## Priority 3: 30-Day Gap Detection

Stripe Events API only goes back 30 days. If the webhook cursor is stale:

```typescript
const THIRTY_DAYS = 30 * 24 * 60 * 60;
const effectiveStart = Math.max(lastEventCreated, Math.floor(Date.now()/1000) - THIRTY_DAYS);
if (effectiveStart !== lastEventCreated) {
  await fullRefreshSync();  // auto-recover
}
```

**Source**: Airbyte silently floors the cursor. Singer throws an error. Airbyte's approach is better UX.

## Priority 4: On-Demand Backfill for Missing References

When an event references a customer that doesn't exist locally, fetch it:

```typescript
async function backfillMissing(customerIds: string[]) {
  const existing = await db.query(
    'SELECT customer_id FROM customers WHERE customer_id = ANY($1)', [customerIds]
  );
  const missing = customerIds.filter(id => !existing.rows.some(r => r.customer_id === id));
  for (const id of missing) {
    const cust = await stripe.customers.retrieve(id);
    await upsertCustomer(cust);
  }
}
```

**Source**: Supabase stripe-sync-engine `findMissingEntries` pattern.

## Priority 5: Drop Foreign Keys on Stripe Mirror Tables

Webhooks arrive out of order. An invoice webhook may arrive before the customer webhook. FKs break upserts. Handle referential integrity in application code.

**Source**: Supabase migration 0034 dropped all FK constraints for this reason.

## What NOT to Build

- Bidirectional sync (pushing to Stripe) — Observe reads, doesn't own
- Full ETL pipeline (dlt/Airbyte) — overkill for 3 objects
- Dynamic schema generation — unnecessary for customers/subs/prices
- Service-per-event-type pattern (Lago) — too much indirection at our scale

## Research Sources

- **Supabase stripe-sync-engine** (github.com/supabase/stripe-sync-engine, now stripe/sync-engine) — upsert pattern, timestamp protection, backfill missing entities, FK removal
- **Lago** (github.com/getlago/lago-api) — inbound webhook table, clock-driven retry, two-phase persist+process pattern
- **Airbyte source-stripe** — 30-day gap handling, `StateDelegatingStream` (full refresh vs incremental), `updated` cursor instead of `created`
- **Singer/tap-stripe** — date-windowed sync, `updated_by_event_type` audit trail, 10-minute immutable stream lookback
- **dlt** — no Node.js equivalent exists; Python-only ecosystem for Stripe ETL

## Estimate

- P1 (upsert): ~1 day
- P2 (webhooks): ~2 days
- P3 (gap detection): ~2 hours
- P4 (on-demand backfill): ~2 hours
- P5 (drop FKs): ~1 hour, but needs careful testing

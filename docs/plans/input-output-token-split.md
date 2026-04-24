# Plan: Split input/output tokens in the data model

## Why

Input and output tokens have **different prices** on every major provider (GPT-4o: 4×, Claude Sonnet/Opus: 5×). The SDK already sends them as separate fields (`inputTokens`, `outputTokens`), and `calculateCostFromTokens` in `server/model-pricing.ts:715` already prices them correctly. But at ingest time in `server/routes/events-ingest.ts`, we **sum them into one `usage_units` column** and throw the split away.

Consequences:
- Historical cost is only as accurate as the ingest-time calc. We can't recompute it if pricing changes.
- Analytics can't show "your output-heavy workloads cost more" — the signal is gone.
- Users can't optimize what they can't see (prompt engineering for input tokens, conciseness instructions for output tokens).
- Margin numbers are right in the *aggregate*, but you can't audit a single row.

Doug owns the schema. This plan needs his sign-off before migration.

## Scope

**In scope:**
- Persist `input_tokens` and `output_tokens` per event
- Expose them through the events API + UI (tooltip, no extra column)
- Leave the ingest cost calculation alone — it's already correct

**Out of scope:**
- Backfilling historical rows (no way to reconstruct the split — old data stays blended)
- Per-token-type pricing model changes (already done)
- Customer-facing invoicing changes

## Changes

### 1. Schema — `server/index.ts` near the `observe_events` CREATE TABLE block

```sql
ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS input_tokens INT;
ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS output_tokens INT;
```

Nullable, no default. Old rows stay NULL (we don't know the split). New rows populate both. `usage_units` stays — it's the only signal we have for non-LLM events (custom `usageUnits` like messages or API calls).

### 2. Ingest — `server/routes/events-ingest.ts`

- Line ~917: extend the VALUES placeholder set by 2 params
- Line ~928: keep `usage_units` as is (backward-compatible fallback for non-LLM events)
- Add: `evt.inputTokens ?? null`, `evt.outputTokens ?? null`
- Update the `INSERT INTO observe_events (...)` column list at line ~938 to include `input_tokens`, `output_tokens`

### 3. GET events — `server/routes/events-list.ts`

- `coerceEventRow` (or wherever row-shape is normalized) — expose `input_tokens`, `output_tokens` in the response
- `ObserveEvent` type in `src/lib/api/events.ts` — add both fields as `number | null`

### 4. UI — `src/pages/EventsPage.vue`

Keep the existing Usage column unified. Add a `title` tooltip:
- If both present: `"1,500 in / 400 out"`
- If only total: `"1,900 tokens (split unavailable)"`
- If custom units: current behavior, no tooltip

No new column — avoids clutter; power users can see the split in the expanded event detail panel (already exists).

### 5. Detail panel — `EventsPage.vue` expanded row

Add two lines under Usage:
- Input tokens: 1,500
- Output tokens: 400

Only when both are non-null. Keep the total for the blended historical rows.

### 6. Analytics (follow-up, separate PR)

The cost-by-model breakdown and margin calcs read `cost_amount` directly, so they're unaffected. A follow-up could add a "tokens by type" chart for optimization insight — but that's a new feature, not part of the fix.

## Migration safety

- `ADD COLUMN` with a nullable column is non-locking on Postgres 11+. Safe on a live table.
- No writes to these columns from existing clients until the ingest code ships, so there's no read/write ordering issue.
- Deploy order: run migration → deploy ingest change → deploy UI. Postgres tolerates the ingest change arriving first (it'll just populate the new columns on new rows), but cleanest is migration first.

## Test plan

- [ ] Migration runs clean on dev DB and staging
- [ ] SDK event with `inputTokens: 100, outputTokens: 50` → DB row has `input_tokens=100, output_tokens=50, usage_units=150`
- [ ] Non-LLM event (custom `usageUnits: 5`, no tokens) → `input_tokens=NULL, output_tokens=NULL, usage_units=5` (unchanged)
- [ ] Event with only `inputTokens` (embedding calls) → `output_tokens=NULL`
- [ ] Events API returns both new fields; old rows return NULLs
- [ ] UI tooltip shows "1,500 in / 400 out" on new rows, falls back gracefully on NULLs
- [ ] Cost calculation is unchanged (was already correct)

## Open questions for Doug

1. **Migration timing** — run manually via psql, or add to the app-boot `ALTER TABLE IF NOT EXISTS` block in `server/index.ts`? (Codebase pattern is the latter. Recommend same.)
2. **Backfill** — do we try to estimate old rows' split using model-average ratios, or leave NULL? (Recommend NULL. Estimated data lies.)
3. **Indexes** — do we need an index on `input_tokens` / `output_tokens` for analytics queries? (Probably not yet — add when a query needs it.)

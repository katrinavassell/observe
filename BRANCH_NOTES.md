# `hyperagent` branch — Margin Optimization action loop

This branch adds the **action loop** layer on top of the recommendation
engine that already ships in `main` (`server/routes/recommendations.ts`,
`server/digest.ts`, `server/routes/alerts.ts`). It does NOT rebuild any of
that infrastructure; it adds the thin UI + lead-capture surface that turns
recommendations into Tanso Platform conversations.

> **Authored by a Hyperagent session.** The code matches existing
> conventions but **has not been compiled or run** from the authoring
> environment. Review, run `npm run typecheck` and `npm run dev` locally
> before merging. See "Known gaps & risks" at the bottom.

## ⚠  Database migration — apply to staging first

This branch adds one new Postgres table (`tanso_leads`). Apply the
migration to your **Supabase dev/staging** database before merging:

```bash
psql $DEV_DATABASE_URL -f migrations/2026-05-11-tanso-leads.sql
# or use the Supabase SQL Editor against the staging project
```

The endpoint (`POST /api/v1/contact/tanso-implementation`) uses the
standard `pool.query()` pattern, so it picks up whichever `DATABASE_URL`
is configured in the environment. Local dev → staging DB. Vercel staging
deploy → staging DB. Production deploy → production DB.

**Do NOT apply this migration to the production Supabase project until
you've tested it end-to-end against staging.**

## What's in this branch

| File | Purpose |
|---|---|
| `src/lib/api/recommendations.ts` | API client for the existing `GET/POST /v1/recommendations` endpoints. Adds `recommendationCustomerKey()` / `recommendationFeatureKey()` helpers to match recs to table rows. |
| `src/lib/api/tanso-leads.ts` | API client for the new `POST /v1/contact/tanso-implementation` endpoint. |
| `src/lib/api/index.ts` | Adds the two new modules to the public API surface (existing exports unchanged). |
| `src/components/dashboard/MarginRecommendation.vue` | Inline recommendation card. Auto-fetches a matching pending rec by customer key or feature key; or pass an explicit `recommendation` prop. Emits `talk-to-us` upward. |
| `src/components/dashboard/RecommendationActions.vue` | Reusable Apply / Dismiss / Talk-to-us button row. Owns the mutations + cache invalidation. |
| `src/components/dashboard/TansoPlatformContactForm.vue` | Modal dialog rendered when the user clicks "Talk to us about implementing this →". Pre-fills email from Clerk, lets the user add a note, posts to the new endpoint, then redirects to Cal.com for scheduling. |
| `server/routes/tanso-leads.ts` | Backend route. Persists the lead in `tanso_leads`, fires the AE notification email via Resend (reuses the pattern from `alerts.ts`), and fires an optional Slack webhook if `SLACK_WEBHOOK_LEADS_URL` is set. |
| `migrations/2026-05-11-tanso-leads.sql` | The new table + indexes. Apply against staging first. |

## What's NOT in this branch (deliberately deferred)

These items from the v3 build prompt are not in this PR. They each touch
more code than I had confidence to ship without a local test environment:

1. **`NotificationPreferencesPage.vue`** (build prompt D4) — needs the
   exact CRUD shape of `alert_rules` endpoints. Easy to add in a
   follow-up PR once the patterns are confirmed locally.
2. **Activation nurture sequence (Day 1/3/7 emails)** (build prompt D5)
   — needs editing `server/index.ts` (52KB) to register a new daily
   cron, plus a `notification_sent` tracking table. Higher blast radius;
   safer in a separate PR.
3. **Wiring `MarginRecommendation` into the existing pages.** This
   branch adds the components, but does NOT modify
   `src/pages/CustomersPage.vue` or `CustomerDetailPage.vue` to render
   them inline. Recommended one-liner integration is in the Wiring
   section below.
4. **Marketing site updates** — those live in
   `tansohq.com-launch` (different repo). Separate PR.

## Required env vars (already set, just confirming)

| Var | Purpose | Notes |
|---|---|---|
| `RESEND_API_KEY` | AE notification email delivery | Already used by `alerts.ts` — should be present in dev/staging Vercel |
| `RESEND_FROM_EMAIL` | Sender address | Defaults to `alerts@observe.tansohq.com` |
| `TANSO_LEAD_AE_EMAIL` | AE notification destination | Defaults to `kat@tansohq.com` |
| `SLACK_WEBHOOK_LEADS_URL` | (optional) Slack channel for new leads | Skipped if unset — no error |
| `APP_URL` / `VERCEL_URL` | Used in the AE email's "Open Observe" link | Existing infra |
| `DATABASE_URL` | Postgres connection | Existing infra; ensure staging URL is set when testing |

## Wiring it up

The components are ready to drop into the customer table on
`CustomersPage.vue` (and similar elsewhere). Suggested integration:

```vue
<script setup lang="ts">
import { ref } from "vue";
import MarginRecommendation from "@/components/dashboard/MarginRecommendation.vue";
import TansoPlatformContactForm from "@/components/dashboard/TansoPlatformContactForm.vue";
import type { Recommendation } from "@/lib/api/recommendations";

const contactOpen = ref(false);
const contactRec = ref<Recommendation | null>(null);

function openContact(rec: Recommendation) {
  contactRec.value = rec;
  contactOpen.value = true;
}
</script>

<template>
  <!-- ...existing customer table... -->
  <tr v-for="customer in customers" :key="customer.customer_id">
    <!-- existing cells -->
  </tr>
  <!-- After each row, or in an expansion area: -->
  <tr v-for="customer in customers" :key="customer.customer_id + '-rec'">
    <td colspan="N">
      <MarginRecommendation
        :customer-key="customer.customer_id"
        @talk-to-us="openContact"
      />
    </td>
  </tr>

  <TansoPlatformContactForm
    v-model:open="contactOpen"
    :recommendation="contactRec"
  />
</template>
```

The component is a no-op (renders nothing) when there's no pending
recommendation for the customer key, so it's safe to mount everywhere.

## Backend route registration

`server/routes/tanso-leads.ts` exports `createTansoLeadsRoutes(pool)`.
Wire it into the Express app in `server/index.ts` next to the other
v1 route mounts. Approximate insertion (search `recommendations` mount):

```ts
import { createTansoLeadsRoutes } from "./routes/tanso-leads.js";

// ...
app.use("/api/v1", createTansoLeadsRoutes(pool));
// or, matching the existing per-namespace mounts:
app.use("/api/v1/contact", createTansoLeadsRoutes(pool));
```

The exact mount path will depend on which prefix the file uses
internally. The route defines itself as `/contact/tanso-implementation`
relative to the mount point, so:

| Mount path | Resulting URL |
|---|---|
| `app.use("/api/v1", ...)` | `POST /api/v1/contact/tanso-implementation` ✓ matches the client |
| `app.use("/api/v1/contact", ...)` | `POST /api/v1/contact/contact/tanso-implementation` ✗ wrong |

So mount it under `/api/v1` (matching the client expectation in
`src/lib/api/tanso-leads.ts`).

## Known gaps & risks

1. **Untested code.** None of this has been compiled or run from the
   authoring environment. Run `npm run typecheck` and `npm run dev`
   locally as your first step. Likely surface for fixes: type mismatches
   on the `Recommendation` shape if the actual API response differs from
   what was inferred from `server/routes/recommendations.ts`.

2. **Recommendation API shape.** The client assumes responses come back
   in one of: `{ recommendations: [...] }`, `{ data: [...] }`, or a bare
   array. The actual endpoint in main returns whatever
   `createRecommendationsRoutes` returns — if it differs, adjust
   `listRecommendations()` in `src/lib/api/recommendations.ts`.

3. **Auth on the contact form endpoint.** The new route accepts both
   authenticated requests (Clerk + X-Account-Id headers) and anonymous
   submissions (x-visitor-id). Anonymous is intentional — leads from
   guest-preview sessions should still capture. Tighten if not desired.

4. **`@clerk/vue` import in `TansoPlatformContactForm.vue`.** The form
   imports `useUser` from `@clerk/vue` for email pre-fill. Confirm this
   matches what `setupClerk()` in `src/lib/clerk.ts` actually uses. If
   the package is `@clerk/clerk-vue` instead, swap the import.

5. **`radix-vue` Dialog primitives.** The form uses `DialogRoot`,
   `DialogPortal`, etc. from `radix-vue` (already a dep — `confirm-dialog.vue`
   imports from there). Verify the Dialog (non-Alert) primitive is
   available; if not, switch to `AlertDialog` primitives.

6. **Migration not auto-applied.** This branch ships the SQL file but
   does NOT run it. Apply manually against staging first (see top of
   this doc), confirm the table and indexes look right, then we can
   automate the apply path in a follow-up.

7. **No integration into existing pages.** The components exist but
   aren't yet rendered anywhere. See the Wiring section above. The
   one-component integration is intentionally tiny so you can place it
   exactly where it makes sense for your UX.

## Suggested review order

1. Read `BRANCH_NOTES.md` (this file).
2. Read `migrations/2026-05-11-tanso-leads.sql`. Apply to staging.
3. Read `src/lib/api/recommendations.ts` — confirm API contract assumptions
   match the real `server/routes/recommendations.ts` responses.
4. Read `server/routes/tanso-leads.ts` — confirm auth + Resend pattern
   match other routes.
5. Read the three Vue components in order: `RecommendationActions.vue`
   → `MarginRecommendation.vue` → `TansoPlatformContactForm.vue`.
6. Run `npm run typecheck`. Fix any issues.
7. Wire the components into `CustomersPage.vue` per the snippet above.
8. Smoke test end-to-end against staging:
   - Compute recommendations
   - Render a customer page
   - Verify the inline card appears for at least one underwater customer
   - Click "Talk to us about implementing this →"
   - Submit the form, check `tanso_leads` row + AE email
9. Open PR to main, merge after staging looks good.

## What this enables

Once merged + wired up, your **action loop** is complete in v1:

```
Observe surfaces a recommendation
    ↓
Inline MarginRecommendation card shows next to the underwater row
    ↓
User clicks "Talk to us about implementing this →"
    ↓
TansoPlatformContactForm captures the lead with full context
    ↓
AE gets a notification email with the customer, action, and recovery dollars
    ↓
AE books a 20-min call, ships the fix in Tanso Platform
    ↓
User comes back to Observe and clicks "Apply" — recommendation status
moves from `pending` to `applied`, recovery delta shows in the next digest
```

The integration with Tanso Platform itself is still sales-touch in v1
(the contact form → AE call → manual Tanso config). v1.5 will turn that
into one-click apply once the Tanso Platform write-path API stabilizes.

—
Branch authored: 2026-05-11
Author: Hyperagent (Anthropic) on behalf of katrinalaszlo

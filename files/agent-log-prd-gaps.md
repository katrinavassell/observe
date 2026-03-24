# Agent Log: PRD Gap Fixes + Bug Fixes

**Date:** 2026-03-23
**Agent:** Coordinator (Claude Opus 4.6)
**Branch:** claude/fill-prd-gaps

## Changes Made

### PRD Gap 1: Auto-redirect after sample data load
- **File:** `src/pages/DataSourcesPage.vue`
- Added `useRouter` import and `router.push('/')` with 1.5s delay after sample data loads
- User sees the success toast, then gets redirected to the Pricing Analyzer

### PRD Gap 2: Design Partner CTA
- **File:** `src/components/charts/GapCallout.vue`
- Changed "Install Tanso Core" → "Become a Design Partner"
- Updated toast to say "Design Partner Program" with email CTA (kat@tansohq.com)

### PRD Gap 3: Month selector
- **File:** `src/pages/PricingAnalyzerPage.vue`
- Added `selectedMonth` ref and `availableMonths` computed from analysis data
- Added calendar icon + select dropdown in the header
- Selecting a month filters `monthlyMrrData` to show data up to that month

### Bug Fix: Redundant dynamic imports (from browser Claude's bug report)
- **File:** `src/pages/DataSourcesPage.vue`
- `getStripeStatus` and `syncStripeData` were loaded via `await import('@/lib/api')` inside `onMounted` and `handleStripeSync`, even though `@/lib/api` was already statically imported
- Moved both to the static import block, removed dynamic imports
- This fixes a Vue warning about `onMounted` called outside component context

## Bugs Found (from browser Claude, validated)

| # | Severity | File | Issue | Status |
|---|----------|------|-------|--------|
| 1 | High | server (runtime) | 5 routes return 404 — stale server process | **Needs server restart** |
| 2 | ~~High~~ | ~~server/index.ts~~ | ~~await in non-async ensureVisitor~~ | **Already fixed** — `server/routes/auth.ts:22` has `async` |
| 3 | Medium | DataSourcesPage.vue | Redundant dynamic imports | **Fixed in this branch** |
| 4 | Low | useAuth.ts, useDataMode.ts | onMounted in singleton composables | Not fixed — low priority |

## Learnings

- The codebase has migrated from Supabase to Express/Vercel, but `supabase/functions/` still exist. Several agent branches target those stale functions.
- The pricing analyzer redesign branch (`fix-pricing-analyzer-display-88gsa`) targets `PricingPage.vue` which no longer exists on main — the file was renamed to `PricingAnalyzerPage.vue`. The 4-tab design in that branch is good but needs to be rebuilt against the current file.
- Browser Claude found real bugs. The stale server process (Bug 1) is the most impactful — 5 routes silently 404ing means the Analytics page and SDK key management are broken until restart.

# Findings

## Phantom Types
The composable `useSimulation.ts` imports 10 types from `@/types/simulation` that don't exist:
- `SimulationRequest`, `SimulationResult`, `SimulationProgress`, `PricingModelConfig`
- `SimulationSummary`, `MonthlyProjection`, `CustomerMargin`, `ModelCost`
- `PricingRecommendation`, `SimulationAssumptions`

These likely existed in a Supabase edge function (`supabase/functions/run-simulation/types.ts`) that was removed during the Vercel migration. The composable still compiles because the types are inferred from usage, but IDE support is broken.

## Duplicate formatCurrency
`PricingSimulatorPanel.vue` defines its own `formatCurrency()`. `SimulationsPage.vue` defines another. `SimulationResultsView.vue` uses inline `toLocaleString()`. Three different formatting approaches.

## SimulationResultsView Has 4 Copy-Pasted Metric Cards
Lines 186-246: four nearly identical Card components with gradient backgrounds. Only the color, label, value, and icon differ. Perfect candidate for a reusable component.

## Tansoflow Patterns Worth Adopting
1. **Feature enrichment pipeline** — fetch plan, then enrich with features. Graceful degradation if feature fetch fails.
2. **Icon-per-pricing-type** — Check (included), BarChart3 (usage), Layers (graduated tiers). Semantic and scannable.
3. **Tier tooltip** — complex graduated pricing shown in a tooltip table. Clean UX.
4. **Formatting library** — all display logic in one testable file, not scattered across templates.
5. **Sorted features** — usage-based features shown first (the interesting ones), included features last.

## Subscription Flow Audit (vs SaaSSubscriptionSite reference app)

### Fixed
1. **Cancel mode typo** — `IMMEDIATE` → `IMMEDIATELY` (Tanso API expected value)
2. **Double `tansoGetCustomer` call** — upgrade path was fetching customer twice; now reuses first result
3. **Checkout error swallowed** — Stripe checkout failures now return 500 instead of falling through with `success: true`
4. **Missing cancellation APIs** — added `tansoCancelScheduledCancellation` and `tansoCancelScheduledPlanChanges` to tanso-client
5. **Unused import** — removed `formatCurrencyCompact` from SimulationResultsView
6. **Rerun handler crash** — `@rerun` in SimulationModal was bound to `handleRun` (expects config arg); fixed to navigate back to config tab

### Now Complete
All subscription lifecycle routes match the reference app:
- `POST /tanso/cancel` with `cancelMode` (IMMEDIATELY or END_OF_PERIOD), clears scheduled plan changes first
- `POST /tanso/reactivate` to cancel a pending cancellation
- `POST /tanso/cancel-scheduled-changes` to cancel a pending downgrade

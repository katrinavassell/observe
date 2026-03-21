# Progress

## Session: 2026-03-20

### Completed
- [x] Explored tansoflow `feature/pricing-simulator` branch (both repos)
- [x] Read all simulation/pricing components in metrics-onboarding
- [x] Created task plan with 5 phases
- [x] **Phase 1**: Added 10 missing types to `src/types/simulation.ts` (SimulationRequest, SimulationResult, PricingModelConfig, etc.)
- [x] **Phase 2**: Created `src/lib/simulationFormatters.ts` — formatCurrency, formatCurrencyCompact, formatPrice, formatUsagePrice, isSimplePrepaidGraduated, formatTieredSummary, getMarginStatus
- [x] **Phase 3**: Broke up monolithic components:
  - Created `SimulationConfigForm.vue` (~170L) — extracted from SimulationModal
  - Created `SimulationMetricCard.vue` (~45L) — reusable gradient metric card
  - Created `SimulationRecommendations.vue` (~55L) — pricing recommendations card
  - Created `SimulationAssumptions.vue` (~55L) — assumptions card
  - Rewrote `SimulationModal.vue` (467L → 120L) — slim orchestrator
  - Rewrote `SimulationResultsView.vue` (584L → 230L) — composes sub-components
- [x] **Phase 4**: Refactored PricingSimulatorPanel to use shared formatCurrency
- [x] **Phase 5**: Updated barrel exports, verified `vue-tsc --noEmit` and `npm run build` pass clean

### Line Count Comparison
| File | Before | After |
|------|--------|-------|
| SimulationModal.vue | 467 | 120 |
| SimulationResultsView.vue | 584 | 230 |
| SimulationConfigForm.vue | — | 170 |
| SimulationMetricCard.vue | — | 45 |
| SimulationRecommendations.vue | — | 55 |
| SimulationAssumptions.vue | — | 55 |
| simulationFormatters.ts | — | 120 |
| types/simulation.ts | 121 | 205 |
| **Total** | **1,172** | **1,000** |

Net: fewer total lines, but each file is focused and reusable.

## Session: 2026-03-21

### Completed
- [x] QA review of all uncommitted work — found 5 issues
- [x] Fixed `@rerun` handler type mismatch in SimulationModal
- [x] Removed unused `formatCurrencyCompact` import from SimulationResultsView
- [x] Verified `getCustomers` API response shape (`{ data: [...] }`) is correct
- [x] Committed and pushed simulation refactor (`9b8a00a`)
- [x] **Subscription flow audit** against SaaSSubscriptionSite reference app:
  - Fixed cancel mode typo (`IMMEDIATE` → `IMMEDIATELY`) in tanso-client
  - Eliminated double `tansoGetCustomer` call on upgrade path
  - Fixed swallowed Stripe checkout error (now returns 500 to client)
  - Added `apiDelete` helper + `tansoCancelScheduledCancellation` + `tansoCancelScheduledPlanChanges` to tanso-client
  - Added 3 new routes: `POST /tanso/cancel` (with END_OF_PERIOD support), `POST /tanso/reactivate`, `POST /tanso/cancel-scheduled-changes`
  - Cancel route clears scheduled plan changes before cancelling (matches reference app pattern)

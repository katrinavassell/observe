# Component Reference

Vue components and composables in Observe.

## Page Components (`src/pages/`)

### Existing Pages

| Page | Route | Purpose |
|------|-------|---------|
| `PricingAnalyzerPage.vue` | `/` | MRR, margins, plan health, cohorts |
| `DataSourcesPage.vue` | `/data-sources` | CSV upload, Stripe sync, sample data |
| `SimulatorPage.vue` | `/simulator` | Basic pricing simulator (being replaced) |

### New Pages (Observe)

| Page | Route | Purpose |
|------|-------|---------|
| `EventsPage.vue` | `/events` | Filterable event stream |
| `FeaturesPage.vue` | `/features` | Feature list with margin status |
| `FeatureDetailPage.vue` | `/features/:key` | Single feature: timeseries, customers, models |
| `ModelsPage.vue` | `/models` | AI model cost breakdown |
| `CustomersPage.vue` | `/customers` | Customer list with margins |
| `CustomerDetailPage.vue` | `/customers/:id` | Single customer: events, features, timeline |
| `SimulationsPage.vue` | `/simulations` | Simulation list + pricing opportunities |
| `SimulationNewPage.vue` | `/simulations/new` | 3-step wizard: Define → Scenarios → Review |
| `SimulationDetailPage.vue` | `/simulations/:id` | Results, customer impact, rollout |

---

## Chart Components (`src/components/charts/`)

| Component | Props | Purpose |
|-----------|-------|---------|
| `MrrChart.vue` | `data: MrrDataPoint[]` | MRR over time |
| `MRRTrendChart.vue` | `historical, forecast` | MRR trend with projections |
| `CohortChart.vue` | `cohorts: CohortData[]` | Cohort retention curves |
| `CostBreakdownChart.vue` | `costs, groupBy` | Cost distribution |
| `RevenueFlowChart.vue` | `data` | Revenue flow waterfall |
| `MarginCompressionAlert.vue` | `compression, threshold` | Margin health warning |
| `GapCallout.vue` | `gaps, onResolve` | Data gap notifications |

---

## Data Source Components (`src/components/data-sources/`)

| Component | Purpose |
|-----------|---------|
| `RevenueSection.vue` | Stripe sync + revenue CSV upload |
| `CostsSection.vue` | Cost CSV upload |
| `UsageSection.vue` | Usage CSV upload |
| `ComingSoonSection.vue` | Future integrations placeholder |
| `StripeConnectModal.vue` | Stripe connection dialog |
| `StripeSyncProgress.vue` | Sync progress display |

---

## Simulation Components (New — `src/components/simulations/`)

Ported from tansoflow. All Vue 3 + shadcn-vue.

| Component | Purpose |
|-----------|---------|
| `SimulationCard.vue` | Simulation list item with status badge |
| `OpportunityCard.vue` | Pricing opportunity with severity + suggested action |
| `CustomerCard.vue` | Customer impact row with churn risk |
| `MarginBadge.vue` | Color-coded margin status badge |
| `TrendIndicator.vue` | Up/down/stable trend arrow |
| `MiniSparkline.vue` | Small inline chart for trends |

---

## Pricing Components (`src/components/pricing/`)

| Component | Purpose |
|-----------|---------|
| `MarginOverviewCard.vue` | Margin summary with chart |
| `PricingSimulatorPanel.vue` | Inline simulator widget |
| `RevenueFlowChart.vue` | Revenue flow visualization |

---

## UI Components (`src/components/ui/`)

Reusable primitives built on Radix Vue (shadcn-vue):

| Component | Variants |
|-----------|----------|
| `Button` | default, secondary, outline, ghost, destructive |
| `Card` | CardHeader, CardTitle, CardDescription, CardContent |
| `Badge` | default, secondary, outline, destructive |
| `Input` | Standard text input |
| `Alert` | Info/warning/error display |
| `Progress` | Progress bar with percentage |
| `Skeleton` | Loading placeholder |
| `Tabs` | Tabs, TabsList, TabsTrigger, TabsContent |
| `Tooltip` | Hover information |
| `Separator` | Visual divider |
| `FileDropzone` | Drag-and-drop file upload |
| `DataSourceBadge` | Data source status indicator |
| `ConfirmDialog` | Confirmation modal |

---

## Composables (`src/composables/`)

### useAuth

Session management (anonymous visitors).

```typescript
const { visitorId, isInitialized } = useAuth()
```

Calls `/api/session/init` on mount to get/create a visitor session.

### useDataMode

Data mode tracking.

```typescript
const { dataMode, hasData, hasRevenue, hasCosts, hasUsage, refetch } = useDataMode()
```

Polls `/api/data/status` to track what data is loaded.

### useStripeConnection

Stripe connection and sync.

```typescript
const { stripeStatus, isSyncing, checkStatus, syncData } = useStripeConnection()
```

Uses `/api/stripe/status` and `/api/stripe/sync`.

### useSimulation (Legacy)

Basic pricing simulation via server-side calculation.

```typescript
const { isRunning, results, runSimulation } = useSimulation()
```

Being replaced by `useSimulationState`.

### useSimulationState (New)

Full simulation engine ported from tansoflow. Manages segments, scenarios, customer impact, feature analysis, rollout workflow.

```typescript
const {
  simulations,
  pricingOpportunities,
  selectedSimulation,
  createSimulation,
  runSimulation,
  rolloutScenario,
} = useSimulationState()
```

---

## Patterns

### Data Fetching

Use TanStack Vue Query for all server data:

```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['events', 'by-feature'],
  queryFn: () => getEventsByFeature(),
})
```

### Singleton State

Composables use module-level refs for shared state across components:

```typescript
const sharedState = ref<Data | null>(null)

export function useMyComposable() {
  return { data: sharedState }
}
```

### Margin Status

Use consistent status categorization everywhere:

```typescript
function getMarginStatus(marginPct: number): 'negative' | 'low' | 'profitable' | 'high' {
  if (marginPct < 0) return 'negative'
  if (marginPct < 20) return 'low'
  if (marginPct < 50) return 'profitable'
  return 'high'
}
```

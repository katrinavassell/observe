# Component Reference

This document describes the Vue components and composables in the Tanso metrics dashboard.

## Page Components

Located in `src/pages/`

### LoginPage.vue

Authentication entry point with magic link login.

**Features:**
- Email input with validation
- Magic link request via Supabase Auth
- Error handling for invalid emails
- Redirect to dashboard on success

### PricingPage.vue

Main analytics dashboard displaying all key metrics.

**Features:**
- MRR/ARR summary cards
- MRR movement breakdown (New, Expansion, Contraction, Churn)
- Plan health scores (0-100)
- Negative margin customer detection
- Margin compression alerts
- Cohort analysis chart
- Pricing scenario simulator

**Props:** None (uses composables for state)

### DataSourcesPage.vue

Data import interface with multiple source options.

**Features:**
- Revenue section (Stripe CSV or API)
- Costs section (CSV upload)
- Usage section (CSV upload)
- Sample data loader
- Progress tracking footer
- Stripe connection modal

**Sections:**
- `RevenueSection` - Stripe integration
- `CostsSection` - Cost data upload
- `UsageSection` - Usage metrics upload
- `ComingSoonSection` - Future integrations

### OnboardingScreen.vue

Initial user setup flow shown when no data is loaded.

**Features:**
- Welcome message
- Data source selection
- Sample data option
- Navigation to DataSourcesPage

---

## Chart Components

Located in `src/components/charts/`

### MrrChart.vue

Monthly Recurring Revenue visualization.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `data` | `MrrDataPoint[]` | Array of { month, mrr } objects |
| `height` | `number` | Chart height in pixels |

### MRRTrendChart.vue

MRR trend over time with optional forecast line.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `historical` | `TrendPoint[]` | Historical MRR data |
| `forecast` | `TrendPoint[]` | Projected MRR data |

### CohortChart.vue

Customer cohort retention curves.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `cohorts` | `CohortData[]` | Cohort retention data |

### CostBreakdownChart.vue

Cost distribution by type or customer.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `costs` | `CostRecord[]` | Cost records to visualize |
| `groupBy` | `'type' \| 'customer'` | Grouping mode |

### MarginCompressionAlert.vue

Warning display for margin health issues.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `compression` | `MarginCompression` | Compression analysis result |
| `threshold` | `number` | Alert threshold percentage |

### GapCallout.vue

Data gap notifications (missing periods, orphaned records).

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `gaps` | `DataGap[]` | Detected data gaps |
| `onResolve` | `() => void` | Resolution callback |

---

## Data Source Components

Located in `src/components/data-sources/`

### RevenueSection.vue

Stripe CSV upload and API connection interface.

**Features:**
- File dropzone for CSV upload
- Stripe API connection button
- Data reconciliation display
- MRR summary after import

**Emits:**

| Event | Payload | Description |
|-------|---------|-------------|
| `data-imported` | `ImportResult` | After successful import |
| `connect-stripe` | - | Open Stripe modal |

### CostsSection.vue

Cost data CSV upload and management.

**Features:**
- CSV file upload
- Cost type mapping
- Period selection
- Preview before import

**Expected CSV Format:**
```
customer_id,cost_type,amount,period_start,period_end
cus_123,api_costs,150.00,2024-01-01,2024-01-31
```

### UsageSection.vue

Usage metrics CSV upload.

**Features:**
- CSV file upload
- Metric key mapping
- Usage limit setting
- Aggregation options

**Expected CSV Format:**
```
customer_id,metric_key,metric_value,period_start,period_end
cus_123,api_calls,15000,2024-01-01,2024-01-31
```

### StripeConnectModal.vue

Modal for Stripe API key connection.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `open` | `boolean` | Modal visibility |

**Emits:**

| Event | Payload | Description |
|-------|---------|-------------|
| `update:open` | `boolean` | Close modal |
| `connected` | `string` | Account name on success |
| `start-sync` | - | Begin data sync |

**Features:**
- API key input with show/hide toggle
- Test/Live mode detection
- Key validation via Edge Function
- Connection status display

### StripeSyncProgress.vue

Real-time sync progress tracking.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `syncState` | `SyncState` | Current sync status |

**Emits:**

| Event | Payload | Description |
|-------|---------|-------------|
| `cancel` | - | Cancel sync |
| `retry` | - | Retry failed sync |
| `close` | - | Close progress view |

**Displays:**
- Overall progress bar
- Per-type progress (customers, subscriptions, invoices, usage)
- Error messages
- Duration tracking

---

## Simulation Components

Located in `src/components/simulation/`

### SimulationModal.vue

Pricing scenario configuration and execution.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `open` | `boolean` | Modal visibility |

**Emits:**

| Event | Payload | Description |
|-------|---------|-------------|
| `update:open` | `boolean` | Close modal |
| `simulation-complete` | `SimulationResult` | Results ready |

**Features:**
- Pricing model selection
- Parameter adjustment
- Growth rate slider
- Run simulation button

### SimulationResultsView.vue

Simulation results display.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `results` | `SimulationResult` | Simulation output |

**Displays:**
- Revenue/cost/margin summary
- Monthly projections chart
- Customer breakdown table
- Plan comparison

---

## UI Components

Located in `src/components/ui/`

Reusable UI primitives built on Radix Vue.

| Component | Description |
|-----------|-------------|
| `Button` | Primary, secondary, outline, ghost variants |
| `Card` | Container with header, content, footer slots |
| `Input` | Text input with validation states |
| `Badge` | Status indicators and labels |
| `Alert` | Info, warning, error, success messages |
| `Progress` | Progress bar with percentage |
| `Skeleton` | Loading placeholder |
| `Tabs` | Tabbed content navigation |
| `Tooltip` | Hover information tooltips |
| `FileDropzone` | Drag-and-drop file upload |
| `DataSourceBadge` | Data source status indicator |

### Button

```vue
<Button variant="default" size="md" :disabled="false">
  Click me
</Button>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'secondary' \| 'outline' \| 'ghost' \| 'destructive'` | `'default'` | Visual style |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Button size |
| `disabled` | `boolean` | `false` | Disabled state |

### Card

```vue
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent>
    Content here
  </CardContent>
  <CardFooter>
    <Button>Action</Button>
  </CardFooter>
</Card>
```

### Progress

```vue
<Progress :value="75" :indicator-class="'bg-green-500'" />
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `value` | `number` | Progress percentage (0-100) |
| `indicator-class` | `string` | Custom indicator color class |

---

## Composables

Located in `src/composables/`

### useAuth

Authentication and session management.

```typescript
const { user, isAuthenticated, signIn, signOut } = useAuth()
```

**Returns:**

| Property | Type | Description |
|----------|------|-------------|
| `user` | `Ref<User \| null>` | Current user |
| `isAuthenticated` | `ComputedRef<boolean>` | Auth status |
| `signIn` | `(email: string) => Promise<void>` | Send magic link |
| `signOut` | `() => Promise<void>` | End session |

### useDataMode

Data mode state management.

```typescript
const { dataMode, hasData, refetch } = useDataMode()
```

**Returns:**

| Property | Type | Description |
|----------|------|-------------|
| `dataMode` | `Ref<'none' \| 'sample' \| 'user'>` | Current mode |
| `hasData` | `ComputedRef<boolean>` | Has any data |
| `refetch` | `() => Promise<void>` | Refresh status |

### useStripeConnection

Stripe API key management and data sync.

```typescript
const {
  isValidating,
  validation,
  isSyncing,
  syncState,
  validateApiKey,
  startSync,
  disconnect
} = useStripeConnection()
```

**Returns:**

| Property | Type | Description |
|----------|------|-------------|
| `isValidating` | `Ref<boolean>` | Validation in progress |
| `validation` | `Ref<StripeKeyValidation \| null>` | Validation result |
| `isSyncing` | `Ref<boolean>` | Sync in progress |
| `syncState` | `Ref<SyncState>` | Detailed sync status |
| `validateApiKey` | `(key: string) => Promise<StripeKeyValidation>` | Validate key |
| `startSync` | `(key?: string) => Promise<boolean>` | Start data sync |
| `disconnect` | `() => void` | Clear connection |

### useSimulation

Pricing simulation execution.

```typescript
const {
  isRunning,
  results,
  error,
  runSimulation,
  saveScenario
} = useSimulation()
```

**Returns:**

| Property | Type | Description |
|----------|------|-------------|
| `isRunning` | `Ref<boolean>` | Simulation in progress |
| `results` | `Ref<SimulationResult \| null>` | Latest results |
| `error` | `Ref<string \| null>` | Error message |
| `runSimulation` | `(model: PricingModel) => Promise<void>` | Execute simulation |
| `saveScenario` | `(name: string) => Promise<void>` | Save to database |

### useOnline

Network connectivity detection.

```typescript
const { isOnline } = useOnline()
```

**Returns:**

| Property | Type | Description |
|----------|------|-------------|
| `isOnline` | `Ref<boolean>` | Online status |

---

## Component Patterns

### Singleton State

Composables like `useStripeConnection` use module-level refs for shared state:

```typescript
// State is shared across all component instances
const isValidating = ref(false)
const validation = ref<StripeKeyValidation | null>(null)

export function useStripeConnection() {
  // Return refs, not new instances
  return { isValidating, validation, ... }
}
```

### Readonly Exports

State is exposed as readonly to prevent external mutation:

```typescript
return {
  validation: readonly(validation),
  // Actions can still mutate internally
  validateApiKey,
}
```

### Error Boundaries

Components handle errors gracefully with fallback UI:

```vue
<template>
  <Alert v-if="error" variant="destructive">
    {{ error.message }}
  </Alert>
  <div v-else>
    <!-- Normal content -->
  </div>
</template>
```

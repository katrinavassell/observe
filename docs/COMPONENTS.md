# Component Reference

Vue components and composables in Observe.

## Page Components (`src/pages/`)

| Page | Route | Purpose |
|------|-------|---------|
| `AnalyticsPage.vue` | `/` | Home page: revenue, costs, margin overview |
| `EventsPage.vue` | `/events` | Filterable event stream |
| `ModelsPage.vue` | `/models` | AI model cost breakdown |
| `AlertsPage.vue` | `/alerts` | Threshold-based cost alert rules |
| `DataSourcesPage.vue` | `/data-sources` | CSV upload, integrations, sample data |
| `PlansPage.vue` | `/plans` | Subscription plans and billing management |
| `CheckoutSuccessPage.vue` | `/checkout/success` | Post-checkout confirmation |
| `CohortsPage.vue` | `/cohorts` | Cohort retention analysis |
| `TracesPage.vue` | `/traces` | Distributed trace viewer |
| `LoginPage.vue` | `/login`, `/signup` | Authentication (login and signup) |
| `ForgotPasswordPage.vue` | `/forgot-password` | Request password reset |
| `ResetPasswordPage.vue` | `/reset-password` | Reset password with token |
| `OnboardingPage.vue` | `/onboarding` (redirects to `/data-sources`) | First-run onboarding flow |
| `TeamSettingsPage.vue` | `/team` | Team management and member invites |
| `JoinTeamPage.vue` | `/join/:token` | Accept a team invite link |
| `AdminPage.vue` | `/admin` | Admin dashboard: user stats, usage, emails (tansohq.com only) |

---

## Chart Components (`src/components/charts/`)

| Component | Props | Purpose |
|-----------|-------|---------|
| `MrrChart.vue` | `data: MrrDataPoint[]` | MRR over time |
| `MRRTrendChart.vue` | `historical, forecast` | MRR trend with projections |
| `CohortChart.vue` | `cohorts: CohortData[]` | Cohort retention curves |
| `CostBreakdownChart.vue` | `costs, groupBy` | Cost distribution |
| `MarginCompressionAlert.vue` | `compression, threshold` | Margin health warning |
| `GapCallout.vue` | `gaps, onResolve` | Data gap notifications |

---

## Dashboard Components (`src/components/dashboard/`)

| Component | Purpose |
|-----------|---------|
| `MetricCard.vue` | Key metric display with trend |
| `AlertCard.vue` | Alert summary card |
| `MrrMonthlyBreakdown.vue` | Month-by-month MRR breakdown |
| `QuickActions.vue` | Shortcut buttons for common actions |

---

## Data Source Components (`src/components/data-sources/`)

| Component | Purpose |
|-----------|---------|
| `CostsSection.vue` | Cost CSV upload |
| `UsageSection.vue` | Usage CSV upload |
| `ComingSoonSection.vue` | Future integrations placeholder |

---

## Integration Components (`src/components/integrations/`)

| Component | Purpose |
|-----------|---------|
| `IntegrationCard.vue` | Integration status card (connected/available) |
| `OpenAIApiKeyModal.vue` | Connect OpenAI API key |
| `AnthropicApiKeyModal.vue` | Connect Anthropic API key |
| `StripeApiKeyModal.vue` | Connect Stripe API key |
| `IntegrationRequestModal.vue` | Request a new integration |
| `InterestCaptureModal.vue` | Capture interest for upcoming features |

---

## Onboarding Components (`src/components/onboarding/`)

| Component | Purpose |
|-----------|---------|
| `UploadWizard.vue` | Step-by-step data upload flow |
| `ColumnMapper.vue` | Map CSV columns to Observe schema |
| `ImportGuide.vue` | Import instructions and tips |
| `OnboardingChecklist.vue` | First-run onboarding checklist |

---

## Pricing Components (`src/components/pricing/`)

| Component | Purpose |
|-----------|---------|
| `MarginOverviewCard.vue` | Margin summary with chart |

---

## Account Components (`src/components/accounts/`)

| Component | Purpose |
|-----------|---------|
| `AccountDetailPanel.vue` | Account settings and profile |

---

## Shared Components (`src/components/shared/`)

| Component | Purpose |
|-----------|---------|
| `ErrorBoundary.vue` | Catch and display component errors |
| `FeedbackModal.vue` | User feedback submission modal |
| `MarginBadge.vue` | Color-coded margin status badge |
| `SourceBadge.vue` | Data source indicator (CSV, SDK, proxy, etc.) |
| `TrendIndicator.vue` | Up/down/stable trend arrow |
| `UsageLimitBanner.vue` | Plan usage limit warning |

---

## UI Components (`src/components/ui/`)

Reusable primitives built on Radix Vue (shadcn-vue):

| Component | Variants |
|-----------|----------|
| `Button` | default, secondary, outline, ghost, destructive |
| `Card` | CardHeader, CardTitle, CardDescription, CardContent |
| `Badge` | default, secondary, outline, destructive |
| `Input` | Standard text input |
| `Label` | Form label |
| `Select` | Dropdown select |
| `Alert` | Info/warning/error display |
| `Progress` | Progress bar with percentage |
| `Skeleton` | Loading placeholder |
| `Tabs` | Tabs, TabsList, TabsTrigger, TabsContent |
| `Tooltip` | Hover information |
| `Separator` | Visual divider |
| `Sheet` | Slide-out panel |
| `Table` | Table, TableHeader, TableBody |
| `DataSourceBadge` | Data source indicator in table rows |
| `FileDropzone` | Drag-and-drop file upload |
| `ConfirmDialog` | Confirmation modal |

---

## Composables (`src/composables/`)

### useAuth

Account-based authentication.

```typescript
const { account, isLoggedIn, isInitialized, login, signup, logout } = useAuth()
```

Handles signup, login, logout, and session persistence.

### useDataMode

Data mode tracking.

```typescript
const { dataMode, hasData, hasRevenue, hasCosts, hasUsage, refetch } = useDataMode()
```

Polls `/data/status` to track what data is loaded.

### useOnline

Network connectivity detection.

```typescript
const { isOnline } = useOnline()
```

### useTeam

Team management.

```typescript
const { myRole, isViewer, fetchTeamInfo } = useTeam()
```

Fetches team info, determines current user's role (admin/viewer).

---

## Patterns

### Data Fetching

Use TanStack Vue Query for all server data:

```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['events'],
  queryFn: () => api.getEvents(),
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

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import {
  getMetricsSummary,
  getEventsByFeature,
  getEventsByModel,
  getEventsByCustomer,
  getCustomerDetail,
} from '@/lib/api'
import type { CustomerDetail } from '@/lib/api'
import { AlertCircle, ChevronDown } from 'lucide-vue-next'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Skeleton,
} from '@/components/ui'

const router = useRouter()
const queryClient = useQueryClient()

// ---------------------------------------------------------------------------
// Data fetching — all 4 queries in parallel
// ---------------------------------------------------------------------------
const {
  data: summary,
  isLoading: summaryLoading,
  isError: summaryError,
} = useQuery({
  queryKey: ['metrics-summary'],
  queryFn: getMetricsSummary,
})

const {
  data: featureData,
  isLoading: featuresLoading,
  isError: featuresError,
} = useQuery({
  queryKey: ['events-by-feature'],
  queryFn: getEventsByFeature,
})

const {
  data: modelData,
  isLoading: modelsLoading,
  isError: modelsError,
} = useQuery({
  queryKey: ['events-by-model'],
  queryFn: getEventsByModel,
})

const {
  data: customerData,
  isLoading: customersLoading,
  isError: customersError,
} = useQuery({
  queryKey: ['events-by-customer'],
  queryFn: getEventsByCustomer,
})

const isLoading = computed(
  () => summaryLoading.value || featuresLoading.value || modelsLoading.value || customersLoading.value,
)
const isError = computed(
  () => summaryError.value || featuresError.value || modelsError.value || customersError.value,
)
const hasData = computed(
  () =>
    !isLoading.value &&
    !isError.value &&
    (summary.value || featureData.value?.length || customerData.value?.length),
)

// ---------------------------------------------------------------------------
// Summary computations
// ---------------------------------------------------------------------------
const totalCosts = computed(() => {
  if (!featureData.value) return 0
  return featureData.value.reduce((s, f) => s + f.total_cost, 0)
})

const avgMargin = computed(() => {
  if (!featureData.value) return null
  const totalRevenue = featureData.value.reduce((s, f) => s + f.total_revenue, 0)
  const totalCost = featureData.value.reduce((s, f) => s + f.total_cost, 0)
  if (totalRevenue === 0) return null
  return ((totalRevenue - totalCost) / totalRevenue) * 100
})

// ---------------------------------------------------------------------------
// Features — sorted by revenue descending
// ---------------------------------------------------------------------------
const sortedFeatures = computed(() => {
  if (!featureData.value) return []
  return [...featureData.value].sort((a, b) => b.total_revenue - a.total_revenue)
})

const maxFeatureRevenue = computed(() => {
  if (!sortedFeatures.value.length) return 1
  return Math.max(...sortedFeatures.value.map((f) => f.total_revenue), 0.01)
})

// ---------------------------------------------------------------------------
// Models — sorted by cost descending, filtered to cost > 0
// ---------------------------------------------------------------------------
const sortedModels = computed(() => {
  if (!modelData.value) return []
  return [...modelData.value].filter((m) => m.total_cost > 0).sort((a, b) => b.total_cost - a.total_cost)
})

const maxModelCost = computed(() => {
  if (!sortedModels.value.length) return 1
  return Math.max(...sortedModels.value.map((m) => m.total_cost), 0.01)
})

// ---------------------------------------------------------------------------
// Customers — sorting & pagination
// ---------------------------------------------------------------------------
type SortOption = 'margin-asc' | 'margin-desc' | 'revenue-desc' | 'cost-desc'
const customerSort = ref<SortOption>('margin-asc')
const customerPage = ref(1)
const pageSize = 10

const sortedCustomers = computed(() => {
  if (!customerData.value) return []
  const list = [...customerData.value]
  switch (customerSort.value) {
    case 'margin-asc':
      return list.sort((a, b) => (a.margin_pct ?? -Infinity) - (b.margin_pct ?? -Infinity))
    case 'margin-desc':
      return list.sort((a, b) => (b.margin_pct ?? -Infinity) - (a.margin_pct ?? -Infinity))
    case 'revenue-desc':
      return list.sort((a, b) => b.total_revenue - a.total_revenue)
    case 'cost-desc':
      return list.sort((a, b) => b.total_cost - a.total_cost)
    default:
      return list
  }
})

const paginatedCustomers = computed(() => {
  const start = (customerPage.value - 1) * pageSize
  return sortedCustomers.value.slice(start, start + pageSize)
})

const totalCustomerCount = computed(() => sortedCustomers.value.length)
const showFrom = computed(() => (customerPage.value - 1) * pageSize + 1)
const showTo = computed(() => Math.min(customerPage.value * pageSize, totalCustomerCount.value))
const canPrev = computed(() => customerPage.value > 1)
const canNext = computed(() => customerPage.value * pageSize < totalCustomerCount.value)

function prevPage() {
  if (canPrev.value) customerPage.value--
}
function nextPage() {
  if (canNext.value) customerPage.value++
}

// ---------------------------------------------------------------------------
// Customer expand / collapse
// ---------------------------------------------------------------------------
const expandedIds = reactive(new Set<string>())
const customerDetails = reactive<Record<string, CustomerDetail>>({})
const customerDetailsLoading = reactive(new Set<string>())

async function toggleCustomer(id: string) {
  if (expandedIds.has(id)) {
    expandedIds.delete(id)
    return
  }
  expandedIds.add(id)
  if (!customerDetails[id] && !customerDetailsLoading.has(id)) {
    customerDetailsLoading.add(id)
    try {
      customerDetails[id] = await getCustomerDetail(id)
    } catch {
      // silently fail
    } finally {
      customerDetailsLoading.delete(id)
    }
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function fmt(val: number): string {
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`
  if (val >= 1) return `$${val.toFixed(2)}`
  return `$${val.toFixed(4)}`
}

function fmtPct(val: number | null): string {
  if (val === null || val === undefined) return '\u2014'
  return `${val.toFixed(0)}%`
}

function computeMargin(revenue: number, cost: number): number | null {
  if (revenue === 0) return null
  return ((revenue - cost) / revenue) * 100
}

function retry() {
  queryClient.invalidateQueries({ queryKey: ['metrics-summary'] })
  queryClient.invalidateQueries({ queryKey: ['events-by-feature'] })
  queryClient.invalidateQueries({ queryKey: ['events-by-model'] })
  queryClient.invalidateQueries({ queryKey: ['events-by-customer'] })
}
</script>

<template>
  <div>
    <!-- Page header -->
    <div class="mb-8">
      <h1 class="text-2xl font-semibold tracking-tight">Analytics</h1>
      <p class="text-muted-foreground mt-1">Overview of revenue and margins</p>
    </div>

    <!-- Error state -->
    <div v-if="isError && !isLoading" class="flex flex-col items-center justify-center py-24 text-center">
      <AlertCircle class="h-10 w-10 text-muted-foreground mb-4" />
      <p class="text-muted-foreground mb-4">Failed to load analytics data.</p>
      <button
        class="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="retry"
      >
        Try Again
      </button>
    </div>

    <!-- Loading state -->
    <div v-else-if="isLoading">
      <!-- Skeleton summary cards -->
      <div class="grid grid-cols-4 gap-4 mb-8">
        <Card v-for="i in 4" :key="i" class="p-6">
          <Skeleton class="h-4 w-24 mb-2" />
          <Skeleton class="h-8 w-20" />
        </Card>
      </div>
      <!-- Skeleton customer list -->
      <Card>
        <CardHeader>
          <Skeleton class="h-5 w-32" />
        </CardHeader>
        <CardContent class="space-y-3">
          <Skeleton v-for="i in 5" :key="i" class="h-12 w-full" />
        </CardContent>
      </Card>
    </div>

    <!-- Data loaded -->
    <template v-else>
      <!-- 1. Summary cards -->
      <div class="grid grid-cols-4 gap-4 mb-8">
        <Card class="p-6">
          <div class="text-sm font-medium text-muted-foreground">Total MRR</div>
          <div v-if="summary?.mrr != null" class="text-3xl font-semibold tabular-nums mt-1">
            {{ fmt(summary.mrr) }}
          </div>
          <div v-else class="text-3xl font-normal text-muted-foreground mt-1">&mdash;</div>
        </Card>

        <Card class="p-6">
          <div class="text-sm font-medium text-muted-foreground">Total Costs (30d)</div>
          <div v-if="totalCosts > 0" class="text-3xl font-semibold tabular-nums mt-1">
            {{ fmt(totalCosts) }}
          </div>
          <div v-else class="text-3xl font-normal text-muted-foreground mt-1">&mdash;</div>
        </Card>

        <Card class="p-6">
          <div class="text-sm font-medium text-muted-foreground">Avg Margin</div>
          <div v-if="avgMargin != null" class="text-3xl font-semibold tabular-nums mt-1">
            {{ fmtPct(avgMargin) }}
          </div>
          <div v-else class="text-3xl font-normal text-muted-foreground mt-1">&mdash;</div>
        </Card>

        <Card class="p-6">
          <div class="text-sm font-medium text-muted-foreground">Customers</div>
          <div v-if="summary?.total_customers != null" class="text-3xl font-semibold tabular-nums mt-1">
            {{ summary.total_customers }}
          </div>
          <div v-else class="text-3xl font-normal text-muted-foreground mt-1">&mdash;</div>
        </Card>
      </div>

      <!-- Empty state -->
      <div
        v-if="!hasData || (!featureData?.length && !customerData?.length)"
        class="text-center py-16 text-muted-foreground"
      >
        Load sample data or import your own to see analytics here.
      </div>

      <template v-else>
        <!-- 2. Revenue by Feature -->
        <Card v-if="sortedFeatures.length > 1" class="mb-6">
          <CardHeader>
            <CardTitle class="text-base">Revenue by Feature</CardTitle>
          </CardHeader>
          <CardContent class="space-y-1">
            <div
              v-for="feature in sortedFeatures"
              :key="feature.feature_key"
              class="flex items-center gap-3 hover:bg-muted/50 transition-colors rounded-md px-1 py-1 -mx-1 cursor-pointer"
              @click="router.push(`/features/${feature.feature_key}`)"
            >
              <span class="w-28 text-sm font-medium truncate">{{ feature.feature_key }}</span>
              <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full bg-foreground rounded-full"
                  :style="{ width: `${(feature.total_revenue / maxFeatureRevenue) * 100}%` }"
                />
              </div>
              <span class="w-32 text-right text-sm font-semibold tabular-nums">{{ fmt(feature.total_revenue) }}</span>
            </div>
          </CardContent>
        </Card>

        <!-- 3. Cost by Model -->
        <Card v-if="sortedModels.length" class="mb-6">
          <CardHeader>
            <CardTitle class="text-base">Cost by Model</CardTitle>
          </CardHeader>
          <CardContent class="space-y-1">
            <div
              v-for="model in sortedModels"
              :key="model.model"
              class="flex items-center gap-3 hover:bg-muted/50 transition-colors rounded-md px-1 py-1 -mx-1"
            >
              <div class="w-32 min-w-0">
                <div class="text-sm font-medium truncate">{{ model.model }}</div>
                <div class="text-xs text-muted-foreground">{{ model.model_provider }}</div>
              </div>
              <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full bg-foreground rounded-full"
                  :style="{ width: `${(model.total_cost / maxModelCost) * 100}%` }"
                />
              </div>
              <div class="flex items-center gap-4">
                <span class="text-sm tabular-nums">
                  {{ fmt(model.total_cost) }}
                  <span class="text-muted-foreground"> cost</span>
                </span>
                <span class="text-sm tabular-nums">
                  {{ fmt(model.total_revenue) }}
                  <span class="text-muted-foreground"> rev</span>
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- 4. Customers -->
        <Card v-if="customerData?.length">
          <CardHeader class="flex flex-row items-center justify-between">
            <CardTitle class="text-base">Customers</CardTitle>
            <select
              v-model="customerSort"
              class="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="margin-asc">Margin (low→high)</option>
              <option value="margin-desc">Margin (high→low)</option>
              <option value="revenue-desc">Revenue (high→low)</option>
              <option value="cost-desc">Cost (high→low)</option>
            </select>
          </CardHeader>
          <CardContent>
            <div class="space-y-1">
              <div
                v-for="c in paginatedCustomers"
                :key="c.customer_id"
              >
                <!-- Customer row -->
                <div
                  class="flex items-center justify-between hover:bg-muted/50 transition-colors rounded-md px-3 py-3 -mx-1 cursor-pointer"
                  @click="toggleCustomer(c.customer_id)"
                >
                  <div class="min-w-0">
                    <div class="font-medium">{{ c.customer_name }}</div>
                    <div class="text-sm text-muted-foreground">{{ c.customer_id }}</div>
                  </div>
                  <div class="flex items-center gap-6">
                    <div class="text-right">
                      <div class="font-semibold tabular-nums">{{ fmt(c.total_revenue) }}</div>
                      <div class="text-xs text-muted-foreground">Revenue</div>
                    </div>
                    <div class="text-right">
                      <div class="font-semibold tabular-nums">{{ fmt(c.total_cost) }}</div>
                      <div class="text-xs text-muted-foreground">Cost</div>
                    </div>
                    <div class="text-right">
                      <div class="font-semibold tabular-nums">{{ fmtPct(c.margin_pct) }}</div>
                      <div class="text-xs text-muted-foreground">Margin</div>
                    </div>
                    <ChevronDown
                      :class="[
                        'h-4 w-4 text-muted-foreground transition-transform',
                        expandedIds.has(c.customer_id) ? 'rotate-180' : '',
                      ]"
                    />
                  </div>
                </div>

                <!-- Expanded detail -->
                <div
                  v-if="expandedIds.has(c.customer_id)"
                  class="border-l pl-3 ml-4 mb-2 mt-1"
                >
                  <div v-if="customerDetailsLoading.has(c.customer_id)" class="py-3">
                    <Skeleton class="h-4 w-48 mb-2" />
                    <Skeleton class="h-4 w-36" />
                  </div>
                  <template v-else-if="customerDetails[c.customer_id]">
                    <div
                      v-for="feat in customerDetails[c.customer_id].by_feature"
                      :key="feat.feature_key"
                      class="flex items-center py-1.5 text-sm"
                    >
                      <span class="flex-1 font-medium">{{ feat.feature_key }}</span>
                      <span class="w-20 text-right tabular-nums">{{ fmt(feat.total_revenue) }}</span>
                      <span class="w-20 text-right tabular-nums text-muted-foreground">{{ fmt(feat.total_cost) }}</span>
                      <span class="w-16 text-right tabular-nums text-muted-foreground">{{ fmtPct(computeMargin(feat.total_revenue, feat.total_cost)) }}</span>
                    </div>
                    <div class="pt-2">
                      <button
                        class="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        @click.stop="router.push(`/customers/${c.customer_id}`)"
                      >
                        View customer &rarr;
                      </button>
                    </div>
                  </template>
                </div>
              </div>
            </div>

            <!-- Pagination -->
            <div v-if="totalCustomerCount > pageSize" class="flex items-center justify-between mt-4 pt-4 border-t">
              <span class="text-sm text-muted-foreground">
                Showing {{ showFrom }} to {{ showTo }} of {{ totalCustomerCount }} entries
              </span>
              <div class="flex gap-2">
                <button
                  :disabled="!canPrev"
                  class="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50 disabled:pointer-events-none"
                  @click="prevPage"
                >
                  Previous
                </button>
                <button
                  :disabled="!canNext"
                  class="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50 disabled:pointer-events-none"
                  @click="nextPage"
                >
                  Next
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useRouter, useRoute } from 'vue-router'
import { getEvents, getEventsByCustomer, getEventsByModel, getFeatures, type ObserveEvent } from '@/lib/api'
import { Activity, ChevronRight, ChevronLeft, X, Plug } from 'lucide-vue-next'
import MarginBadge from '@/components/shared/MarginBadge.vue'
import SourceBadge from '@/components/shared/SourceBadge.vue'
import { Select, Input, Button, Skeleton } from '@/components/ui'

const router = useRouter()
const route = useRoute()

// Initialize filters from URL query params (e.g., navigating from ModelsPage with ?model=gpt-4o)
const selectedFeature = ref<string | undefined>(route.query.feature as string | undefined)
const selectedCustomer = ref<string | undefined>(route.query.customer as string | undefined)
const selectedModel = ref<string | undefined>(route.query.model as string | undefined)
const selectedSource = ref<string | undefined>(route.query.source as string | undefined)
const dateFrom = ref<string | undefined>()
const dateTo = ref<string | undefined>()
const currentPage = ref(0)
const PAGE_SIZE = 50

const SOURCES = [
  { value: 'sdk', label: 'SDK' },
  { value: 'csv', label: 'CSV Upload' },
  { value: 'stripe', label: 'Stripe Sync' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'sample', label: 'Sample Data' },
]

const query = computed(() => ({
  limit: PAGE_SIZE,
  offset: currentPage.value * PAGE_SIZE,
  feature_key: selectedFeature.value || undefined,
  customer_id: selectedCustomer.value || undefined,
  model: selectedModel.value || undefined,
  source: selectedSource.value || undefined,
  date_from: dateFrom.value || undefined,
  date_to: dateTo.value || undefined,
}))

const { data: eventsData, isLoading, isError } = useQuery({
  queryKey: ['events', query],
  queryFn: () => getEvents(query.value),
})

const { data: features } = useQuery({
  queryKey: ['features'],
  queryFn: getFeatures,
})

const { data: customerAgg } = useQuery({
  queryKey: ['events-by-customer'],
  queryFn: getEventsByCustomer,
})

const { data: modelAgg } = useQuery({
  queryKey: ['events-by-model'],
  queryFn: getEventsByModel,
})

const uniqueModels = computed(() =>
  (modelAgg.value || []).map(m => m.model).sort()
)

const ALL = '__all__'

const featureItems = computed(() => [
  { value: ALL, label: 'All Features' },
  ...(features.value || []).map(f => ({ value: f.feature_key, label: f.feature_key }))
])

const customerItems = computed(() => [
  { value: ALL, label: 'All Customers' },
  ...(customerAgg.value || []).map(c => ({ value: c.customer_id, label: c.customer_name || c.customer_id }))
])

const modelItems = computed(() => [
  { value: ALL, label: 'All Models' },
  ...uniqueModels.value.map(m => ({ value: m, label: m }))
])

const sourceItems = computed(() => [
  { value: ALL, label: 'All Sources' },
  ...SOURCES
])

function onSelectUpdate(setter: (v: string | undefined) => void) {
  return (val: string) => {
    setter(val === ALL ? undefined : val)
    resetPage()
  }
}

const hasFilters = computed(() =>
  selectedFeature.value || selectedCustomer.value || selectedModel.value ||
  selectedSource.value || dateFrom.value || dateTo.value
)

function clearFilters() {
  selectedFeature.value = undefined
  selectedCustomer.value = undefined
  selectedModel.value = undefined
  selectedSource.value = undefined
  dateFrom.value = undefined
  dateTo.value = undefined
  currentPage.value = 0
}

function resetPage() { currentPage.value = 0 }

function formatCost(val: number | null) {
  if (val === null) return '—'
  if (val === 0) return '$0'
  return `$${val.toFixed(4)}`
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function marginForEvent(event: ObserveEvent): number | null {
  if (!event.revenue_amount || !event.cost_amount) return null
  return Math.round(((event.revenue_amount - event.cost_amount) / event.revenue_amount) * 100)
}

function goToFeature(key: string) { router.push(`/features/${key}`) }
function goToCustomer(id: string) { router.push(`/customers/${id}`) }
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Events</h1>
        <p class="text-sm text-muted-foreground mt-1">All observed feature usage events with cost and revenue attribution</p>
      </div>
      <div class="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full border">
        <Activity class="h-4 w-4" />
        <span v-if="eventsData" class="font-medium text-foreground">{{ eventsData.total.toLocaleString() }} total events</span>
      </div>
    </div>

    <!-- Filters Inline Row -->
    <div class="flex flex-wrap items-center gap-3">
      <Select
        :model-value="selectedFeature || ALL"
        placeholder="Feature"
        :items="featureItems"
        @update:model-value="onSelectUpdate(v => selectedFeature = v)"
        class="w-[160px]"
      />
      <Select
        :model-value="selectedCustomer || ALL"
        placeholder="Customer"
        :items="customerItems"
        @update:model-value="onSelectUpdate(v => selectedCustomer = v)"
        class="w-[180px]"
      />
      <Select
        :model-value="selectedModel || ALL"
        placeholder="Model"
        :items="modelItems"
        @update:model-value="onSelectUpdate(v => selectedModel = v)"
        class="w-[160px]"
      />
      <Select
        :model-value="selectedSource || ALL"
        placeholder="Source"
        :items="sourceItems"
        @update:model-value="onSelectUpdate(v => selectedSource = v)"
        class="w-[160px]"
      />
      <div class="flex items-center gap-2">
        <Input
          v-model="dateFrom"
          type="date"
          class="h-9 w-[150px] shadow-sm"
          :class="{ 'text-muted-foreground': !dateFrom }"
          @update:model-value="resetPage"
        />
        <span class="text-muted-foreground text-sm">to</span>
        <Input
          v-model="dateTo"
          type="date"
          class="h-9 w-[150px] shadow-sm"
          :class="{ 'text-muted-foreground': !dateTo }"
          @update:model-value="resetPage"
        />
      </div>
      
      <Button
        v-if="hasFilters"
        variant="ghost"
        size="sm"
        class="h-9 px-3 text-muted-foreground hover:text-foreground"
        @click="clearFilters"
      >
        <X class="h-4 w-4 mr-1.5" />
        Clear
      </Button>
    </div>

    <!-- Table -->
    <div class="rounded-md border bg-card shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm text-left">
          <thead class="border-b bg-muted/40 text-muted-foreground text-xs font-medium uppercase tracking-wider">
            <tr>
              <th class="px-4 py-3 font-medium">Timestamp</th>
              <th class="px-4 py-3 font-medium">Event</th>
              <th class="px-4 py-3 font-medium">Feature</th>
              <th class="px-4 py-3 font-medium">Customer</th>
              <th class="px-4 py-3 font-medium">Model</th>
              <th class="px-4 py-3 font-medium">Source</th>
              <th class="px-4 py-3 text-right font-medium">Usage</th>
              <th class="px-4 py-3 text-right font-medium">Cost</th>
              <th class="px-4 py-3 text-right font-medium">Revenue</th>
              <th class="px-4 py-3 text-right font-medium">Margin</th>
            </tr>
          </thead>
          
          <tbody v-if="isLoading" class="divide-y divide-border">
            <tr v-for="i in 10" :key="i">
              <td class="px-4 py-3"><Skeleton class="h-4 w-24" /></td>
              <td class="px-4 py-3"><Skeleton class="h-4 w-20" /></td>
              <td class="px-4 py-3"><Skeleton class="h-4 w-28" /></td>
              <td class="px-4 py-3"><Skeleton class="h-4 w-32" /></td>
              <td class="px-4 py-3"><Skeleton class="h-4 w-24" /></td>
              <td class="px-4 py-3"><Skeleton class="h-4 w-16" /></td>
              <td class="px-4 py-3"><Skeleton class="h-4 w-12 ml-auto" /></td>
              <td class="px-4 py-3"><Skeleton class="h-4 w-16 ml-auto" /></td>
              <td class="px-4 py-3"><Skeleton class="h-4 w-16 ml-auto" /></td>
              <td class="px-4 py-3"><Skeleton class="h-5 w-14 rounded-full ml-auto" /></td>
            </tr>
          </tbody>
          
          <tbody v-else-if="isError" class="divide-y divide-border">
            <tr>
              <td colspan="10" class="px-4 py-8 text-center text-destructive">
                Failed to load events.
              </td>
            </tr>
          </tbody>
          
          <tbody v-else-if="!eventsData || eventsData.events.length === 0" class="divide-y divide-border">
            <tr>
              <td colspan="10" class="px-4 py-12 text-center">
                <template v-if="hasFilters">
                  <p class="text-muted-foreground mb-3">No events match these filters.</p>
                  <Button variant="outline" size="sm" @click="clearFilters">Clear Filters</Button>
                </template>
                <template v-else>
                  <Activity class="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
                  <p class="text-sm font-medium mb-1">No events yet</p>
                  <p class="text-xs text-muted-foreground mb-3 max-w-sm mx-auto">
                    Events appear when you send data via the SDK, connect an AI provider, or upload CSVs.
                    The fastest path: add 3 lines to your backend.
                  </p>
                  <div class="flex gap-2 justify-center">
                    <Button variant="outline" size="sm" @click="router.push('/data-sources')">
                      <Plug class="h-3.5 w-3.5 mr-1.5" />
                      Get Started
                    </Button>
                  </div>
                </template>
              </td>
            </tr>
          </tbody>

          <tbody v-else class="divide-y divide-border">
            <tr
              v-for="event in eventsData.events"
              :key="event.id"
              class="hover:bg-muted/50 transition-colors"
            >
              <td class="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                {{ formatDate(event.timestamp) }}
              </td>
              <td class="px-4 py-3 text-xs text-foreground">
                {{ event.event_name }}
              </td>
              <td class="px-4 py-3">
                <button
                  v-if="event.feature_key"
                  class="text-foreground hover:text-primary hover:underline inline-flex items-center gap-1 text-sm font-medium transition-colors"
                  @click="goToFeature(event.feature_key)"
                >
                  {{ event.feature_key }}
                  <ChevronRight class="h-3 w-3 text-muted-foreground" />
                </button>
                <span v-else class="text-muted-foreground text-sm">—</span>
              </td>
              <td class="px-4 py-3">
                <button
                  v-if="event.customer_id"
                  class="text-foreground hover:text-primary hover:underline inline-flex items-center gap-1 text-sm transition-colors"
                  @click="goToCustomer(event.customer_id)"
                >
                  {{ event.customer_name || event.customer_id }}
                </button>
                <span v-else class="text-muted-foreground text-sm">—</span>
              </td>
              <td class="px-4 py-3">
                <span v-if="event.model" class="font-mono text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-md border">
                  {{ event.model }}
                </span>
                <span v-else class="text-muted-foreground text-sm">—</span>
              </td>
              <td class="px-4 py-3">
                <SourceBadge v-if="event.is_inferred" source="" :is-inferred="true" />
                <SourceBadge v-else-if="event.source" :source="event.source" />
                <span v-else class="text-muted-foreground text-sm">—</span>
              </td>
              <td class="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums">
                {{ event.usage_units != null && event.usage_units !== 0 ? event.usage_units.toLocaleString() : '—' }}
              </td>
              <td class="px-4 py-3 text-right text-xs text-foreground tabular-nums">
                {{ formatCost(event.cost_amount) }}
              </td>
              <td class="px-4 py-3 text-right text-xs text-foreground tabular-nums">
                {{ formatCost(event.revenue_amount) }}
              </td>
              <td class="px-4 py-3 text-right">
                <MarginBadge :margin="marginForEvent(event)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="eventsData && eventsData.total > PAGE_SIZE" class="flex items-center justify-between">
      <span class="text-sm text-muted-foreground">
        Showing <span class="font-medium text-foreground">{{ eventsData.offset + 1 }}</span> to 
        <span class="font-medium text-foreground">{{ Math.min(eventsData.offset + PAGE_SIZE, eventsData.total) }}</span> of 
        <span class="font-medium text-foreground">{{ eventsData.total }}</span> events
      </span>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="currentPage === 0"
          @click="currentPage--"
        >
          <ChevronLeft class="h-4 w-4 mr-1" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="(currentPage + 1) * PAGE_SIZE >= eventsData.total"
          @click="currentPage++"
        >
          Next
          <ChevronRight class="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  </div>
</template>

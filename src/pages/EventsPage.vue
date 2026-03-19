<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { getEvents, getFeatures, type ObserveEvent } from '@/lib/api'
import { Activity, ChevronRight, Filter } from 'lucide-vue-next'
import MarginBadge from '@/components/shared/MarginBadge.vue'

const router = useRouter()

const selectedFeature = ref<string | undefined>()
const selectedModel = ref<string | undefined>()
const currentPage = ref(0)
const PAGE_SIZE = 50

const query = computed(() => ({
  limit: PAGE_SIZE,
  offset: currentPage.value * PAGE_SIZE,
  feature_key: selectedFeature.value || undefined,
  model: selectedModel.value || undefined,
}))

const { data: eventsData, isLoading, isError } = useQuery({
  queryKey: ['events', query],
  queryFn: () => getEvents(query.value),
})

const { data: features } = useQuery({
  queryKey: ['features'],
  queryFn: getFeatures,
})

const uniqueModels = computed(() => {
  const models = new Set<string>()
  eventsData.value?.events.forEach(e => { if (e.model) models.add(e.model) })
  return Array.from(models).sort()
})

function formatCost(val: number | null) {
  if (val === null) return '—'
  return `$${val.toFixed(4)}`
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function marginForEvent(event: ObserveEvent): number | null {
  if (!event.revenue_amount || !event.cost_amount) return null
  return Math.round(((event.revenue_amount - event.cost_amount) / event.revenue_amount) * 100)
}

function goToFeature(key: string) {
  router.push(`/features/${key}`)
}

function goToCustomer(id: string) {
  router.push(`/customers/${id}`)
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Events</h1>
        <p class="text-sm text-muted-foreground mt-1">All observed feature usage events with cost and revenue attribution</p>
      </div>
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <Activity class="h-4 w-4" />
        <span v-if="eventsData">{{ eventsData.total.toLocaleString() }} total events</span>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Filter class="h-3.5 w-3.5" />
        <span>Filter:</span>
      </div>
      <select
        v-model="selectedFeature"
        class="text-sm border rounded-md px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        @change="currentPage = 0"
      >
        <option value="">All features</option>
        <option v-for="f in features" :key="f.feature_key" :value="f.feature_key">
          {{ f.feature_key }}
        </option>
      </select>
      <select
        v-model="selectedModel"
        class="text-sm border rounded-md px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        @change="currentPage = 0"
      >
        <option value="">All models</option>
        <option v-for="m in uniqueModels" :key="m" :value="m">{{ m }}</option>
      </select>
      <button
        v-if="selectedFeature || selectedModel"
        class="text-xs text-muted-foreground hover:text-foreground underline"
        @click="selectedFeature = undefined; selectedModel = undefined; currentPage = 0"
      >
        Clear filters
      </button>
    </div>

    <!-- Table -->
    <div class="rounded-lg border bg-card overflow-hidden">
      <div v-if="isLoading" class="p-8 text-center text-muted-foreground text-sm">Loading events…</div>
      <div v-else-if="isError" class="p-8 text-center text-destructive text-sm">Failed to load events.</div>
      <div v-else-if="!eventsData || eventsData.events.length === 0" class="p-8 text-center text-muted-foreground text-sm">
        No events found. Load sample data or connect an integration to see events here.
      </div>
      <table v-else class="w-full text-sm">
        <thead class="bg-muted/50 text-muted-foreground">
          <tr>
            <th class="px-4 py-3 text-left font-medium">Timestamp</th>
            <th class="px-4 py-3 text-left font-medium">Event</th>
            <th class="px-4 py-3 text-left font-medium">Feature</th>
            <th class="px-4 py-3 text-left font-medium">Customer</th>
            <th class="px-4 py-3 text-left font-medium">Model</th>
            <th class="px-4 py-3 text-right font-medium">Cost</th>
            <th class="px-4 py-3 text-right font-medium">Revenue</th>
            <th class="px-4 py-3 text-right font-medium">Margin</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          <tr
            v-for="event in eventsData.events"
            :key="event.id"
            class="hover:bg-muted/30 transition-colors"
          >
            <td class="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{{ formatDate(event.timestamp) }}</td>
            <td class="px-4 py-2.5 font-mono text-xs">{{ event.event_name }}</td>
            <td class="px-4 py-2.5">
              <button
                v-if="event.feature_key"
                class="text-primary hover:underline inline-flex items-center gap-1"
                @click="goToFeature(event.feature_key)"
              >
                {{ event.feature_key }}
                <ChevronRight class="h-3 w-3" />
              </button>
              <span v-else class="text-muted-foreground">—</span>
            </td>
            <td class="px-4 py-2.5">
              <button
                v-if="event.customer_id"
                class="text-primary hover:underline inline-flex items-center gap-1"
                @click="goToCustomer(event.customer_id)"
              >
                {{ event.customer_name || event.customer_id }}
              </button>
              <span v-else class="text-muted-foreground">—</span>
            </td>
            <td class="px-4 py-2.5">
              <span v-if="event.model" class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{{ event.model }}</span>
              <span v-else class="text-muted-foreground">—</span>
            </td>
            <td class="px-4 py-2.5 text-right font-mono text-xs">{{ formatCost(event.cost_amount) }}</td>
            <td class="px-4 py-2.5 text-right font-mono text-xs">{{ formatCost(event.revenue_amount) }}</td>
            <td class="px-4 py-2.5 text-right">
              <MarginBadge :margin="marginForEvent(event)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div v-if="eventsData && eventsData.total > PAGE_SIZE" class="flex items-center justify-between text-sm">
      <span class="text-muted-foreground">
        Showing {{ eventsData.offset + 1 }}–{{ Math.min(eventsData.offset + PAGE_SIZE, eventsData.total) }} of {{ eventsData.total }}
      </span>
      <div class="flex items-center gap-2">
        <button
          :disabled="currentPage === 0"
          class="px-3 py-1.5 border rounded-md disabled:opacity-40 hover:bg-muted/50 transition-colors"
          @click="currentPage--"
        >
          Previous
        </button>
        <button
          :disabled="(currentPage + 1) * PAGE_SIZE >= eventsData.total"
          class="px-3 py-1.5 border rounded-md disabled:opacity-40 hover:bg-muted/50 transition-colors"
          @click="currentPage++"
        >
          Next
        </button>
      </div>
    </div>
  </div>
</template>

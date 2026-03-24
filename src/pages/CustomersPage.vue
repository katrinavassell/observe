<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { getCustomers, getEventsByCustomer } from '@/lib/api'
import { Users, ChevronRight, Search, AlertCircle, Plug, FlaskConical } from 'lucide-vue-next'
import { useDemoMode } from '@/composables/useDemoMode'
import MarginBadge from '@/components/shared/MarginBadge.vue'
import { Input, Select, Skeleton, Button, Card, CardContent } from '@/components/ui'

const router = useRouter()
const queryClient = useQueryClient()
const { enterDemoMode, isLoadingDemo } = useDemoMode()
const search = ref('')
const segmentFilter = ref('__all__')

const { data: customers, isLoading, isError } = useQuery({
  queryKey: ['customers'],
  queryFn: getCustomers,
})

const { data: customerMargins } = useQuery({
  queryKey: ['events-by-customer'],
  queryFn: getEventsByCustomer,
})

const marginByCustomerId = computed(() => {
  const map: Record<string, number | null> = {}
  customerMargins.value?.forEach(c => { map[c.customer_id] = c.margin_pct })
  return map
})

const filtered = computed(() => {
  if (!customers.value) return []
  let list = customers.value
  if (segmentFilter.value && segmentFilter.value !== '__all__') {
    list = list.filter(c => c.segment === segmentFilter.value)
  }
  const q = search.value.toLowerCase()
  if (!q) return list
  return list.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.email && c.email.toLowerCase().includes(q)) ||
    (c.segment && c.segment.toLowerCase().includes(q))
  )
})

const segments = computed(() => {
  const s = new Set<string>()
  customers.value?.forEach(c => { if (c.segment) s.add(c.segment) })
  return Array.from(s).sort()
})

const segmentItems = computed(() => {
  return [
    { value: '__all__', label: 'All segments' },
    ...segments.value.map(s => ({ value: s, label: s }))
  ]
})

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString()
}

function segmentClass(segment: string | null) {
  if (!segment) return 'bg-gray-100 text-gray-600'
  const map: Record<string, string> = {
    'Enterprise': 'bg-purple-100 text-purple-700',
    'Mid-Market': 'bg-blue-100 text-blue-700',
    'SMB': 'bg-green-100 text-green-700',
  }
  return map[segment] || 'bg-gray-100 text-gray-600'
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Customers</h1>
        <p class="text-sm text-muted-foreground mt-1">Customer profiles with feature usage and margin</p>
      </div>
      <div v-if="customers" class="text-sm text-muted-foreground flex items-center gap-1.5">
        <Users class="h-4 w-4" />
        {{ customers.length }} customers
      </div>
    </div>

    <div class="flex items-center gap-3 flex-wrap">
      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
        <Input
          :model-value="search"
          placeholder="Search customers…"
          class="pl-9 w-56"
          @update:model-value="search = $event"
        />
      </div>

      <Select
        :model-value="segmentFilter"
        :items="segmentItems"
        placeholder="All segments"
        class="w-44"
        @update:model-value="segmentFilter = $event"
      />

      <Button
        v-if="search || (segmentFilter && segmentFilter !== '__all__')"
        variant="ghost"
        size="sm"
        class="text-muted-foreground hover:text-foreground"
        @click="search = ''; segmentFilter = '__all__'"
      >
        Clear
      </Button>
    </div>

    <!-- Loading -->
    <Card v-if="isLoading">
      <CardContent class="py-6 space-y-3">
        <Skeleton v-for="i in 8" :key="i" class="h-12 w-full" />
      </CardContent>
    </Card>
    <!-- Error -->
    <div v-else-if="isError" class="flex flex-col items-center justify-center py-24 text-center">
      <AlertCircle class="h-10 w-10 text-muted-foreground mb-4" />
      <p class="text-muted-foreground mb-4">Failed to load customers.</p>
      <Button @click="queryClient.invalidateQueries({ queryKey: ['customers'] })">Try Again</Button>
    </div>
    <!-- Empty -->
    <div v-else-if="filtered.length === 0" class="flex flex-col items-center justify-center py-16 text-center">
      <Users class="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p v-if="search || (segmentFilter && segmentFilter !== '__all__')" class="text-muted-foreground mb-4">No customers matching your filters.</p>
      <template v-else>
        <p class="text-muted-foreground mb-4">No customers yet. Load sample data or sync an integration.</p>
        <div class="flex gap-3">
          <Button :disabled="isLoadingDemo" @click="enterDemoMode">
            <FlaskConical class="h-4 w-4 mr-2" />
            {{ isLoadingDemo ? 'Loading...' : 'Try Demo' }}
          </Button>
          <Button variant="outline" @click="router.push('/data-sources')">
            <Plug class="h-4 w-4 mr-2" />
            Import Data
          </Button>
        </div>
      </template>
    </div>
    <!-- Table -->
    <div v-else class="rounded-lg border bg-card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-muted/50 text-muted-foreground">
          <tr>
            <th class="px-4 py-3 text-left font-medium">Name</th>
            <th class="px-4 py-3 text-left font-medium">Email</th>
            <th class="px-4 py-3 text-left font-medium">Segment</th>
            <th class="px-4 py-3 text-right font-medium">Margin</th>
            <th class="px-4 py-3 text-left font-medium">Customer ID</th>
            <th class="px-4 py-3 text-right font-medium">Since</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y">
          <tr
            v-for="c in filtered"
            :key="c.customer_id"
            class="hover:bg-muted/50 transition-colors cursor-pointer"
            @click="router.push(`/customers/${c.customer_id}`)"
          >
            <td class="px-4 py-3 font-medium">{{ c.name }}</td>
            <td class="px-4 py-3 text-muted-foreground text-sm">{{ c.email || '—' }}</td>
            <td class="px-4 py-3">
              <span
                v-if="c.segment"
                :class="['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', segmentClass(c.segment)]"
              >
                {{ c.segment }}
              </span>
              <span v-else class="text-muted-foreground">—</span>
            </td>
            <td class="px-4 py-3 text-right">
              <MarginBadge
                v-if="marginByCustomerId[c.customer_id] !== undefined"
                :margin="marginByCustomerId[c.customer_id]"
              />
              <span v-else class="text-xs text-muted-foreground">—</span>
            </td>
            <td class="px-4 py-3 font-mono text-xs text-muted-foreground">{{ c.customer_id }}</td>
            <td class="px-4 py-3 text-right text-muted-foreground text-xs">{{ formatDate(c.created_at) }}</td>
            <td class="px-4 py-3 text-right">
              <ChevronRight class="h-4 w-4 text-muted-foreground ml-auto" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

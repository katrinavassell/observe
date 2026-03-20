<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { getCustomers, getEventsByCustomer } from '@/lib/api'
import { Users, ChevronRight, Search } from 'lucide-vue-next'
import MarginBadge from '@/components/shared/MarginBadge.vue'
import { Input, Select } from '@/components/ui'

const router = useRouter()
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

      <button
        v-if="search || (segmentFilter && segmentFilter !== '__all__')"
        class="text-xs text-muted-foreground hover:text-foreground underline"
        @click="search = ''; segmentFilter = '__all__'"
      >
        Clear
      </button>
    </div>

    <!-- Table -->
    <div class="rounded-lg border bg-card overflow-hidden">
      <div v-if="isLoading" class="p-8 text-center text-muted-foreground text-sm">Loading customers…</div>
      <div v-else-if="isError" class="p-8 text-center text-destructive text-sm">Failed to load customers.</div>
      <div v-else-if="filtered.length === 0" class="p-8 text-center text-muted-foreground text-sm">
        <Users class="h-8 w-8 mx-auto mb-2 opacity-40" />
        <span v-if="search || (segmentFilter && segmentFilter !== '__all__')">No customers matching your filters</span>
        <span v-else>No customers yet. Load sample data or sync an integration.</span>
      </div>
      <table v-else class="w-full text-sm">
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
            class="hover:bg-muted/30 transition-colors cursor-pointer"
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

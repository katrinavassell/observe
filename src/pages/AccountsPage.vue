<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { Search, Download, ChevronLeft, ChevronRight, Building2 } from 'lucide-vue-next'
import { Card, CardContent, Button, Badge, Input } from '@/components/ui'
import Skeleton from '@/components/ui/skeleton.vue'
import AccountDetailPanel from '@/components/accounts/AccountDetailPanel.vue'
import { getAccounts, exportAccounts } from '@/api/client'
import { formatCurrency } from '@/lib/utils'

const search = ref('')
const selectedAccountId = ref<number | null>(null)

function openAccountDetail(accountId: number) {
  selectedAccountId.value = accountId
}

function closeAccountDetail() {
  selectedAccountId.value = null
}
const sourceSystem = ref<string>()
const segment = ref<string>()
const page = ref(1)
const limit = 20

const debouncedSearch = ref('')
let searchTimeout: ReturnType<typeof setTimeout>

watch(search, (val) => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    debouncedSearch.value = val
    page.value = 1
  }, 300)
})

const { data, isLoading } = useQuery({
  queryKey: ['accounts', debouncedSearch, sourceSystem, segment, page],
  queryFn: () => getAccounts({
    search: debouncedSearch.value || undefined,
    source_system: sourceSystem.value,
    segment: segment.value,
    limit,
    offset: (page.value - 1) * limit,
  }),
})

const accounts = computed(() => data.value?.accounts ?? [])
const total = computed(() => data.value?.total ?? 0)
const hasMore = computed(() => data.value?.has_more ?? false)

const sourceOptions = ['salesforce', 'stripe', 'hubspot', 'manual']
const segmentOptions = ['Enterprise', 'Mid-Market', 'SMB']

const isExporting = ref(false)
async function handleExport() {
  isExporting.value = true
  try {
    const blob = await exportAccounts('csv')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `accounts-${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } finally {
    isExporting.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Accounts</h1>
        <p class="text-muted-foreground">Browse and manage customer accounts</p>
      </div>
      <Button variant="outline" :disabled="isExporting" @click="handleExport">
        <Download class="mr-2 h-4 w-4" />
        Export CSV
      </Button>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative flex-1 max-w-sm">
        <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="search"
          placeholder="Search accounts..."
          class="pl-9"
        />
      </div>

      <select
        v-model="sourceSystem"
        class="h-10 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option :value="undefined">All Sources</option>
        <option v-for="opt in sourceOptions" :key="opt" :value="opt" class="capitalize">
          {{ opt }}
        </option>
      </select>

      <select
        v-model="segment"
        class="h-10 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option :value="undefined">All Segments</option>
        <option v-for="opt in segmentOptions" :key="opt" :value="opt">
          {{ opt }}
        </option>
      </select>

      <span v-if="total > 0" class="text-sm text-muted-foreground">
        {{ total }} account{{ total === 1 ? '' : 's' }}
      </span>
    </div>

    <!-- Loading State -->
    <Card v-if="isLoading">
      <CardContent class="p-0">
        <div class="space-y-4 p-6">
          <Skeleton v-for="i in 5" :key="i" class="h-12 w-full" />
        </div>
      </CardContent>
    </Card>

    <!-- Empty State -->
    <div v-else-if="accounts.length === 0" class="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 px-4">
      <Building2 class="h-12 w-12 text-muted-foreground/40" />
      <h3 class="mt-4 text-lg font-medium">No accounts yet</h3>
      <p class="mt-2 text-sm text-muted-foreground text-center max-w-sm">
        Your customers will appear here once you connect a data source or upload a CSV file.
      </p>
      <div class="flex gap-3 mt-6">
        <Button @click="$router.push('/data-sources')">
          Connect Data Source
        </Button>
        <Button variant="outline" @click="$router.push('/onboarding')">
          Try Sample Data
        </Button>
      </div>
    </div>

    <!-- Table -->
    <Card v-else>
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b bg-muted/50">
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Account</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Source</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Segment</th>
                <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">ARR</th>
                <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">MRR</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr
                v-for="account in accounts"
                :key="account.id"
                class="hover:bg-muted/50 transition-colors cursor-pointer"
                @click="openAccountDetail(account.id)"
              >
                <td class="px-4 py-3">
                  <div class="font-medium">{{ account.name }}</div>
                  <div v-if="account.domain" class="text-xs text-muted-foreground">{{ account.domain }}</div>
                </td>
                <td class="px-4 py-3">
                  <Badge variant="secondary" class="capitalize">{{ account.source_system }}</Badge>
                </td>
                <td class="px-4 py-3">
                  <Badge v-if="account.segment" variant="outline">{{ account.segment }}</Badge>
                  <span v-else class="text-muted-foreground">—</span>
                </td>
                <td class="px-4 py-3 text-right font-mono text-sm">
                  {{ formatCurrency(account.arr) }}
                </td>
                <td class="px-4 py-3 text-right font-mono text-sm">
                  {{ formatCurrency(account.mrr) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="flex items-center justify-center gap-2 border-t p-4">
          <Button
            variant="ghost"
            size="icon"
            :disabled="page <= 1"
            @click="page--"
          >
            <ChevronLeft class="h-4 w-4" />
          </Button>
          <span class="text-sm text-muted-foreground">Page {{ page }}</span>
          <Button
            variant="ghost"
            size="icon"
            :disabled="!hasMore"
            @click="page++"
          >
            <ChevronRight class="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Account Detail Slide-over -->
    <Teleport to="body">
      <Transition name="slide">
        <div
          v-if="selectedAccountId"
          class="fixed inset-0 z-50"
        >
          <!-- Backdrop -->
          <div
            class="absolute inset-0 bg-background/80 backdrop-blur-sm"
            @click="closeAccountDetail"
          />

          <!-- Panel -->
          <div class="absolute inset-y-0 right-0 w-full max-w-lg border-l bg-background shadow-xl">
            <AccountDetailPanel
              :account-id="selectedAccountId"
              @close="closeAccountDetail"
            />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease-out;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
}

.slide-enter-from > div:last-child,
.slide-leave-to > div:last-child {
  transform: translateX(100%);
}
</style>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { listSimulations, getOpportunities } from '@/lib/api'
import type { SimulationStatus } from '@/types/simulation'
import { getSimulationStatusColor, getSimulationStatusLabel } from '@/types/simulation'
import { useEntitlement } from '@/composables/useEntitlement'
import UsageLimitBanner from '@/components/shared/UsageLimitBanner.vue'
import {
  FlaskConical,
  Plus,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Calendar,
} from 'lucide-vue-next'

const router = useRouter()
const statusFilter = ref<'all' | SimulationStatus>('all')
const simRun = useEntitlement('simulations')

const { data: simulations, isLoading, isError } = useQuery({
  queryKey: ['simulations'],
  queryFn: listSimulations,
})

const { data: opportunities } = useQuery({
  queryKey: ['opportunities'],
  queryFn: getOpportunities,
})

const filtered = computed(() => {
  if (!simulations.value) return []
  if (statusFilter.value === 'all') return simulations.value
  return simulations.value.filter(s => s.status === statusFilter.value)
})

const statusCounts = computed(() => {
  const counts = { all: 0, draft: 0, completed: 0, rolled_out: 0, running: 0 }
  if (simulations.value) {
    counts.all = simulations.value.length
    for (const s of simulations.value) {
      if (s.status in counts) counts[s.status as keyof typeof counts]++
    }
  }
  return counts
})

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatCurrency(val: number) {
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`
  if (val >= 1) return `$${val.toFixed(2)}`
  return `$${val.toFixed(4)}`
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Simulations</h1>
        <p class="text-sm text-muted-foreground mt-1">What-if pricing scenarios and revenue modeling</p>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="simRun.isAtLimit.value"
        :title="simRun.isAtLimit.value ? 'Simulation limit reached — upgrade your plan' : ''"
        @click="router.push('/simulations/new')"
      >
        <Plus class="h-4 w-4" />
        New Simulation
      </button>
    </div>

    <UsageLimitBanner
      v-if="simRun.hasLimit.value"
      feature-label="Simulations"
      :allowed="simRun.allowed.value"
      :usage="simRun.usage.value"
      :limit="simRun.limit.value"
      :usage-percent="simRun.usagePercent.value"
      :bar-color="simRun.barColor.value"
      :has-limit="simRun.hasLimit.value"
    />

    <!-- Opportunity banner -->
    <div
      v-if="opportunities && opportunities.length > 0"
      class="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm"
    >
      <AlertTriangle class="h-4 w-4 text-yellow-600 shrink-0" />
      <div class="flex-1">
        <span class="font-medium text-yellow-800">
          {{ opportunities.length }} pricing issue{{ opportunities.length > 1 ? 's' : '' }} detected
        </span>
        <span class="text-yellow-700 ml-1">
          — features with negative or low margins that could benefit from a simulation.
        </span>
      </div>
      <button
        class="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 hover:text-yellow-900 whitespace-nowrap"
        @click="router.push('/features')"
      >
        View Issues <ArrowRight class="h-3 w-3" />
      </button>
    </div>

    <!-- Status filter tabs -->
    <div class="flex items-center gap-1 border-b">
      <button
        v-for="tab in (['all', 'draft', 'completed', 'rolled_out'] as const)"
        :key="tab"
        :class="[
          'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
          statusFilter === tab
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
        ]"
        @click="statusFilter = tab"
      >
        {{ tab === 'all' ? 'All' : tab === 'rolled_out' ? 'Rolled Out' : tab.charAt(0).toUpperCase() + tab.slice(1) }}
        <span class="ml-1 text-xs text-muted-foreground">({{ statusCounts[tab] }})</span>
      </button>
    </div>

    <!-- Loading / Error -->
    <div v-if="isLoading" class="p-8 text-center text-muted-foreground text-sm">Loading simulations...</div>
    <div v-else-if="isError" class="p-8 text-center text-destructive text-sm">Failed to load simulations.</div>

    <!-- Empty state -->
    <div v-else-if="filtered.length === 0" class="rounded-lg border bg-card p-12 text-center">
      <div class="flex items-center justify-center w-14 h-14 rounded-full bg-muted mx-auto mb-4">
        <FlaskConical class="h-7 w-7 text-muted-foreground" />
      </div>
      <h2 class="text-lg font-semibold mb-2">
        {{ statusFilter === 'all' ? 'No simulations yet' : 'No ' + statusFilter + ' simulations' }}
      </h2>
      <p class="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
        Create a pricing simulation to model the revenue and margin impact of changing your plans,
        prices, or packaging before rolling out changes.
      </p>
      <button
        class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="simRun.isAtLimit.value"
        :title="simRun.isAtLimit.value ? 'Simulation limit reached — upgrade your plan' : ''"
        @click="router.push('/simulations/new')"
      >
        <Plus class="h-4 w-4" />
        Create Simulation
      </button>
    </div>

    <!-- Simulation grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div
        v-for="sim in filtered"
        :key="sim.id"
        class="rounded-lg border bg-card p-5 cursor-pointer hover:shadow-sm transition-shadow"
        @click="router.push(`/simulations/${sim.id}`)"
      >
        <!-- Card header -->
        <div class="flex items-start justify-between mb-3">
          <h3 class="text-sm font-semibold truncate pr-2">{{ sim.name }}</h3>
          <span
            :class="[
              'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold shrink-0',
              getSimulationStatusColor(sim.status)
            ]"
          >
            {{ getSimulationStatusLabel(sim.status) }}
          </span>
        </div>

        <!-- Margin impact if completed -->
        <div v-if="sim.margin_impact" class="grid grid-cols-3 gap-3 mb-3">
          <div>
            <div class="text-[11px] text-muted-foreground">Current Margin</div>
            <div class="text-base font-semibold">{{ sim.margin_impact.current_margin_pct }}%</div>
          </div>
          <div>
            <div class="text-[11px] text-muted-foreground">Projected</div>
            <div class="text-base font-semibold">{{ sim.margin_impact.projected_margin_pct }}%</div>
          </div>
          <div>
            <div class="text-[11px] text-muted-foreground">Delta</div>
            <div class="flex items-center gap-1">
              <TrendingUp
                v-if="sim.margin_impact.margin_delta_pct > 0"
                class="h-3.5 w-3.5 text-green-600"
              />
              <TrendingDown
                v-else-if="sim.margin_impact.margin_delta_pct < 0"
                class="h-3.5 w-3.5 text-red-600"
              />
              <span
                :class="[
                  'text-base font-semibold',
                  sim.margin_impact.margin_delta_pct > 0 ? 'text-green-600' : sim.margin_impact.margin_delta_pct < 0 ? 'text-red-600' : ''
                ]"
              >
                {{ sim.margin_impact.margin_delta_pct > 0 ? '+' : '' }}{{ sim.margin_impact.margin_delta_pct }}pp
              </span>
            </div>
          </div>
        </div>

        <!-- Revenue summary if completed -->
        <div v-if="sim.margin_impact" class="text-xs text-muted-foreground mb-3">
          {{ formatCurrency(sim.margin_impact.total_current_revenue) }} current
          <ArrowRight class="h-3 w-3 inline mx-0.5" />
          {{ formatCurrency(sim.margin_impact.total_projected_revenue) }} projected
          · {{ sim.margin_impact.customers_affected }} customers affected
        </div>

        <!-- Draft info -->
        <div v-else class="text-xs text-muted-foreground mb-3">
          {{ sim.scenarios.length }} scenario{{ sim.scenarios.length !== 1 ? 's' : '' }} configured
          · Not yet run
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
          <div class="flex items-center gap-1">
            <Calendar class="h-3 w-3" />
            {{ formatDate(sim.created_at) }}
          </div>
          <div v-if="sim.confidence_score" class="flex items-center gap-1">
            <span>Confidence: {{ sim.confidence_score }}%</span>
          </div>
          <ArrowRight class="h-3.5 w-3.5 shrink-0" />
        </div>
      </div>
    </div>
  </div>
</template>

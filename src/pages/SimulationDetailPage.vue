<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { getSimulation, updateSimulation } from '@/lib/api'
import { getSimulationStatusColor, getSimulationStatusLabel } from '@/types/simulation'
import MarginBadge from '@/components/shared/MarginBadge.vue'
import TrendIndicator from '@/components/shared/TrendIndicator.vue'
import {
  ArrowLeft,
  ArrowRight,
  Rocket,
  Calendar,
  ShieldCheck,
  Lightbulb,
  Users,
  Layers,
  Loader2,
  AlertTriangle,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()

const simulationId = computed(() => route.params.id as string)
const activeTab = ref<'features' | 'customers'>('features')

const { data: simulation, isLoading, isError } = useQuery({
  queryKey: computed(() => ['simulation', simulationId.value]),
  queryFn: () => getSimulation(simulationId.value),
  enabled: computed(() => !!simulationId.value),
})

const rolloutMutation = useMutation({
  mutationFn: () => updateSimulation(simulationId.value, { status: 'rolled_out' } as Record<string, unknown>),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['simulation', simulationId.value] })
    queryClient.invalidateQueries({ queryKey: ['simulations'] })
    toast.success('Simulation rolled out successfully')
  },
  onError: () => {
    toast.error('Failed to roll out simulation')
  },
})

const canRollOut = computed(() => {
  if (!simulation.value) return false
  return simulation.value.status === 'completed' && simulation.value.winning_scenario_id
})

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatCurrency(val: number) {
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`
  if (val >= 1) return `$${val.toFixed(2)}`
  return `$${val.toFixed(4)}`
}

function churnRiskClass(risk: string) {
  switch (risk) {
    case 'high': return 'bg-red-100 text-red-700 border-red-200'
    case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-200'
    case 'low': return 'bg-green-100 text-green-700 border-green-200'
    default: return 'bg-gray-100 text-gray-600 border-gray-200'
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <button
        class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"
        @click="router.push('/simulations')"
      >
        <ArrowLeft class="h-3.5 w-3.5" /> Back to Simulations
      </button>

      <div v-if="isLoading" class="p-8 text-center text-muted-foreground text-sm">Loading simulation...</div>
      <div v-else-if="isError" class="p-8 text-center text-destructive text-sm">Failed to load simulation.</div>

      <template v-else-if="simulation">
        <div class="flex items-start justify-between">
          <div>
            <h1 class="text-2xl font-semibold tracking-tight flex items-center gap-3">
              {{ simulation.name }}
              <span
                :class="[
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                  getSimulationStatusColor(simulation.status)
                ]"
              >
                {{ getSimulationStatusLabel(simulation.status) }}
              </span>
            </h1>
            <p class="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
              <Calendar class="h-3.5 w-3.5" />
              Created {{ formatDate(simulation.created_at) }}
              <span v-if="simulation.segment_name" class="ml-2">
                · Segment: {{ simulation.segment_name }}
              </span>
            </p>
          </div>

          <button
            v-if="canRollOut"
            :disabled="rolloutMutation.isPending.value"
            class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            @click="rolloutMutation.mutate()"
          >
            <Loader2 v-if="rolloutMutation.isPending.value" class="h-4 w-4 animate-spin" />
            <Rocket v-else class="h-4 w-4" />
            Roll Out
          </button>

          <div
            v-if="simulation.status === 'rolled_out'"
            class="inline-flex items-center gap-2 rounded-md bg-purple-50 border border-purple-200 px-4 py-2 text-sm font-medium text-purple-700"
          >
            <ShieldCheck class="h-4 w-4" />
            Rolled out {{ simulation.rolled_out_at ? formatDate(simulation.rolled_out_at) : '' }}
          </div>
        </div>

        <!-- Draft state -->
        <div v-if="simulation.status === 'draft'" class="rounded-lg border bg-card p-8 text-center mt-6">
          <div class="flex items-center justify-center w-12 h-12 rounded-full bg-muted mx-auto mb-3">
            <Layers class="h-6 w-6 text-muted-foreground" />
          </div>
          <h2 class="text-lg font-semibold mb-1">Simulation not yet run</h2>
          <p class="text-sm text-muted-foreground max-w-md mx-auto mb-4">
            This simulation has {{ simulation.scenarios.length }} scenario{{ simulation.scenarios.length !== 1 ? 's' : '' }} configured but hasn't been executed yet.
          </p>
        </div>

        <!-- Results (completed or rolled_out) -->
        <template v-if="simulation.status === 'completed' || simulation.status === 'rolled_out'">
          <!-- Key insight hero -->
          <div
            v-if="simulation.key_insight"
            class="rounded-lg border bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200 p-5 mt-4"
          >
            <div class="flex items-start gap-3">
              <Lightbulb class="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <div class="text-xs font-medium text-blue-600 mb-1">Key Insight</div>
                <p class="text-sm text-blue-900 leading-relaxed">{{ simulation.key_insight }}</p>
              </div>
            </div>
          </div>

          <!-- Confidence score -->
          <div v-if="simulation.confidence_score !== null" class="rounded-lg border bg-card p-4 mt-4">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-medium text-muted-foreground">Confidence Score</span>
              <span class="text-sm font-semibold">{{ simulation.confidence_score }}%</span>
            </div>
            <div class="h-2 rounded-full bg-muted overflow-hidden">
              <div
                :class="[
                  'h-full rounded-full transition-all',
                  simulation.confidence_score >= 70 ? 'bg-green-500' :
                  simulation.confidence_score >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                ]"
                :style="{ width: simulation.confidence_score + '%' }"
              />
            </div>
          </div>

          <!-- Margin impact summary cards -->
          <div v-if="simulation.margin_impact" class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            <div class="rounded-lg border bg-card p-4">
              <div class="text-xs text-muted-foreground mb-1">Current Margin</div>
              <div class="text-2xl font-semibold">{{ simulation.margin_impact.current_margin_pct }}%</div>
            </div>
            <div class="rounded-lg border bg-card p-4">
              <div class="text-xs text-muted-foreground mb-1">Projected Margin</div>
              <div class="text-2xl font-semibold">{{ simulation.margin_impact.projected_margin_pct }}%</div>
            </div>
            <div class="rounded-lg border bg-card p-4">
              <div class="text-xs text-muted-foreground mb-1">Margin Delta</div>
              <div class="flex items-center gap-1">
                <TrendIndicator
                  :direction="simulation.margin_impact.margin_delta_pct > 0 ? 'up' : simulation.margin_impact.margin_delta_pct < 0 ? 'down' : 'stable'"
                  :value="Math.abs(simulation.margin_impact.margin_delta_pct)"
                  suffix="pp"
                />
              </div>
            </div>
            <div class="rounded-lg border bg-card p-4">
              <div class="text-xs text-muted-foreground mb-1">Customers Affected</div>
              <div class="flex items-baseline gap-2">
                <span class="text-2xl font-semibold">{{ simulation.margin_impact.customers_affected }}</span>
                <span
                  v-if="simulation.margin_impact.high_churn_risk_count > 0"
                  class="inline-flex items-center gap-0.5 text-xs text-red-600"
                >
                  <AlertTriangle class="h-3 w-3" />
                  {{ simulation.margin_impact.high_churn_risk_count }} high risk
                </span>
              </div>
            </div>
          </div>

          <!-- Revenue summary -->
          <div v-if="simulation.margin_impact" class="rounded-lg border bg-card p-4 mt-4">
            <div class="grid grid-cols-3 gap-4 text-center">
              <div>
                <div class="text-xs text-muted-foreground mb-1">Current Revenue</div>
                <div class="text-lg font-semibold">{{ formatCurrency(simulation.margin_impact.total_current_revenue) }}</div>
              </div>
              <div class="flex flex-col items-center justify-center">
                <ArrowRight class="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <div class="text-xs text-muted-foreground mb-1">Projected Revenue</div>
                <div class="text-lg font-semibold">{{ formatCurrency(simulation.margin_impact.total_projected_revenue) }}</div>
              </div>
            </div>
          </div>

          <!-- Tabs: By Feature | By Customer -->
          <div class="flex items-center gap-1 border-b mt-6">
            <button
              :class="[
                'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === 'features'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              ]"
              @click="activeTab = 'features'"
            >
              <Layers class="h-3.5 w-3.5" />
              By Feature
            </button>
            <button
              :class="[
                'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === 'customers'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              ]"
              @click="activeTab = 'customers'"
            >
              <Users class="h-3.5 w-3.5" />
              By Customer
            </button>
          </div>

          <!-- By Feature table -->
          <div v-if="activeTab === 'features'" class="rounded-lg border bg-card overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-muted/50 text-muted-foreground">
                <tr>
                  <th class="px-4 py-3 text-left font-medium">Feature</th>
                  <th class="px-4 py-3 text-right font-medium">Current Cost</th>
                  <th class="px-4 py-3 text-right font-medium">Current Revenue</th>
                  <th class="px-4 py-3 text-right font-medium">Current Margin</th>
                  <th class="px-4 py-3 text-right font-medium">Projected Revenue</th>
                  <th class="px-4 py-3 text-right font-medium">Projected Margin</th>
                  <th class="px-4 py-3 text-right font-medium">Delta</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr
                  v-for="fa in simulation.feature_analysis"
                  :key="fa.feature_key"
                  class="hover:bg-muted/30"
                >
                  <td class="px-4 py-3">
                    <span class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{{ fa.feature_key }}</span>
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums text-xs">{{ formatCurrency(fa.current_cost) }}</td>
                  <td class="px-4 py-3 text-right tabular-nums text-xs">{{ formatCurrency(fa.current_revenue) }}</td>
                  <td class="px-4 py-3 text-right">
                    <MarginBadge :margin="fa.current_margin_pct" />
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums text-xs">{{ formatCurrency(fa.projected_revenue) }}</td>
                  <td class="px-4 py-3 text-right">
                    <MarginBadge :margin="fa.projected_margin_pct" />
                  </td>
                  <td class="px-4 py-3 text-right">
                    <TrendIndicator
                      :direction="fa.margin_delta_pct > 0 ? 'up' : fa.margin_delta_pct < 0 ? 'down' : 'stable'"
                      :value="Math.abs(fa.margin_delta_pct)"
                      suffix="pp"
                    />
                  </td>
                </tr>
                <tr v-if="simulation.feature_analysis.length === 0">
                  <td colspan="7" class="px-4 py-6 text-center text-muted-foreground">No feature analysis data</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- By Customer table -->
          <div v-if="activeTab === 'customers'" class="rounded-lg border bg-card overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-muted/50 text-muted-foreground">
                <tr>
                  <th class="px-4 py-3 text-left font-medium">Customer</th>
                  <th class="px-4 py-3 text-left font-medium">Segment</th>
                  <th class="px-4 py-3 text-right font-medium">Current Revenue</th>
                  <th class="px-4 py-3 text-right font-medium">Projected Revenue</th>
                  <th class="px-4 py-3 text-right font-medium">Delta</th>
                  <th class="px-4 py-3 text-right font-medium">Churn Risk</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr
                  v-for="ci in simulation.customer_impacts"
                  :key="ci.customer_id"
                  class="hover:bg-muted/30 cursor-pointer"
                  @click="router.push(`/customers/${ci.customer_id}`)"
                >
                  <td class="px-4 py-3 font-medium">{{ ci.customer_name }}</td>
                  <td class="px-4 py-3">
                    <span v-if="ci.segment" class="text-xs text-muted-foreground">{{ ci.segment }}</span>
                    <span v-else class="text-muted-foreground">--</span>
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums text-xs">{{ formatCurrency(ci.current_revenue) }}</td>
                  <td class="px-4 py-3 text-right tabular-nums text-xs">{{ formatCurrency(ci.projected_revenue) }}</td>
                  <td class="px-4 py-3 text-right">
                    <TrendIndicator
                      :direction="ci.revenue_delta > 0 ? 'up' : ci.revenue_delta < 0 ? 'down' : 'stable'"
                      :value="Math.abs(ci.revenue_delta_pct)"
                    />
                  </td>
                  <td class="px-4 py-3 text-right">
                    <span
                      :class="[
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
                        churnRiskClass(ci.churn_risk)
                      ]"
                    >
                      {{ ci.churn_risk }}
                    </span>
                  </td>
                </tr>
                <tr v-if="simulation.customer_impacts.length === 0">
                  <td colspan="6" class="px-4 py-6 text-center text-muted-foreground">No customer impact data</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Scenarios summary -->
          <div v-if="simulation.scenarios.length > 0" class="mt-6">
            <h3 class="text-sm font-semibold mb-3">Scenarios</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div
                v-for="sc in simulation.scenarios"
                :key="sc.id"
                :class="[
                  'rounded-lg border p-4',
                  sc.id === simulation.winning_scenario_id
                    ? 'border-primary bg-primary/5'
                    : 'bg-card'
                ]"
              >
                <div class="flex items-start justify-between mb-2">
                  <span class="text-sm font-medium">{{ sc.name }}</span>
                  <span
                    v-if="sc.id === simulation.winning_scenario_id"
                    class="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold"
                  >
                    Winner
                  </span>
                </div>
                <p v-if="sc.description" class="text-xs text-muted-foreground mb-2">{{ sc.description }}</p>
                <div v-if="sc.projected_margin_pct !== undefined" class="flex items-center gap-3 text-xs">
                  <span>Margin: <strong>{{ sc.projected_margin_pct }}%</strong></span>
                  <span v-if="sc.projected_revenue !== undefined">
                    Rev: <strong>{{ formatCurrency(sc.projected_revenue) }}</strong>
                  </span>
                </div>
                <div class="mt-2 space-y-0.5">
                  <div
                    v-for="(change, cIdx) in sc.changes"
                    :key="cIdx"
                    class="text-[11px] text-muted-foreground"
                  >
                    <span class="font-mono">{{ change.feature_key }}</span>
                    <span class="ml-1">
                      <template v-if="change.change_type === 'percentage_increase'">+{{ change.change_value }}%</template>
                      <template v-else-if="change.change_type === 'percentage_decrease'">-{{ change.change_value }}%</template>
                      <template v-else-if="change.change_type === 'flat_increase'">+${{ change.change_value }}</template>
                      <template v-else-if="change.change_type === 'flat_decrease'">-${{ change.change_value }}</template>
                      <template v-else-if="change.change_type === 'new_price'">= ${{ change.change_value }}</template>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

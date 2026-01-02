<script setup lang="ts">
/**
 * PricingSimulatorPanel - Fixed pricing simulation panel
 *
 * Displays current plan prices with editable proposed prices
 * and shows estimated impact of price changes
 */

import { ref, computed, watch } from 'vue'
import { Loader2, Calculator, Save, RotateCcw, TrendingUp, TrendingDown, Users } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input } from '@/components/ui'
import { useSimulation } from '@/composables/useSimulation'
import type { PricingModelConfig } from '@/types/simulation'

// =============================================================================
// PROPS & EMITS
// =============================================================================

export interface PlanPrice {
  planId: string
  planName: string
  currentPrice: number
  customerCount: number
  totalMrr: number
}

const props = defineProps<{
  plans: PlanPrice[]
}>()

const emit = defineEmits<{
  'simulation-complete': [results: unknown]
  'save-scenario': [name: string]
}>()

// =============================================================================
// STATE
// =============================================================================

const { isRunning, runPreviewAsync, currentResults, error } = useSimulation()

// Proposed prices - editable
const proposedPrices = ref<Record<string, number>>({})

// Initialize proposed prices from current
watch(() => props.plans, (plans) => {
  const newPrices: Record<string, number> = {}
  plans.forEach(plan => {
    if (!(plan.planId in proposedPrices.value)) {
      newPrices[plan.planId] = plan.currentPrice
    } else {
      newPrices[plan.planId] = proposedPrices.value[plan.planId] ?? plan.currentPrice
    }
  })
  proposedPrices.value = newPrices
}, { immediate: true })

// =============================================================================
// COMPUTED
// =============================================================================

const hasChanges = computed(() => {
  return props.plans.some(plan => {
    const proposed = proposedPrices.value[plan.planId] ?? plan.currentPrice
    return proposed !== plan.currentPrice
  })
})

// Calculate estimated impact for each plan
const planImpacts = computed(() => {
  return props.plans.map(plan => {
    const proposed = proposedPrices.value[plan.planId] ?? plan.currentPrice
    const priceDiff = proposed - plan.currentPrice
    const percentChange = plan.currentPrice > 0
      ? Math.round((priceDiff / plan.currentPrice) * 100)
      : 0

    // Estimate customer impact (simple elasticity model)
    // Higher price increase = more churn risk
    const churnRisk = percentChange > 0
      ? Math.min(Math.round(percentChange * 0.3), plan.customerCount)
      : 0

    const estimatedMrrChange = (priceDiff * plan.customerCount) - (churnRisk * proposed)

    return {
      planId: plan.planId,
      planName: plan.planName,
      currentPrice: plan.currentPrice,
      proposedPrice: proposed,
      priceDiff,
      percentChange,
      customerCount: plan.customerCount,
      estimatedChurn: churnRisk,
      estimatedMrrChange,
    }
  })
})

const totalImpact = computed(() => {
  const totalMrrChange = planImpacts.value.reduce((sum, p) => sum + p.estimatedMrrChange, 0)
  const totalChurn = planImpacts.value.reduce((sum, p) => sum + p.estimatedChurn, 0)
  return { mrrChange: totalMrrChange, customerChurn: totalChurn }
})

// =============================================================================
// METHODS
// =============================================================================

function updatePrice(planId: string, value: string) {
  const numValue = parseFloat(value) || 0
  proposedPrices.value[planId] = numValue
}

function resetPrices() {
  const newPrices: Record<string, number> = {}
  props.plans.forEach(plan => {
    newPrices[plan.planId] = plan.currentPrice
  })
  proposedPrices.value = newPrices
}

async function runSimulation() {
  const pricingModel: PricingModelConfig = {
    type: 'flat_rate',
    billingPeriod: 'monthly',
    growthRate: 0.05,
    // Include proposed prices in model config
    // The simulation engine will use these for calculations
  }

  try {
    const results = await runPreviewAsync({ pricingModel })
    emit('simulation-complete', results)
  } catch (e) {
    console.error('Simulation failed:', e)
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}
</script>

<template>
  <Card class="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-primary/10 rounded-lg">
            <Calculator class="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle class="text-lg">Pricing Simulator</CardTitle>
            <p class="text-sm text-muted-foreground">What if we change prices?</p>
          </div>
        </div>
        <Badge v-if="hasChanges" variant="secondary" class="animate-pulse">
          Changes pending
        </Badge>
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- Plans Table -->
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b text-sm text-muted-foreground">
              <th class="text-left py-2 font-medium">Plan</th>
              <th class="text-right py-2 font-medium">Current</th>
              <th class="text-right py-2 font-medium">Proposed</th>
              <th class="text-right py-2 font-medium">Impact</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="impact in planImpacts"
              :key="impact.planId"
              class="border-b last:border-0"
            >
              <td class="py-3">
                <div>
                  <span class="font-medium">{{ impact.planName }}</span>
                  <span class="text-xs text-muted-foreground ml-2">
                    {{ impact.customerCount }} customers
                  </span>
                </div>
              </td>
              <td class="py-3 text-right font-mono text-muted-foreground">
                {{ formatCurrency(impact.currentPrice) }}
              </td>
              <td class="py-3 text-right">
                <Input
                  type="number"
                  :model-value="impact.proposedPrice"
                  class="w-24 text-right font-mono ml-auto"
                  min="0"
                  step="1"
                  @update:model-value="updatePrice(impact.planId, String($event))"
                />
              </td>
              <td class="py-3 text-right">
                <div v-if="impact.percentChange !== 0" class="flex items-center justify-end gap-2">
                  <div class="text-right">
                    <div
                      class="text-sm font-medium flex items-center gap-1"
                      :class="impact.estimatedMrrChange >= 0 ? 'text-green-600' : 'text-red-600'"
                    >
                      <TrendingUp v-if="impact.estimatedMrrChange >= 0" class="h-3 w-3" />
                      <TrendingDown v-else class="h-3 w-3" />
                      {{ impact.estimatedMrrChange >= 0 ? '+' : '' }}{{ formatCurrency(impact.estimatedMrrChange) }} MRR
                    </div>
                    <div v-if="impact.estimatedChurn > 0" class="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                      <Users class="h-3 w-3" />
                      -{{ impact.estimatedChurn }} customers (est.)
                    </div>
                  </div>
                </div>
                <span v-else class="text-muted-foreground text-sm">No change</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Total Impact Summary -->
      <div
        v-if="hasChanges"
        class="flex items-center justify-between p-3 rounded-lg bg-muted/50"
      >
        <div class="flex items-center gap-4">
          <div>
            <span class="text-xs text-muted-foreground block">Estimated MRR Impact</span>
            <span
              class="text-lg font-bold"
              :class="totalImpact.mrrChange >= 0 ? 'text-green-600' : 'text-red-600'"
            >
              {{ totalImpact.mrrChange >= 0 ? '+' : '' }}{{ formatCurrency(totalImpact.mrrChange) }}/mo
            </span>
          </div>
          <div v-if="totalImpact.customerChurn > 0" class="border-l pl-4">
            <span class="text-xs text-muted-foreground block">Est. Customer Impact</span>
            <span class="text-lg font-bold text-amber-600">
              -{{ totalImpact.customerChurn }} customers
            </span>
          </div>
        </div>
      </div>

      <!-- Error Display -->
      <div
        v-if="error"
        class="p-3 rounded-lg bg-destructive/10 text-destructive text-sm"
      >
        {{ error.message }}
      </div>

      <!-- Actions -->
      <div class="flex gap-2 pt-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="!hasChanges || isRunning"
          @click="resetPrices"
        >
          <RotateCcw class="h-4 w-4 mr-1.5" />
          Reset
        </Button>
        <Button
          class="flex-1"
          :disabled="!hasChanges || isRunning"
          @click="runSimulation"
        >
          <Loader2 v-if="isRunning" class="h-4 w-4 mr-1.5 animate-spin" />
          <Calculator v-else class="h-4 w-4 mr-1.5" />
          {{ isRunning ? 'Running...' : 'Apply Simulation' }}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          :disabled="!currentResults"
          @click="$emit('save-scenario', 'New Scenario')"
        >
          <Save class="h-4 w-4 mr-1.5" />
          Save
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

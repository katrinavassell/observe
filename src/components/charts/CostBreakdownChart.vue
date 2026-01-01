<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertTriangle, Server, TrendingUp, TrendingDown, Minus, Download, Info } from 'lucide-vue-next'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui'
import type { ProviderCost } from '@/lib/pricing-analyzer'
import { toast } from 'vue-sonner'

const props = defineProps<{
  providers: ProviderCost[]
  totalCosts: number
  previousProviders?: ProviderCost[]
  previousTotalCosts?: number
}>()

// Track hovered provider for highlight effect
const hoveredProvider = ref<string | null>(null)

// Calculate period-over-period change for total costs
const totalCostsChange = computed(() => {
  if (!props.previousTotalCosts || props.previousTotalCosts === 0) return null
  const change = ((props.totalCosts - props.previousTotalCosts) / props.previousTotalCosts) * 100
  return {
    value: Math.round(change),
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  }
})

// Get previous amount for a provider
function getPreviousAmount(providerName: string): number | null {
  if (!props.previousProviders) return null
  const prev = props.previousProviders.find(p => p.name === providerName)
  return prev?.amount ?? null
}

// Calculate change for a provider
function getProviderChange(providerName: string, currentAmount: number): { value: number; direction: string } | null {
  const prevAmount = getPreviousAmount(providerName)
  if (prevAmount === null || prevAmount === 0) return null
  const change = ((currentAmount - prevAmount) / prevAmount) * 100
  return {
    value: Math.round(change),
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  }
}

// Export cost data as CSV
function exportCostData() {
  const headers = ['Provider', 'Amount', 'Percentage']
  const rows = props.providers.map(p => [p.name, p.amount.toString(), `${p.percentage}%`])
  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  link.setAttribute('download', `cost-breakdown-${new Date().toISOString().split('T')[0]}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  toast.success('Cost data exported', {
    description: 'CSV file downloaded successfully',
  })
}

// Concentration warning threshold (70%)
const CONCENTRATION_THRESHOLD = 70

// Check if any provider exceeds concentration threshold
const hasConcentrationWarning = computed(() => {
  return props.providers.some(p => p.percentage > CONCENTRATION_THRESHOLD)
})

// Get the dominant provider (if any)
const dominantProvider = computed(() => {
  return props.providers.find(p => p.percentage > CONCENTRATION_THRESHOLD)
})

// Format currency for display
function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`
  } else if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}K`
  }
  return `$${amount.toFixed(0)}`
}

// Get color for provider bar
function getProviderColor(index: number, percentage: number): string {
  if (percentage > CONCENTRATION_THRESHOLD) {
    return 'bg-amber-500'
  }
  const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-cyan-500']
  return colors[index % colors.length] || 'bg-gray-500'
}

// Get text color for provider
function getProviderTextColor(index: number, percentage: number): string {
  if (percentage > CONCENTRATION_THRESHOLD) {
    return 'text-amber-600 dark:text-amber-400'
  }
  const colors = ['text-blue-600 dark:text-blue-400', 'text-green-600 dark:text-green-400', 'text-purple-600 dark:text-purple-400', 'text-cyan-600 dark:text-cyan-400']
  return colors[index % colors.length] || 'text-gray-600 dark:text-gray-400'
}
</script>

<template>
  <Card>
    <CardHeader class="pb-2">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div class="flex items-center gap-2">
          <Server class="h-4 w-4 text-muted-foreground" />
          <CardTitle class="text-base font-semibold">Cost Breakdown by Provider</CardTitle>
          <Tooltip>
            <TooltipTrigger>
              <Info class="h-3.5 w-3.5 text-muted-foreground/60" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Breakdown of AI infrastructure costs by provider</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div class="flex items-center gap-2">
          <Tooltip v-if="hasConcentrationWarning">
            <TooltipTrigger>
              <Badge variant="secondary" class="bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                <AlertTriangle class="h-3 w-3 mr-1" />
                Concentration Risk
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {{ dominantProvider?.name }} accounts for {{ dominantProvider?.percentage }}% of costs.
              Consider diversifying to reduce vendor lock-in risk.
            </TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="sm" class="h-7 px-2" @click="exportCostData">
            <Download class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </CardHeader>
    <CardContent class="space-y-4">
      <!-- Provider Bars -->
      <div class="space-y-3">
        <Tooltip v-for="(provider, index) in providers" :key="provider.name">
          <TooltipTrigger class="w-full text-left">
            <div
              class="space-y-1.5 p-2 -mx-2 rounded-lg transition-colors cursor-default"
              :class="hoveredProvider === provider.name ? 'bg-muted/50' : 'hover:bg-muted/30'"
              @mouseenter="hoveredProvider = provider.name"
              @mouseleave="hoveredProvider = null"
            >
              <div class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2">
                  <span class="font-medium">{{ provider.name }}</span>
                  <Badge
                    v-if="provider.percentage > CONCENTRATION_THRESHOLD"
                    variant="secondary"
                    class="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
                  >
                    High
                  </Badge>
                  <!-- Change indicator -->
                  <span
                    v-if="getProviderChange(provider.name, provider.amount)"
                    class="flex items-center text-[10px]"
                    :class="{
                      'text-red-600': getProviderChange(provider.name, provider.amount)?.direction === 'up',
                      'text-green-600': getProviderChange(provider.name, provider.amount)?.direction === 'down',
                      'text-muted-foreground': getProviderChange(provider.name, provider.amount)?.direction === 'flat'
                    }"
                  >
                    <TrendingUp v-if="getProviderChange(provider.name, provider.amount)?.direction === 'up'" class="h-3 w-3 mr-0.5" />
                    <TrendingDown v-else-if="getProviderChange(provider.name, provider.amount)?.direction === 'down'" class="h-3 w-3 mr-0.5" />
                    <Minus v-else class="h-3 w-3 mr-0.5" />
                    {{ getProviderChange(provider.name, provider.amount)?.direction === 'flat' ? '0' : (getProviderChange(provider.name, provider.amount)?.direction === 'up' ? '+' : '') }}{{ getProviderChange(provider.name, provider.amount)?.value }}%
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="font-mono text-muted-foreground">
                    {{ formatCurrency(provider.amount) }}
                  </span>
                  <span :class="getProviderTextColor(index, provider.percentage)" class="font-semibold">
                    {{ provider.percentage }}%
                  </span>
                </div>
              </div>

              <!-- Progress Bar -->
              <div class="h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  :class="getProviderColor(index, provider.percentage)"
                  class="h-full rounded-full transition-all duration-500 ease-out"
                  :style="{ width: `${provider.percentage}%` }"
                ></div>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" class="max-w-xs">
            <div class="space-y-1">
              <p class="font-semibold">{{ provider.name }}</p>
              <p class="text-muted-foreground text-xs">
                {{ formatCurrency(provider.amount) }} ({{ provider.percentage }}% of total)
              </p>
              <p v-if="getPreviousAmount(provider.name) !== null" class="text-xs">
                Previous period: {{ formatCurrency(getPreviousAmount(provider.name) || 0) }}
              </p>
              <p v-if="provider.percentage > CONCENTRATION_THRESHOLD" class="text-amber-600 text-xs">
                ⚠️ High concentration - consider diversifying
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      <!-- Total -->
      <div class="pt-3 border-t border-border">
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">Total AI Costs</span>
          <div class="flex items-center gap-2">
            <span
              v-if="totalCostsChange"
              class="flex items-center text-xs"
              :class="{
                'text-red-600': totalCostsChange.direction === 'up',
                'text-green-600': totalCostsChange.direction === 'down',
                'text-muted-foreground': totalCostsChange.direction === 'flat'
              }"
            >
              <TrendingUp v-if="totalCostsChange.direction === 'up'" class="h-3 w-3 mr-0.5" />
              <TrendingDown v-else-if="totalCostsChange.direction === 'down'" class="h-3 w-3 mr-0.5" />
              {{ totalCostsChange.direction === 'up' ? '+' : '' }}{{ totalCostsChange.value }}%
            </span>
            <span class="font-semibold font-mono">{{ formatCurrency(totalCosts) }}</span>
          </div>
        </div>
      </div>

      <!-- Concentration Warning Message -->
      <div
        v-if="hasConcentrationWarning"
        class="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800"
      >
        <div class="flex items-start gap-2">
          <AlertTriangle class="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div class="text-sm">
            <p class="font-medium text-amber-800 dark:text-amber-200">
              Provider Concentration Warning
            </p>
            <p class="text-amber-700 dark:text-amber-300 mt-0.5">
              {{ dominantProvider?.name }} accounts for {{ dominantProvider?.percentage }}% of your AI costs.
              Consider diversifying providers to reduce vendor lock-in and negotiate better rates.
            </p>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

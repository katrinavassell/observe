<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Server } from 'lucide-vue-next'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui'
import type { ProviderCost } from '@/lib/pricing-analyzer'

const props = defineProps<{
  providers: ProviderCost[]
  totalCosts: number
}>()

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
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Server class="h-4 w-4 text-muted-foreground" />
          <CardTitle class="text-base font-semibold">Cost Breakdown by Provider</CardTitle>
        </div>
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
      </div>
    </CardHeader>
    <CardContent class="space-y-4">
      <!-- Provider Bars -->
      <div class="space-y-3">
        <div
          v-for="(provider, index) in providers"
          :key="provider.name"
          class="space-y-1.5"
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
              class="h-full rounded-full transition-all duration-500"
              :style="{ width: `${provider.percentage}%` }"
            ></div>
          </div>
        </div>
      </div>

      <!-- Total -->
      <div class="pt-3 border-t border-border">
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">Total AI Costs</span>
          <span class="font-semibold font-mono">{{ formatCurrency(totalCosts) }}</span>
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

<script setup lang="ts">
import { computed } from 'vue'
import { EyeOff, BarChart3, ExternalLink, Lightbulb, DollarSign, TrendingDown } from 'lucide-vue-next'
import {
  Card,
  CardContent,
  Button,
  Badge,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui'
import { toast } from 'vue-sonner'

const props = defineProps<{
  showEstimatedMargins?: boolean
  totalCosts?: number
  growthGap?: number
}>()

const emit = defineEmits<{
  (e: 'see-margins'): void
}>()

// Calculate potential savings from optimization
const potentialSavings = computed(() => {
  if (!props.totalCosts) return null
  // Estimate 15-25% savings from proper cost optimization
  const lowEstimate = Math.round(props.totalCosts * 0.15)
  const highEstimate = Math.round(props.totalCosts * 0.25)
  return { low: lowEstimate, high: highEstimate }
})

// Format currency
function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`
  } else if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}K`
  }
  return `$${amount.toFixed(0)}`
}

const blindSpots = [
  {
    title: 'True cost-to-serve per customer',
    description: 'You\'re allocating costs proportionally by revenue, not actual usage',
    icon: DollarSign,
  },
  {
    title: 'Which features drive costs',
    description: 'Some features may be 10x more expensive than others per request',
    icon: Lightbulb,
  },
  {
    title: 'Optimal pricing response',
    description: 'Should you raise prices, add usage limits, or optimize features?',
    icon: TrendingDown,
  }
]

function handleSeeMargins() {
  emit('see-margins')
}

function handleDesignPartner() {
  toast.info('Design Partner Program', {
    description: "We're looking for SaaS companies to help shape Observe. Email kat@observehq.dev to join.",
  })
}
</script>

<template>
  <Card class="border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
    <CardContent class="p-6">
      <div class="flex flex-col lg:flex-row gap-6">
        <!-- Left Section - Blind Spots -->
        <div class="flex-1">
          <div class="flex items-start gap-4">
            <!-- Icon -->
            <div class="p-2.5 bg-amber-100 dark:bg-amber-900/50 rounded-lg shrink-0">
              <EyeOff class="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>

            <!-- Content -->
            <div class="flex-1 space-y-4">
              <!-- Header -->
              <div>
                <h3 class="font-semibold text-amber-900 dark:text-amber-100 text-lg">
                  What you can't see
                </h3>
                <p class="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  These margins are estimates. Without feature-level cost tracking, you're flying blind.
                </p>
              </div>

              <!-- Blind Spots List -->
              <ul class="space-y-3">
                <li
                  v-for="(spot, index) in blindSpots"
                  :key="index"
                  class="flex items-start gap-3"
                >
                  <div class="w-6 h-6 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center shrink-0">
                    <component :is="spot.icon" class="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
                  </div>
                  <div>
                    <p class="font-medium text-amber-900 dark:text-amber-100 text-sm">
                      {{ spot.title }}
                    </p>
                    <p class="text-xs text-amber-700 dark:text-amber-300">
                      {{ spot.description }}
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Right Section - Potential Savings -->
        <div v-if="potentialSavings" class="lg:w-64 shrink-0">
          <div class="p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800">
            <div class="flex items-center gap-2 mb-2">
              <DollarSign class="h-4 w-4 text-green-600 dark:text-green-400" />
              <span class="text-sm font-semibold text-green-800 dark:text-green-200">
                Potential Savings
              </span>
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="secondary" class="text-[9px] bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300">
                    Est.
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Based on typical optimization gains of 15-25%</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <p class="text-2xl font-bold text-green-700 dark:text-green-300">
              {{ formatCurrency(potentialSavings.low) }} - {{ formatCurrency(potentialSavings.high) }}
            </p>
            <p class="text-xs text-green-600 dark:text-green-400 mt-1">
              per month with cost optimization
            </p>
          </div>
        </div>
      </div>

      <!-- CTA Section -->
      <div class="mt-6 pt-4 border-t border-amber-200 dark:border-amber-800">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <p class="text-xs text-amber-600 dark:text-amber-400">
            Observe tracks cost-to-serve at the feature level, giving you the data to make informed pricing decisions.
          </p>
          <div class="flex flex-wrap gap-3">
            <Button
              v-if="showEstimatedMargins"
              variant="default"
              size="sm"
              @click="handleSeeMargins"
            >
              <BarChart3 class="h-4 w-4 mr-1.5" />
              See Estimated Margins
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50"
              @click="handleDesignPartner"
            >
              <ExternalLink class="h-4 w-4 mr-1.5" />
              Become a Design Partner
            </Button>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

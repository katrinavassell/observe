<script setup lang="ts">
import { EyeOff, BarChart3, ExternalLink } from 'lucide-vue-next'
import {
  Card,
  CardContent,
  Button,
} from '@/components/ui'
import { toast } from 'vue-sonner'

defineProps<{
  showEstimatedMargins?: boolean
}>()

const emit = defineEmits<{
  (e: 'see-margins'): void
}>()

const blindSpots = [
  {
    title: 'True cost-to-serve per customer',
    description: 'You\'re allocating costs proportionally by revenue, not actual usage'
  },
  {
    title: 'Which features drive costs',
    description: 'Some features may be 10x more expensive than others per request'
  },
  {
    title: 'Optimal pricing response',
    description: 'Should you raise prices, add usage limits, or optimize features?'
  }
]

function handleSeeMargins() {
  emit('see-margins')
}

function handleInstallTanso() {
  toast.info('Tanso Core Installation', {
    description: 'Contact us at kat@tansohq.com to get started with Tanso Core for per-customer cost tracking.',
  })
}
</script>

<template>
  <Card class="border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
    <CardContent class="p-6">
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
              <div class="w-5 h-5 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center shrink-0 mt-0.5">
                <span class="text-xs font-bold text-amber-700 dark:text-amber-300">{{ index + 1 }}</span>
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

          <!-- CTA Buttons -->
          <div class="flex flex-wrap gap-3 pt-2">
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
              @click="handleInstallTanso"
            >
              <ExternalLink class="h-4 w-4 mr-1.5" />
              Install Tanso Core
            </Button>
          </div>

          <!-- Bottom Text -->
          <p class="text-xs text-amber-600 dark:text-amber-400 pt-1">
            Tanso Core tracks cost-to-serve at the feature level, giving you the data to make informed pricing decisions.
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

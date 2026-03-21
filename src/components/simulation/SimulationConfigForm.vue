<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Play,
  Calculator,
  TrendingUp,
  DollarSign,
  Users,
  Loader2,
} from 'lucide-vue-next'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Input,
} from '@/components/ui'
import type { PricingModelConfig } from '@/types/simulation'

const props = defineProps<{
  isLoading: boolean
  hasRevenueData: boolean
  hasCostData: boolean
  hasUsageData: boolean
}>()

const emit = defineEmits<{
  run: [config: { scenarioName: string; scenarioDescription?: string; isBaseline: boolean; pricingModel: PricingModelConfig }]
  cancel: []
}>()

const scenarioName = ref('')
const scenarioDescription = ref('')
const isBaseline = ref(false)

const pricingModel = ref<'per_seat' | 'usage_based' | 'hybrid' | 'flat_rate'>('usage_based')
const billingPeriod = ref<'monthly' | 'quarterly' | 'annual'>('monthly')
const seatPrice = ref(50)
const monthlyFee = ref(100)
const usagePricePerUnit = ref(0.01)
const freeTier = ref(1000)
const growthRate = ref(0.05)

const canRun = computed(() =>
  (props.hasRevenueData || props.hasCostData || props.hasUsageData) && scenarioName.value.trim()
)

const models = [
  { id: 'per_seat' as const, label: 'Per Seat', icon: Users },
  { id: 'usage_based' as const, label: 'Usage-Based', icon: TrendingUp },
  { id: 'hybrid' as const, label: 'Hybrid', icon: Calculator },
  { id: 'flat_rate' as const, label: 'Flat Rate', icon: DollarSign },
]

function handleRun() {
  emit('run', {
    scenarioName: scenarioName.value.trim(),
    scenarioDescription: scenarioDescription.value.trim() || undefined,
    isBaseline: isBaseline.value,
    pricingModel: {
      type: pricingModel.value,
      billingPeriod: billingPeriod.value,
      seatPrice: seatPrice.value,
      monthlyFee: monthlyFee.value,
      usagePricePerUnit: usagePricePerUnit.value,
      freeTier: freeTier.value,
      growthRate: growthRate.value,
    },
  })
}

function reset() {
  scenarioName.value = ''
  scenarioDescription.value = ''
  isBaseline.value = false
}

defineExpose({ reset })
</script>

<template>
  <div class="space-y-6">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <!-- Scenario Info -->
      <Card class="md:col-span-2">
        <CardHeader>
          <CardTitle class="text-base">Scenario Information</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <label for="scenario-name" class="text-sm font-medium">Scenario Name</label>
            <Input
              id="scenario-name"
              v-model="scenarioName"
              placeholder="e.g., Usage-Based Pricing Q1"
              :disabled="isLoading"
            />
          </div>
          <div class="space-y-2">
            <label for="scenario-desc" class="text-sm font-medium">Description (Optional)</label>
            <Input
              id="scenario-desc"
              v-model="scenarioDescription"
              placeholder="Describe this pricing scenario..."
              :disabled="isLoading"
            />
          </div>
          <div class="flex items-center space-x-2">
            <input
              type="checkbox"
              id="is-baseline"
              v-model="isBaseline"
              class="rounded border-gray-300"
              :disabled="isLoading"
            />
            <label for="is-baseline" class="text-sm">
              Set as baseline scenario (for comparison)
            </label>
          </div>
        </CardContent>
      </Card>

      <!-- Data Sources Summary -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base">Available Data</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm">Revenue Data</span>
            <Badge :variant="hasRevenueData ? 'default' : 'outline'">
              {{ hasRevenueData ? 'Available' : 'Missing' }}
            </Badge>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm">Cost Data</span>
            <Badge :variant="hasCostData ? 'default' : 'outline'">
              {{ hasCostData ? 'Available' : 'Missing' }}
            </Badge>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm">Usage Data</span>
            <Badge :variant="hasUsageData ? 'default' : 'outline'">
              {{ hasUsageData ? 'Available' : 'Missing' }}
            </Badge>
          </div>
          <div class="pt-4 border-t">
            <p class="text-xs text-muted-foreground">
              Simulation quality depends on available data types.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Pricing Model Selection -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base">Pricing Model</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Button
            v-for="model in models"
            :key="model.id"
            :variant="pricingModel === model.id ? 'default' : 'outline'"
            class="flex flex-col h-24 items-center justify-center"
            @click="pricingModel = model.id"
            :disabled="isLoading"
          >
            <component :is="model.icon" class="h-6 w-6 mb-2" />
            <span class="text-sm">{{ model.label }}</span>
          </Button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">Billing Period</label>
              <select
                v-model="billingPeriod"
                :disabled="isLoading"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>

            <div v-if="pricingModel === 'per_seat' || pricingModel === 'hybrid'" class="space-y-2">
              <label class="text-sm font-medium">
                {{ pricingModel === 'per_seat' ? 'Price per Seat' : 'Seat Component Price' }}
              </label>
              <div class="flex items-center">
                <span class="mr-2">$</span>
                <Input v-model.number="seatPrice" type="number" min="0" step="5" :disabled="isLoading" />
              </div>
            </div>

            <div v-if="pricingModel === 'flat_rate'" class="space-y-2">
              <label class="text-sm font-medium">Monthly Fee</label>
              <div class="flex items-center">
                <span class="mr-2">$</span>
                <Input v-model.number="monthlyFee" type="number" min="0" step="10" :disabled="isLoading" />
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <div v-if="pricingModel === 'usage_based' || pricingModel === 'hybrid'" class="space-y-2">
              <label class="text-sm font-medium">
                {{ pricingModel === 'usage_based' ? 'Price per Unit' : 'Usage Component Price' }}
              </label>
              <div class="flex items-center">
                <span class="mr-2">$</span>
                <Input v-model.number="usagePricePerUnit" type="number" min="0" step="0.001" :disabled="isLoading" />
                <span class="ml-2 text-sm text-muted-foreground">per unit</span>
              </div>
            </div>

            <div v-if="pricingModel === 'usage_based' || pricingModel === 'hybrid'" class="space-y-2">
              <label class="text-sm font-medium">Free Tier (Units)</label>
              <Input v-model.number="freeTier" type="number" min="0" step="100" :disabled="isLoading" />
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium">Monthly Growth Rate</label>
              <div class="flex items-center">
                <Input v-model.number="growthRate" type="number" min="0" max="1" step="0.01" :disabled="isLoading" />
                <span class="ml-2 text-sm text-muted-foreground">({{ (growthRate * 100).toFixed(1) }}%)</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Footer -->
    <div class="flex justify-end gap-3 pt-4 border-t">
      <Button variant="outline" @click="emit('cancel')" :disabled="isLoading">
        Cancel
      </Button>
      <Button @click="handleRun" :disabled="!canRun || isLoading">
        <Loader2 v-if="isLoading" class="h-4 w-4 mr-2 animate-spin" />
        <Play v-else class="h-4 w-4 mr-2" />
        {{ isLoading ? 'Running Simulation...' : 'Run Simulation' }}
      </Button>
    </div>
  </div>
</template>

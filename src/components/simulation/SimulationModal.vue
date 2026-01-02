<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  Play,
  Calculator,
  BarChart3,
  TrendingUp,
  DollarSign,
  Users,
  Loader2,
  X,
} from 'lucide-vue-next'
import { useSimulation } from '@/composables/useSimulation'
import { useDataMode } from '@/composables/useDataMode'
import SimulationResultsView from './SimulationResultsView.vue'
import type { PricingModelConfig } from '@/types/simulation'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  scenarioCreated: []
}>()

// Use simulation composable
const {
  runSimulationAsync,
  isRunning,
  progressMessage,
  currentResults,
  clearResults,
} = useSimulation()

// Use data mode to check data availability
const { hasRevenue, hasCosts, hasUsage } = useDataMode()

// Simulation configuration
const scenarioName = ref('')
const scenarioDescription = ref('')
const isBaseline = ref(false)
const isLoading = ref(false)
const isRerunning = ref(false)
const activeTab = ref<'configure' | 'results'>('configure')

// Pricing model options
const pricingModel = ref<'per_seat' | 'usage_based' | 'hybrid' | 'flat_rate'>('usage_based')
const billingPeriod = ref<'monthly' | 'quarterly' | 'annual'>('monthly')

// Pricing parameters
const seatPrice = ref(50)
const monthlyFee = ref(100)
const usagePricePerUnit = ref(0.01)
const freeTier = ref(1000)
const growthRate = ref(0.05) // 5% monthly growth

// Results - use currentResults from composable
const simulationResults = computed(() => currentResults.value)

// Data availability checks
const hasRevenueData = computed(() => hasRevenue.value)
const hasCostData = computed(() => hasCosts.value)
const hasUsageData = computed(() => hasUsage.value)

const canRunSimulation = computed(() => {
  return hasRevenueData.value || hasCostData.value || hasUsageData.value
})

// Watch for modal close to reset
watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    resetForm()
  }
})

async function runSimulation() {
  if (!canRunSimulation.value) {
    toast.error('Need at least one data source (revenue, cost, or usage)')
    return
  }

  if (!scenarioName.value.trim()) {
    toast.error('Please enter a scenario name')
    return
  }

  isLoading.value = true

  try {
    // Build pricing model config
    const pricingModelConfig: PricingModelConfig = {
      type: pricingModel.value,
      billingPeriod: billingPeriod.value,
      seatPrice: seatPrice.value,
      monthlyFee: monthlyFee.value,
      usagePricePerUnit: usagePricePerUnit.value,
      freeTier: freeTier.value,
      growthRate: growthRate.value,
    }

    // Call the simulation engine via Edge Function
    await runSimulationAsync({
      scenarioName: scenarioName.value.trim(),
      scenarioDescription: scenarioDescription.value.trim() || undefined,
      isBaseline: isBaseline.value,
      pricingModel: pricingModelConfig,
    })

    toast.success('Simulation completed and scenario saved!')
    activeTab.value = 'results'
  } catch (error: any) {
    console.error('Simulation error:', error)
    toast.error(error?.message || 'Failed to run simulation')
  } finally {
    isLoading.value = false
  }
}

function resetForm() {
  scenarioName.value = ''
  scenarioDescription.value = ''
  isBaseline.value = false
  clearResults()
  activeTab.value = 'configure'
}

function handleClose() {
  resetForm()
  emit('close')
}

function handleScenarioCreated() {
  emit('scenarioCreated')
  resetForm()
  emit('close')
}

function handleRerun() {
  // For now, just re-run with same config
  runSimulation()
}
</script>

<template>
  <!-- Modal Overlay -->
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center"
      >
        <!-- Backdrop -->
        <div
          class="absolute inset-0 bg-black/50"
          @click="handleClose"
        />

        <!-- Modal Content -->
        <div class="relative bg-background rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto mx-4 z-10">
          <!-- Header -->
          <div class="sticky top-0 bg-background border-b px-6 py-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Calculator class="h-5 w-5" />
              <h2 class="text-lg font-semibold">Run Pricing Simulation</h2>
            </div>
            <Button variant="ghost" size="sm" @click="handleClose">
              <X class="h-4 w-4" />
            </Button>
          </div>

          <!-- Body -->
          <div class="p-6">
            <Tabs v-model="activeTab" class="w-full">
              <TabsList class="grid grid-cols-2 mb-6">
                <TabsTrigger value="configure" class="flex items-center gap-2">
                  <Calculator class="h-4 w-4" />
                  Configure
                </TabsTrigger>
                <TabsTrigger value="results" class="flex items-center gap-2" :disabled="!simulationResults">
                  <BarChart3 class="h-4 w-4" />
                  Results
                </TabsTrigger>
              </TabsList>

              <!-- Configuration Tab -->
              <TabsContent value="configure" class="space-y-6">
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
                        v-for="model in [
                          { id: 'per_seat', label: 'Per Seat', icon: Users },
                          { id: 'usage_based', label: 'Usage-Based', icon: TrendingUp },
                          { id: 'hybrid', label: 'Hybrid', icon: Calculator },
                          { id: 'flat_rate', label: 'Flat Rate', icon: DollarSign }
                        ] as const"
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
                      <!-- Model-specific parameters -->
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
                            <Input
                              v-model.number="seatPrice"
                              type="number"
                              min="0"
                              step="5"
                              :disabled="isLoading"
                            />
                          </div>
                        </div>

                        <div v-if="pricingModel === 'flat_rate'" class="space-y-2">
                          <label class="text-sm font-medium">Monthly Fee</label>
                          <div class="flex items-center">
                            <span class="mr-2">$</span>
                            <Input
                              v-model.number="monthlyFee"
                              type="number"
                              min="0"
                              step="10"
                              :disabled="isLoading"
                            />
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
                            <Input
                              v-model.number="usagePricePerUnit"
                              type="number"
                              min="0"
                              step="0.001"
                              :disabled="isLoading"
                            />
                            <span class="ml-2 text-sm text-muted-foreground">per unit</span>
                          </div>
                        </div>

                        <div v-if="pricingModel === 'usage_based' || pricingModel === 'hybrid'" class="space-y-2">
                          <label class="text-sm font-medium">Free Tier (Units)</label>
                          <Input
                            v-model.number="freeTier"
                            type="number"
                            min="0"
                            step="100"
                            :disabled="isLoading"
                          />
                        </div>

                        <div class="space-y-2">
                          <label class="text-sm font-medium">Monthly Growth Rate</label>
                          <div class="flex items-center">
                            <Input
                              v-model.number="growthRate"
                              type="number"
                              min="0"
                              max="1"
                              step="0.01"
                              :disabled="isLoading"
                            />
                            <span class="ml-2 text-sm text-muted-foreground">({{ (growthRate * 100).toFixed(1) }}%)</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <!-- Footer -->
                <div class="flex justify-end gap-3 pt-4 border-t">
                  <Button variant="outline" @click="handleClose" :disabled="isLoading">
                    Cancel
                  </Button>
                  <Button
                    @click="runSimulation"
                    :disabled="!canRunSimulation || !scenarioName.trim() || isLoading"
                  >
                    <Loader2 v-if="isLoading" class="h-4 w-4 mr-2 animate-spin" />
                    <Play v-else class="h-4 w-4 mr-2" />
                    {{ isLoading ? 'Running Simulation...' : 'Run Simulation' }}
                  </Button>
                </div>
              </TabsContent>

              <!-- Results Tab -->
              <TabsContent value="results" class="space-y-6">
                <!-- Loading state during simulation -->
                <div v-if="isRunning || isLoading" class="flex flex-col items-center justify-center py-12">
                  <Loader2 class="h-10 w-10 animate-spin text-primary mb-4" />
                  <p class="text-muted-foreground">{{ progressMessage || 'Running simulation...' }}</p>
                </div>

                <!-- Results view when we have data -->
                <div v-else-if="simulationResults">
                  <SimulationResultsView
                    :results="simulationResults"
                    :scenario-name="scenarioName || 'Simulation Results'"
                    :is-rerunning="isRerunning"
                    @rerun="handleRerun"
                    @back="activeTab = 'configure'"
                  />
                </div>

                <!-- No results state -->
                <div v-else class="flex flex-col items-center justify-center py-12">
                  <BarChart3 class="h-10 w-10 text-muted-foreground mb-4" />
                  <p class="text-muted-foreground">No simulation results yet</p>
                  <Button variant="outline" class="mt-4" @click="activeTab = 'configure'">
                    Configure & Run Simulation
                  </Button>
                </div>

                <div v-if="simulationResults && !isRunning" class="flex justify-end gap-3 pt-4 border-t">
                  <Button variant="outline" @click="activeTab = 'configure'">
                    Back to Configuration
                  </Button>
                  <Button @click="handleScenarioCreated">
                    Done
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { toast } from 'vue-sonner'
import { Calculator, BarChart3, Loader2, X } from 'lucide-vue-next'
import { Button, Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui'
import { useSimulation } from '@/composables/useSimulation'
import { useDataMode } from '@/composables/useDataMode'
import SimulationConfigForm from './SimulationConfigForm.vue'
import SimulationResultsView from './SimulationResultsView.vue'
import type { PricingModelConfig } from '@/types/simulation'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; scenarioCreated: [] }>()

const { runSimulationAsync, isRunning, progressMessage, currentResults, clearResults } = useSimulation()
const { hasRevenue, hasCosts, hasUsage } = useDataMode()

const activeTab = ref<'configure' | 'results'>('configure')
const isLoading = ref(false)
const configForm = ref<InstanceType<typeof SimulationConfigForm> | null>(null)

const simulationResults = computed(() => currentResults.value)

watch(() => props.open, (isOpen) => {
  if (!isOpen) reset()
})

async function handleRun(config: {
  scenarioName: string
  scenarioDescription?: string
  isBaseline: boolean
  pricingModel: PricingModelConfig
}) {
  isLoading.value = true
  try {
    await runSimulationAsync({
      scenarioName: config.scenarioName,
      scenarioDescription: config.scenarioDescription,
      isBaseline: config.isBaseline,
      pricingModel: config.pricingModel,
    })
    toast.success('Simulation completed and scenario saved!')
    activeTab.value = 'results'
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to run simulation'
    toast.error(message)
  } finally {
    isLoading.value = false
  }
}

function reset() {
  clearResults()
  activeTab.value = 'configure'
  configForm.value?.reset()
}

function handleClose() {
  reset()
  emit('close')
}

function handleRerun() {
  configForm.value?.reset()
  activeTab.value = 'configure'
}

function handleDone() {
  emit('scenarioCreated')
  reset()
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/50" @click="handleClose" />
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

              <TabsContent value="configure">
                <SimulationConfigForm
                  ref="configForm"
                  :is-loading="isLoading"
                  :has-revenue-data="hasRevenue"
                  :has-cost-data="hasCosts"
                  :has-usage-data="hasUsage"
                  @run="handleRun"
                  @cancel="handleClose"
                />
              </TabsContent>

              <TabsContent value="results" class="space-y-6">
                <div v-if="isRunning || isLoading" class="flex flex-col items-center justify-center py-12">
                  <Loader2 class="h-10 w-10 animate-spin text-primary mb-4" />
                  <p class="text-muted-foreground">{{ progressMessage || 'Running simulation...' }}</p>
                </div>

                <SimulationResultsView
                  v-else-if="simulationResults"
                  :results="simulationResults"
                  :scenario-name="'Simulation Results'"
                  @rerun="handleRerun"
                  @back="activeTab = 'configure'"
                />

                <div v-else class="flex flex-col items-center justify-center py-12">
                  <BarChart3 class="h-10 w-10 text-muted-foreground mb-4" />
                  <p class="text-muted-foreground">No simulation results yet</p>
                  <Button variant="outline" class="mt-4" @click="activeTab = 'configure'">
                    Configure & Run Simulation
                  </Button>
                </div>

                <div v-if="simulationResults && !isRunning" class="flex justify-end gap-3 pt-4 border-t">
                  <Button variant="outline" @click="activeTab = 'configure'">Back to Configuration</Button>
                  <Button @click="handleDone">Done</Button>
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

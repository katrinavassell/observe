<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { getFeatures, createSimulation, updateSimulation } from '@/lib/api'
import type { PricingChangeType, SimulationScenario } from '@/types/simulation'
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Check,
  Play,
  Loader2,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const router = useRouter()
const queryClient = useQueryClient()

// Step state
const step = ref(1)
const totalSteps = 3

// Step 1: Define
const simName = ref('')
const dateFrom = ref('')
const dateTo = ref('')

// Step 2: Scenarios
interface ScenarioForm {
  id: string
  name: string
  description: string
  changes: Array<{
    feature_key: string
    change_type: PricingChangeType
    change_value: number
  }>
}

const scenarios = ref<ScenarioForm[]>([
  {
    id: 'sc-' + Date.now(),
    name: '',
    description: '',
    changes: [{ feature_key: '', change_type: 'percentage_increase', change_value: 10 }],
  },
])

// Fetch features for the dropdown
const { data: features } = useQuery({
  queryKey: ['features'],
  queryFn: getFeatures,
})

const featureKeys = computed(() => {
  if (!features.value) return []
  return features.value.map(f => f.feature_key)
})

const changeTypeOptions: Array<{ value: PricingChangeType; label: string }> = [
  { value: 'percentage_increase', label: '% Increase' },
  { value: 'percentage_decrease', label: '% Decrease' },
  { value: 'flat_increase', label: 'Flat Increase ($)' },
  { value: 'flat_decrease', label: 'Flat Decrease ($)' },
  { value: 'new_price', label: 'New Price ($)' },
]

function addScenario() {
  scenarios.value.push({
    id: 'sc-' + Date.now() + '-' + scenarios.value.length,
    name: '',
    description: '',
    changes: [{ feature_key: '', change_type: 'percentage_increase', change_value: 10 }],
  })
}

function removeScenario(idx: number) {
  if (scenarios.value.length > 1) {
    scenarios.value.splice(idx, 1)
  }
}

function addChange(scenarioIdx: number) {
  scenarios.value[scenarioIdx].changes.push({
    feature_key: '',
    change_type: 'percentage_increase',
    change_value: 10,
  })
}

function removeChange(scenarioIdx: number, changeIdx: number) {
  if (scenarios.value[scenarioIdx].changes.length > 1) {
    scenarios.value[scenarioIdx].changes.splice(changeIdx, 1)
  }
}

// Validation
const canProceedStep1 = computed(() => simName.value.trim().length > 0)
const canProceedStep2 = computed(() => {
  return scenarios.value.every(s =>
    s.name.trim().length > 0 &&
    s.changes.every(c => c.feature_key && c.change_value > 0)
  )
})

function nextStep() {
  if (step.value < totalSteps) step.value++
}

function prevStep() {
  if (step.value > 1) step.value--
}

// Submit
const isSubmitting = ref(false)

const createMutation = useMutation({
  mutationFn: (data: { name: string; scenarios: SimulationScenario[]; time_range?: { start: string; end: string } }) => createSimulation(data),
})

const runMutation = useMutation({
  mutationFn: (data: { id: string; scenarios: SimulationScenario[] }) =>
    updateSimulation(data.id, { status: 'running' as const, scenarios: data.scenarios } as Record<string, unknown>),
})

async function runSimulation() {
  isSubmitting.value = true
  try {
    const scenarioData: SimulationScenario[] = scenarios.value.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      changes: s.changes.filter(c => c.feature_key),
    }))

    const createData: { name: string; scenarios: SimulationScenario[]; time_range?: { start: string; end: string } } = {
      name: simName.value.trim(),
      scenarios: scenarioData,
    }
    if (dateFrom.value && dateTo.value) {
      createData.time_range = { start: dateFrom.value, end: dateTo.value }
    }

    const sim = await createMutation.mutateAsync(createData)

    await runMutation.mutateAsync({
      id: sim.id,
      scenarios: scenarioData,
    })

    queryClient.invalidateQueries({ queryKey: ['simulations'] })
    toast.success('Simulation completed')
    router.push(`/simulations/${sim.id}`)
  } catch (error) {
    toast.error('Failed to run simulation')
    console.error(error)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <!-- Header -->
    <div>
      <button
        class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"
        @click="router.push('/simulations')"
      >
        <ArrowLeft class="h-3.5 w-3.5" /> Back to Simulations
      </button>
      <h1 class="text-2xl font-semibold tracking-tight">New Simulation</h1>
      <p class="text-sm text-muted-foreground mt-1">Model the impact of pricing changes before rolling them out</p>
    </div>

    <!-- Step indicator -->
    <div class="flex items-center gap-2">
      <template v-for="s in totalSteps" :key="s">
        <div
          :class="[
            'flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold border-2 transition-colors',
            s < step ? 'bg-primary border-primary text-primary-foreground' :
            s === step ? 'border-primary text-primary' :
            'border-border text-muted-foreground'
          ]"
        >
          <Check v-if="s < step" class="h-4 w-4" />
          <span v-else>{{ s }}</span>
        </div>
        <div
          v-if="s < totalSteps"
          :class="[
            'flex-1 h-0.5 rounded-full',
            s < step ? 'bg-primary' : 'bg-border'
          ]"
        />
      </template>
    </div>

    <div class="text-sm font-medium text-muted-foreground">
      Step {{ step }}: {{ step === 1 ? 'Define' : step === 2 ? 'Scenarios' : 'Review & Run' }}
    </div>

    <!-- Step 1: Define -->
    <div v-if="step === 1" class="space-y-4">
      <div class="rounded-lg border bg-card p-5 space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1.5">Simulation Name</label>
          <input
            v-model="simName"
            type="text"
            placeholder="e.g. API Pricing Optimization"
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium mb-1.5">Date From (optional)</label>
            <input
              v-model="dateFrom"
              type="date"
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1.5">Date To (optional)</label>
            <input
              v-model="dateTo"
              type="date"
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Step 2: Scenarios -->
    <div v-if="step === 2" class="space-y-4">
      <div
        v-for="(scenario, sIdx) in scenarios"
        :key="scenario.id"
        class="rounded-lg border bg-card p-5 space-y-4"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold">Scenario {{ sIdx + 1 }}</h3>
          <button
            v-if="scenarios.length > 1"
            class="text-muted-foreground hover:text-destructive transition-colors"
            @click="removeScenario(sIdx)"
          >
            <Trash2 class="h-4 w-4" />
          </button>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-muted-foreground mb-1">Name</label>
            <input
              v-model="scenario.name"
              type="text"
              placeholder="e.g. Conservative (+10%)"
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-muted-foreground mb-1">Description</label>
            <input
              v-model="scenario.description"
              type="text"
              placeholder="Optional description"
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div class="space-y-2">
          <label class="block text-xs font-medium text-muted-foreground">Pricing Changes</label>
          <div
            v-for="(change, cIdx) in scenario.changes"
            :key="cIdx"
            class="flex items-center gap-2"
          >
            <select
              v-model="change.feature_key"
              class="flex-1 rounded-md border bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select feature...</option>
              <option v-for="fk in featureKeys" :key="fk" :value="fk">{{ fk }}</option>
            </select>

            <select
              v-model="change.change_type"
              class="w-36 rounded-md border bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option v-for="opt in changeTypeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>

            <input
              v-model.number="change.change_value"
              type="number"
              min="0"
              step="0.01"
              class="w-24 rounded-md border bg-background px-2.5 py-2 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
            />

            <button
              v-if="scenario.changes.length > 1"
              class="text-muted-foreground hover:text-destructive shrink-0"
              @click="removeChange(sIdx, cIdx)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            @click="addChange(sIdx)"
          >
            <Plus class="h-3 w-3" /> Add change
          </button>
        </div>
      </div>

      <button
        class="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        @click="addScenario"
      >
        <Plus class="h-4 w-4" /> Add Scenario
      </button>
    </div>

    <!-- Step 3: Review & Run -->
    <div v-if="step === 3" class="space-y-4">
      <div class="rounded-lg border bg-card p-5 space-y-4">
        <div>
          <div class="text-xs text-muted-foreground mb-1">Simulation Name</div>
          <div class="font-semibold">{{ simName }}</div>
        </div>

        <div v-if="dateFrom || dateTo" class="flex gap-4">
          <div v-if="dateFrom">
            <div class="text-xs text-muted-foreground mb-1">From</div>
            <div class="text-sm">{{ dateFrom }}</div>
          </div>
          <div v-if="dateTo">
            <div class="text-xs text-muted-foreground mb-1">To</div>
            <div class="text-sm">{{ dateTo }}</div>
          </div>
        </div>

        <div class="border-t pt-4">
          <div class="text-xs text-muted-foreground mb-3">
            {{ scenarios.length }} Scenario{{ scenarios.length !== 1 ? 's' : '' }}
          </div>
          <div class="space-y-3">
            <div
              v-for="(scenario, sIdx) in scenarios"
              :key="scenario.id"
              class="rounded-md bg-muted/30 border p-3"
            >
              <div class="font-medium text-sm">{{ scenario.name || `Scenario ${sIdx + 1}` }}</div>
              <div v-if="scenario.description" class="text-xs text-muted-foreground mt-0.5">
                {{ scenario.description }}
              </div>
              <div class="mt-2 space-y-1">
                <div
                  v-for="(change, cIdx) in scenario.changes.filter(c => c.feature_key)"
                  :key="cIdx"
                  class="text-xs text-muted-foreground"
                >
                  <span class="font-mono bg-muted px-1 py-0.5 rounded text-foreground">{{ change.feature_key }}</span>
                  <span class="ml-1">
                    <template v-if="change.change_type === 'percentage_increase'">+{{ change.change_value }}%</template>
                    <template v-else-if="change.change_type === 'percentage_decrease'">-{{ change.change_value }}%</template>
                    <template v-else-if="change.change_type === 'flat_increase'">+${{ change.change_value }}</template>
                    <template v-else-if="change.change_type === 'flat_decrease'">-${{ change.change_value }}</template>
                    <template v-else-if="change.change_type === 'new_price'">new price: ${{ change.change_value }}</template>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Navigation buttons -->
    <div class="flex items-center justify-between pt-2">
      <button
        v-if="step > 1"
        class="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
        @click="prevStep"
      >
        <ArrowLeft class="h-4 w-4" /> Back
      </button>
      <div v-else />

      <button
        v-if="step < totalSteps"
        :disabled="(step === 1 && !canProceedStep1) || (step === 2 && !canProceedStep2)"
        class="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
        @click="nextStep"
      >
        Next <ArrowRight class="h-4 w-4" />
      </button>

      <button
        v-if="step === totalSteps"
        :disabled="isSubmitting"
        class="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        @click="runSimulation"
      >
        <Loader2 v-if="isSubmitting" class="h-4 w-4 animate-spin" />
        <Play v-else class="h-4 w-4" />
        {{ isSubmitting ? 'Running...' : 'Run Simulation' }}
      </button>
    </div>
  </div>
</template>

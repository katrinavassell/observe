<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { getFeatures, createSimulation, updateSimulation, getUsageLimits, suggestSimulation } from '@/lib/api'
import type { PricingChangeType, SimulationScenario } from '@/types/simulation'
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Check,
  Play,
  Loader2,
  Sparkles,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button, Input, Select, Label, Card, CardContent, Badge } from '@/components/ui'

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

// Fetch usage limits
const { data: usageLimits } = useQuery({
  queryKey: ['usage-limits'],
  queryFn: getUsageLimits,
})

const simulationsAllowed = computed(() => {
  if (!usageLimits.value?.configured) return true
  return usageLimits.value.simulations?.allowed !== false
})

const simulationsUsage = computed(() => {
  if (!usageLimits.value?.configured) return null
  return usageLimits.value.simulations?.usage ?? null
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

// AI Suggest
const isSuggesting = ref(false)
const suggestRationale = ref('')

async function handleSuggest() {
  isSuggesting.value = true
  suggestRationale.value = ''
  try {
    const suggestion = await suggestSimulation()

    // Pre-fill the wizard
    simName.value = suggestion.name
    suggestRationale.value = suggestion.rationale
    scenarios.value = suggestion.scenarios.map((s, i) => ({
      id: 'sc-ai-' + Date.now() + '-' + i,
      name: s.name,
      description: s.description,
      changes: s.changes.map(c => ({
        feature_key: c.feature_key,
        change_type: c.change_type as PricingChangeType,
        change_value: c.change_value,
      })),
    }))

    // Jump to step 2 so they can see the pre-filled scenarios
    step.value = 2
    toast.success('AI suggested scenarios are ready to review')
  } catch (error: any) {
    toast.error(error?.message || 'Failed to generate suggestion')
    console.error(error)
  } finally {
    isSuggesting.value = false
  }
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
  } catch (error: any) {
    if (error?.message?.includes('403')) {
      toast.error('Simulation limit reached. Upgrade to create more simulations.')
      queryClient.invalidateQueries({ queryKey: ['usage-limits'] })
    } else {
      toast.error('Failed to run simulation')
    }
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
      <Button
        variant="ghost"
        size="sm"
        class="mb-3 gap-1.5 text-muted-foreground"
        @click="router.push('/simulations')"
      >
        <ArrowLeft class="h-3.5 w-3.5" /> Back to Simulations
      </Button>
      <h1 class="text-2xl font-semibold tracking-tight">New Simulation</h1>
      <p class="text-sm text-muted-foreground mt-1">Model the impact of pricing changes before rolling them out</p>
      <div v-if="simulationsUsage" class="mt-2">
        <Badge variant="secondary" class="text-xs">
          {{ simulationsUsage.used }} of {{ simulationsUsage.limit }} simulations used
        </Badge>
      </div>
    </div>

    <!-- Usage limit banner -->
    <div
      v-if="!simulationsAllowed"
      class="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground"
    >
      You've used all {{ simulationsUsage?.limit ?? '' }} simulations. Upgrade to create more.
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
      <!-- AI Suggest CTA -->
      <Card class="border-primary/30 bg-primary/[0.02]">
        <CardContent class="p-5">
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-1">
              <div class="text-sm font-semibold flex items-center gap-1.5">
                <Sparkles class="h-4 w-4 text-primary" />
                Not sure where to start?
              </div>
              <p class="text-xs text-muted-foreground leading-relaxed">
                AI will analyze your cost and revenue data, then create 2-3 ready-to-run scenarios targeting your lowest-margin features.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              class="shrink-0 gap-1.5 border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground"
              :disabled="isSuggesting"
              @click="handleSuggest"
            >
              <Loader2 v-if="isSuggesting" class="h-3.5 w-3.5 animate-spin" />
              <Sparkles v-else class="h-3.5 w-3.5" />
              {{ isSuggesting ? 'Analyzing...' : 'Suggest with AI' }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div class="flex items-center gap-3 text-xs text-muted-foreground">
        <div class="flex-1 h-px bg-border" />
        <span>or configure manually</span>
        <div class="flex-1 h-px bg-border" />
      </div>

      <Card>
        <CardContent class="p-5 space-y-4">
          <div>
            <Label class="mb-1.5 block">Simulation Name</Label>
            <Input
              :model-value="simName"
              placeholder="e.g. API Pricing Optimization"
              @update:model-value="simName = $event"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <Label class="mb-1.5 block">Date From (optional)</Label>
              <Input
                type="date"
                :model-value="dateFrom"
                @update:model-value="dateFrom = $event"
              />
            </div>
            <div>
              <Label class="mb-1.5 block">Date To (optional)</Label>
              <Input
                type="date"
                :model-value="dateTo"
                @update:model-value="dateTo = $event"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Step 2: Scenarios -->
    <div v-if="step === 2" class="space-y-4">
      <!-- AI rationale banner -->
      <div
        v-if="suggestRationale"
        class="rounded-lg border border-primary/20 bg-primary/[0.03] px-4 py-3 text-sm text-muted-foreground flex items-start gap-2"
      >
        <Sparkles class="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <span>{{ suggestRationale }}</span>
      </div>

      <Card
        v-for="(scenario, sIdx) in scenarios"
        :key="scenario.id"
      >
        <CardContent class="p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold">Scenario {{ sIdx + 1 }}</h3>
            <Button
              v-if="scenarios.length > 1"
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-muted-foreground hover:text-destructive"
              @click="removeScenario(sIdx)"
            >
              <Trash2 class="h-4 w-4" />
            </Button>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <Label class="mb-1 block text-xs text-muted-foreground">Name</Label>
              <Input
                :model-value="scenario.name"
                placeholder="e.g. Conservative (+10%)"
                @update:model-value="scenario.name = $event"
              />
            </div>
            <div>
              <Label class="mb-1 block text-xs text-muted-foreground">Description</Label>
              <Input
                :model-value="scenario.description"
                placeholder="Optional description"
                @update:model-value="scenario.description = $event"
              />
            </div>
          </div>

          <div class="space-y-2">
            <Label class="block text-xs text-muted-foreground">Pricing Changes</Label>
            <div
              v-for="(change, cIdx) in scenario.changes"
              :key="cIdx"
              class="flex items-center gap-2"
            >
              <Select
                :model-value="change.feature_key"
                placeholder="Select feature..."
                class="flex-1"
                :items="featureKeys.map(fk => ({ value: fk, label: fk }))"
                @update:model-value="change.feature_key = $event"
              />

              <Select
                :model-value="change.change_type"
                class="w-40"
                :items="changeTypeOptions"
                @update:model-value="change.change_type = $event as PricingChangeType"
              />

              <Input
                type="number"
                :model-value="String(change.change_value)"
                class="w-24 text-right"
                @update:model-value="change.change_value = Number($event)"
              />

              <Button
                v-if="scenario.changes.length > 1"
                variant="ghost"
                size="icon"
                class="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                @click="removeChange(sIdx, cIdx)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
            </div>

            <Button
              variant="ghost"
              size="sm"
              class="gap-1 text-xs text-muted-foreground"
              @click="addChange(sIdx)"
            >
              <Plus class="h-3 w-3" /> Add change
            </Button>
          </div>
        </CardContent>
      </Card>

      <Button
        variant="outline"
        size="sm"
        class="gap-1.5"
        @click="addScenario"
      >
        <Plus class="h-4 w-4" /> Add Scenario
      </Button>
    </div>

    <!-- Step 3: Review & Run -->
    <div v-if="step === 3" class="space-y-4">
      <Card>
        <CardContent class="p-5 space-y-4">
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
        </CardContent>
      </Card>
    </div>

    <!-- Navigation buttons -->
    <div class="flex items-center justify-between pt-2">
      <Button
        v-if="step > 1"
        variant="outline"
        class="gap-1.5"
        @click="prevStep"
      >
        <ArrowLeft class="h-4 w-4" /> Back
      </Button>
      <div v-else />

      <Button
        v-if="step < totalSteps"
        :disabled="(step === 1 && !canProceedStep1) || (step === 2 && !canProceedStep2)"
        class="gap-1.5"
        @click="nextStep"
      >
        Next <ArrowRight class="h-4 w-4" />
      </Button>

      <Button
        v-if="step === totalSteps"
        :disabled="isSubmitting || !simulationsAllowed"
        :loading="isSubmitting"
        class="gap-2"
        @click="runSimulation"
      >
        <Play v-if="!isSubmitting" class="h-4 w-4" />
        {{ isSubmitting ? 'Running...' : 'Run Simulation' }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { Bell, Plus, Trash2, Loader2 } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button } from '@/components/ui'
import { listAlertRules, createAlertRule, updateAlertRule, deleteAlertRule } from '@/lib/api'
import type { AlertRule } from '@/lib/api'

const queryClient = useQueryClient()

const { data, isLoading } = useQuery({
  queryKey: ['alert-rules'],
  queryFn: listAlertRules,
})

const showForm = ref(false)
const isSubmitting = ref(false)

// Form state
const formName = ref('')
const formMetric = ref<AlertRule['metric']>('daily_cost')
const formOperator = ref<AlertRule['operator']>('gt')
const formThreshold = ref<number>(0)
const formEmail = ref('')
const formCooldown = ref(60)

const METRICS = [
  { value: 'daily_cost', label: 'Daily cost ($)' },
  { value: 'margin_percent', label: 'Margin (%)' },
  { value: 'cost_per_event', label: 'Avg cost per event ($)' },
]

const OPERATORS = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
]

function operatorLabel(op: string) {
  return OPERATORS.find(o => o.value === op)?.label || op
}

function metricLabel(m: string) {
  return METRICS.find(x => x.value === m)?.label || m
}

function formatThreshold(metric: string, threshold: number) {
  if (metric === 'margin_percent') return `${threshold}%`
  return `$${threshold}`
}

function resetForm() {
  formName.value = ''
  formMetric.value = 'daily_cost'
  formOperator.value = 'gt'
  formThreshold.value = 0
  formEmail.value = ''
  formCooldown.value = 60
  showForm.value = false
}

async function handleCreate() {
  if (!formName.value || !formEmail.value) {
    toast.error('Name and email are required')
    return
  }
  isSubmitting.value = true
  try {
    await createAlertRule({
      name: formName.value,
      metric: formMetric.value,
      operator: formOperator.value,
      threshold: formThreshold.value,
      email: formEmail.value,
      cooldown_minutes: formCooldown.value,
    })
    queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
    toast.success('Alert created')
    resetForm()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to create alert')
  } finally {
    isSubmitting.value = false
  }
}

async function handleToggle(rule: AlertRule) {
  try {
    await updateAlertRule(rule.id, { enabled: !rule.enabled })
    queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
  } catch (err) {
    toast.error('Failed to update alert')
  }
}

async function handleDelete(id: number) {
  try {
    await deleteAlertRule(id)
    queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
    toast.success('Alert deleted')
  } catch (err) {
    toast.error('Failed to delete alert')
  }
}
</script>

<template>
  <div class="space-y-8 max-w-3xl pb-24">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Cost Alerts</h1>
        <p class="text-muted-foreground text-sm">Get emailed when costs spike or margins drop</p>
      </div>
      <Button v-if="!showForm" @click="showForm = true">
        <Plus class="h-4 w-4 mr-2" />
        New Alert
      </Button>
    </div>

    <!-- Create form -->
    <Card v-if="showForm">
      <CardHeader class="pb-3">
        <CardTitle class="text-base">New Alert Rule</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div>
          <label class="text-xs font-medium text-muted-foreground block mb-1">Name</label>
          <input
            v-model="formName"
            type="text"
            placeholder="e.g. Daily cost spike"
            class="w-full h-9 rounded-md border bg-background px-3 text-sm"
          />
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="text-xs font-medium text-muted-foreground block mb-1">Metric</label>
            <select v-model="formMetric" class="w-full h-9 rounded-md border bg-background px-3 text-sm">
              <option v-for="m in METRICS" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </div>
          <div>
            <label class="text-xs font-medium text-muted-foreground block mb-1">Condition</label>
            <select v-model="formOperator" class="w-full h-9 rounded-md border bg-background px-3 text-sm">
              <option v-for="op in OPERATORS" :key="op.value" :value="op.value">{{ op.label }}</option>
            </select>
          </div>
          <div>
            <label class="text-xs font-medium text-muted-foreground block mb-1">Threshold</label>
            <input
              v-model.number="formThreshold"
              type="number"
              step="any"
              class="w-full h-9 rounded-md border bg-background px-3 text-sm"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-medium text-muted-foreground block mb-1">Send to</label>
            <input
              v-model="formEmail"
              type="email"
              placeholder="you@company.com"
              class="w-full h-9 rounded-md border bg-background px-3 text-sm"
            />
          </div>
          <div>
            <label class="text-xs font-medium text-muted-foreground block mb-1">Don't re-alert for</label>
            <div class="flex items-center gap-2">
              <input
                v-model.number="formCooldown"
                type="number"
                min="1"
                class="w-full h-9 rounded-md border bg-background px-3 text-sm"
              />
              <span class="text-xs text-muted-foreground shrink-0">minutes</span>
            </div>
          </div>
        </div>

        <div class="flex gap-2 pt-2">
          <Button :disabled="isSubmitting" @click="handleCreate">
            {{ isSubmitting ? 'Creating...' : 'Create Alert' }}
          </Button>
          <Button variant="ghost" @click="resetForm">Cancel</Button>
        </div>
      </CardContent>
    </Card>

    <!-- Loading -->
    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>

    <!-- Rules list -->
    <div v-else-if="data?.rules?.length" class="space-y-3">
      <Card v-for="rule in data.rules" :key="rule.id">
        <CardContent class="p-4">
          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium">{{ rule.name }}</span>
                <span
                  :class="[
                    'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                    rule.enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                  ]"
                >
                  {{ rule.enabled ? 'Active' : 'Paused' }}
                </span>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ metricLabel(rule.metric) }} {{ operatorLabel(rule.operator) }} {{ formatThreshold(rule.metric, rule.threshold) }}
                &middot; {{ rule.email }}
                <template v-if="rule.last_triggered_at">
                  &middot; Last fired {{ new Date(rule.last_triggered_at).toLocaleDateString() }}
                </template>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                class="h-7 text-xs"
                @click="handleToggle(rule)"
              >
                {{ rule.enabled ? 'Pause' : 'Enable' }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                @click="handleDelete(rule.id)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Empty state -->
    <Card v-else>
      <CardContent class="p-8 text-center">
        <Bell class="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h2 class="text-lg font-semibold">No alerts configured</h2>
        <p class="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Set up alerts to get emailed when your daily AI costs exceed a threshold, margins drop, or per-event costs spike.
        </p>
        <Button class="mt-4" @click="showForm = true">
          <Plus class="h-4 w-4 mr-2" />
          Create your first alert
        </Button>
      </CardContent>
    </Card>
  </div>
</template>

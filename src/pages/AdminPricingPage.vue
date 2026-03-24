<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui'
import { Loader2, Save, Plus, Trash2, ShieldCheck } from 'lucide-vue-next'

interface ModelPrice {
  model: string
  provider: string
  input_cost_per_million: number
  output_cost_per_million: number
}

const router = useRouter()
const isAdmin = ref(false)
const isLoading = ref(true)
const isSaving = ref<string | null>(null)
const models = ref<ModelPrice[]>([])
const editingModel = ref<string | null>(null)
const editInput = ref(0)
const editOutput = ref(0)

// New model form
const showAddForm = ref(false)
const newModel = ref('')
const newProvider = ref('openai')
const newInput = ref(0)
const newOutput = ref(0)
const isAdding = ref(false)

const providers = ['openai', 'anthropic', 'google', 'mistral', 'meta', 'cohere', 'other']

const groupedByProvider = computed(() => {
  const groups: Record<string, ModelPrice[]> = {}
  for (const m of models.value) {
    if (!groups[m.provider]) groups[m.provider] = []
    groups[m.provider].push(m)
  }
  // Sort models within each group by input cost descending
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => b.input_cost_per_million - a.input_cost_per_million)
  }
  return groups
})

async function checkAdmin() {
  try {
    const res = await fetch('/api/admin/status', { credentials: 'include' })
    const data = await res.json()
    isAdmin.value = data.isAdmin
    if (!data.isAdmin) {
      router.push('/')
    }
  } catch {
    router.push('/')
  }
}

async function loadPricing() {
  const res = await fetch('/api/pricing/models')
  const data = await res.json()
  models.value = data.models
  isLoading.value = false
}

function startEdit(m: ModelPrice) {
  editingModel.value = m.model
  editInput.value = m.input_cost_per_million
  editOutput.value = m.output_cost_per_million
}

function cancelEdit() {
  editingModel.value = null
}

async function saveEdit(m: ModelPrice) {
  isSaving.value = m.model
  try {
    await fetch('/api/pricing/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        model: m.model,
        provider: m.provider,
        input_cost_per_million: editInput.value,
        output_cost_per_million: editOutput.value,
      }),
    })
    m.input_cost_per_million = editInput.value
    m.output_cost_per_million = editOutput.value
    editingModel.value = null
  } finally {
    isSaving.value = null
  }
}

async function addModel() {
  if (!newModel.value.trim()) return
  isAdding.value = true
  try {
    await fetch('/api/pricing/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        model: newModel.value.trim(),
        provider: newProvider.value,
        input_cost_per_million: newInput.value,
        output_cost_per_million: newOutput.value,
      }),
    })
    models.value.push({
      model: newModel.value.trim(),
      provider: newProvider.value,
      input_cost_per_million: newInput.value,
      output_cost_per_million: newOutput.value,
    })
    newModel.value = ''
    newInput.value = 0
    newOutput.value = 0
    showAddForm.value = false
  } finally {
    isAdding.value = false
  }
}

onMounted(async () => {
  await checkAdmin()
  if (isAdmin.value) await loadPricing()
})
</script>

<template>
  <div class="max-w-4xl space-y-6 pb-24">
    <div>
      <div class="flex items-center gap-2">
        <ShieldCheck class="h-5 w-5 text-primary" />
        <h1 class="text-2xl font-semibold tracking-tight">Model Pricing</h1>
      </div>
      <p class="text-sm text-muted-foreground mt-1">
        Set the global default pricing per model. Users can override these with their own negotiated rates.
      </p>
    </div>

    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>

    <template v-else>
      <!-- Add model button -->
      <div class="flex justify-end">
        <Button v-if="!showAddForm" size="sm" @click="showAddForm = true">
          <Plus class="h-4 w-4 mr-1" />
          Add Model
        </Button>
      </div>

      <!-- Add model form -->
      <Card v-if="showAddForm" class="border-primary/30">
        <CardContent class="p-4">
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
            <div>
              <label class="text-xs font-medium text-muted-foreground block mb-1">Model</label>
              <input v-model="newModel" placeholder="gpt-4o-new" class="w-full h-9 rounded-md border bg-background px-3 text-sm font-mono" />
            </div>
            <div>
              <label class="text-xs font-medium text-muted-foreground block mb-1">Provider</label>
              <select v-model="newProvider" class="w-full h-9 rounded-md border bg-background px-3 text-sm">
                <option v-for="p in providers" :key="p" :value="p">{{ p }}</option>
              </select>
            </div>
            <div>
              <label class="text-xs font-medium text-muted-foreground block mb-1">Input $/1M</label>
              <input v-model.number="newInput" type="number" step="0.01" class="w-full h-9 rounded-md border bg-background px-3 text-sm tabular-nums" />
            </div>
            <div>
              <label class="text-xs font-medium text-muted-foreground block mb-1">Output $/1M</label>
              <input v-model.number="newOutput" type="number" step="0.01" class="w-full h-9 rounded-md border bg-background px-3 text-sm tabular-nums" />
            </div>
            <div class="flex gap-2">
              <Button size="sm" :disabled="!newModel.trim() || isAdding" @click="addModel">
                {{ isAdding ? 'Adding...' : 'Add' }}
              </Button>
              <Button size="sm" variant="ghost" @click="showAddForm = false">Cancel</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Pricing by provider -->
      <div v-for="(providerModels, provider) in groupedByProvider" :key="provider" class="space-y-2">
        <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider capitalize">{{ provider }}</h2>

        <Card>
          <div class="overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b bg-muted/50 text-muted-foreground">
                  <th class="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Model</th>
                  <th class="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Input $/1M tokens</th>
                  <th class="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Output $/1M tokens</th>
                  <th class="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider w-24"></th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="m in providerModels" :key="m.model" class="hover:bg-muted/50 transition-colors">
                  <td class="px-4 py-3">
                    <code class="text-xs font-mono bg-muted px-2 py-0.5 rounded">{{ m.model }}</code>
                  </td>
                  <template v-if="editingModel === m.model">
                    <td class="px-4 py-2 text-right">
                      <input v-model.number="editInput" type="number" step="0.01" class="w-24 h-8 rounded-md border bg-background px-2 text-sm tabular-nums text-right" />
                    </td>
                    <td class="px-4 py-2 text-right">
                      <input v-model.number="editOutput" type="number" step="0.01" class="w-24 h-8 rounded-md border bg-background px-2 text-sm tabular-nums text-right" />
                    </td>
                    <td class="px-4 py-2 text-right">
                      <div class="flex gap-1 justify-end">
                        <Button size="sm" variant="outline" :disabled="isSaving === m.model" @click="saveEdit(m)">
                          <Save class="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" @click="cancelEdit">Cancel</Button>
                      </div>
                    </td>
                  </template>
                  <template v-else>
                    <td class="px-4 py-3 text-right tabular-nums text-muted-foreground">${{ m.input_cost_per_million.toFixed(2) }}</td>
                    <td class="px-4 py-3 text-right tabular-nums text-muted-foreground">${{ m.output_cost_per_million.toFixed(2) }}</td>
                    <td class="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" class="h-7 text-xs" @click="startEdit(m)">Edit</Button>
                    </td>
                  </template>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </template>
  </div>
</template>

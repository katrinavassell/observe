<script setup lang="ts">
/**
 * AnthropicApiKeyModal - Connect Anthropic to sync usage costs
 *
 * Uses the Anthropic Admin API to fetch usage data.
 * Requires an Admin API key (different from regular API key).
 */
import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import {
  X,
  Key,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  DollarSign,
  Zap,
} from 'lucide-vue-next'
import { Button, Input } from '@/components/ui'
import { connectAnthropic } from '@/api/client'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  connected: [provider: string]
}>()

const apiKey = ref('')
const showKey = ref(false)
const isConnecting = ref(false)

const isKeyValid = computed(() => {
  const key = apiKey.value.trim()
  // Anthropic admin keys start with 'sk-ant-admin'
  return key.startsWith('sk-ant-admin') || key.startsWith('sk-ant-api')
})

function resetForm() {
  apiKey.value = ''
  showKey.value = false
}

async function handleSubmit() {
  if (!apiKey.value.trim()) return

  const key = apiKey.value.trim()

  // Validate key format
  if (!key.startsWith('sk-ant-')) {
    toast.error('Invalid API key format', {
      description: 'Anthropic API keys should start with sk-ant-',
    })
    return
  }

  isConnecting.value = true

  try {
    const result = await connectAnthropic(key)

    if (result.success) {
      toast.success('Anthropic connected!', {
        description: result.has_usage_access
          ? `Synced $${result.cost_synced.toFixed(2)} in costs.`
          : 'Usage data will sync when available.',
      })

      resetForm()
      emit('connected', 'anthropic')
      emit('close')
    } else {
      toast.error('Failed to connect', {
        description: result.message,
      })
    }
  } catch (error) {
    toast.error('Failed to connect', {
      description: error instanceof Error ? error.message : 'Invalid API key',
    })
  } finally {
    isConnecting.value = false
  }
}

function handleClose() {
  resetForm()
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      @click.self="handleClose"
    >
      <div class="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <!-- Header -->
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <div class="h-8 w-8 rounded-lg bg-[#D4A574]/10 flex items-center justify-center">
              <span class="text-lg font-semibold text-[#D4A574]">A</span>
            </div>
            <h2 class="text-lg font-semibold">Connect Anthropic</h2>
          </div>
          <Button variant="ghost" size="sm" @click="handleClose">
            <X class="h-4 w-4" />
          </Button>
        </div>

        <div class="space-y-4">
          <!-- What we'll sync -->
          <div class="grid grid-cols-2 gap-2">
            <div class="flex items-center gap-2 rounded-md border bg-muted/30 p-2.5">
              <DollarSign class="h-4 w-4 text-primary" />
              <div>
                <p class="text-sm font-medium">Usage Costs</p>
                <p class="text-xs text-muted-foreground">Monthly spend</p>
              </div>
            </div>
            <div class="flex items-center gap-2 rounded-md border bg-muted/30 p-2.5">
              <Zap class="h-4 w-4 text-primary" />
              <div>
                <p class="text-sm font-medium">Token Usage</p>
                <p class="text-xs text-muted-foreground">By model</p>
              </div>
            </div>
          </div>

          <!-- Instructions -->
          <div class="text-sm text-muted-foreground">
            <p>Enter your Anthropic API key to automatically sync usage costs.</p>
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 text-primary hover:underline mt-1"
            >
              Get your API key from Anthropic Console
              <ExternalLink class="h-3 w-3" />
            </a>
          </div>

          <!-- API Key Input -->
          <div class="space-y-2">
            <label class="text-sm font-medium">API Key</label>
            <div class="relative">
              <Input
                v-model="apiKey"
                :type="showKey ? 'text' : 'password'"
                placeholder="sk-ant-..."
                :class="`pr-10 font-mono text-sm ${apiKey.trim() && isKeyValid ? 'border-success/50' : ''}`"
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                @click="showKey = !showKey"
              >
                <Eye v-if="!showKey" class="h-4 w-4" />
                <EyeOff v-else class="h-4 w-4" />
              </button>
            </div>
            <p class="text-xs text-muted-foreground">
              Your key is encrypted and stored securely.
            </p>
          </div>

          <!-- Submit -->
          <div class="flex gap-2 pt-2">
            <Button
              class="flex-1"
              :disabled="!apiKey.trim() || !isKeyValid || isConnecting"
              @click="handleSubmit"
            >
              <Loader2 v-if="isConnecting" class="h-4 w-4 mr-2 animate-spin" />
              <Key v-else class="h-4 w-4 mr-2" />
              Connect
            </Button>
            <Button variant="outline" @click="handleClose">
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

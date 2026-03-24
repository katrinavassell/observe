<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import {
  X,
  Key,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  Users,
  CreditCard,
  FileText,
  BarChart3,
  Database,
  Sparkles,
} from 'lucide-vue-next'
import { Button, Input } from '@/components/ui'
import { connectStripeWithApiKey } from '@/api/client'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  connected: [accountName: string]
}>()

const queryClient = useQueryClient()
const apiKey = ref('')
const showKey = ref(false)

// Data types that will be synced
const dataTypes = [
  { icon: Users, label: 'Customers', description: 'with metadata & segments' },
  { icon: CreditCard, label: 'Subscriptions', description: 'with discounts & items' },
  { icon: FileText, label: 'Invoices', description: 'with line items' },
  { icon: BarChart3, label: 'Usage Records', description: 'for metered billing' },
  { icon: Database, label: 'Products & Prices', description: 'full catalog' },
  { icon: Sparkles, label: 'AI Analysis', description: 'powered by Claude' },
]

const isKeyValid = computed(() => {
  const key = apiKey.value.trim()
  return key.startsWith('sk_') || key.startsWith('rk_')
})

function resetForm() {
  apiKey.value = ''
  showKey.value = false
}

const connectMutation = useMutation({
  mutationFn: connectStripeWithApiKey,
  onSuccess: (data) => {
    queryClient.invalidateQueries({ queryKey: ['integrations'] })
    toast.success('Stripe connected!', {
      description: `Connected to ${data.account_name}. Click "Sync" to import your data.`,
    })
    resetForm()
    emit('connected', data.account_name)
    emit('close')
  },
  onError: (error) => {
    toast.error('Failed to connect', {
      description: error instanceof Error ? error.message : 'Invalid API key. Please check and try again.',
    })
  },
})

function handleSubmit() {
  if (!apiKey.value.trim()) return

  // Basic validation - Stripe keys start with sk_live_ or sk_test_ or rk_live_ or rk_test_
  const key = apiKey.value.trim()
  if (!key.startsWith('sk_') && !key.startsWith('rk_')) {
    toast.error('Invalid API key format', {
      description: 'Stripe API keys should start with sk_live_, sk_test_, rk_live_, or rk_test_',
    })
    return
  }

  connectMutation.mutate(key)
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
      <div class="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg">
        <!-- Header -->
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <Key class="h-5 w-5 text-primary" />
            <h2 class="text-lg font-semibold">Connect Stripe</h2>
          </div>
          <Button variant="ghost" size="sm" @click="handleClose">
            <X class="h-4 w-4" />
          </Button>
        </div>

        <div class="space-y-5">
          <!-- Instructions -->
          <div class="text-sm text-muted-foreground space-y-2">
            <p>Enter your Stripe Secret API key to import your complete billing data for analysis.</p>
            <a
              href="https://dashboard.stripe.com/apikeys"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Get your API key from Stripe Dashboard
              <ExternalLink class="h-3 w-3" />
            </a>
          </div>

          <!-- Data Types Grid -->
          <div class="grid grid-cols-2 gap-2">
            <div
              v-for="dataType in dataTypes"
              :key="dataType.label"
              class="flex items-start gap-2 rounded-md border bg-muted/30 p-2.5"
            >
              <component
                :is="dataType.icon"
                class="h-4 w-4 text-primary mt-0.5 shrink-0"
              />
              <div class="min-w-0">
                <p class="text-sm font-medium leading-tight">{{ dataType.label }}</p>
                <p class="text-xs text-muted-foreground leading-tight">{{ dataType.description }}</p>
              </div>
            </div>
          </div>

          <!-- API Key Input -->
          <div class="space-y-2">
            <label class="text-sm font-medium">Secret API Key</label>
            <div class="relative">
              <Input
                v-model="apiKey"
                :type="showKey ? 'text' : 'password'"
                placeholder="sk_live_... or rk_live_..."
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
              Read-only access required. Your key is encrypted and stored securely.
            </p>
          </div>

          <!-- Security Note -->
          <div class="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-2">
            <p>
              <strong>Recommended:</strong> Create a
              <a
                href="https://stripe.com/docs/keys#limit-access"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary hover:underline"
              >
                restricted key
              </a>
              with read permissions for:
            </p>
            <ul class="list-disc list-inside space-y-0.5 ml-1">
              <li>Customers, Subscriptions, Invoices</li>
              <li>Prices, Products, Coupons</li>
              <li>Usage Records, Subscription Schedules</li>
            </ul>
          </div>

          <!-- Submit -->
          <div class="flex gap-2 pt-2">
            <Button
              class="flex-1"
              :disabled="!apiKey.trim() || !isKeyValid || connectMutation.isPending.value"
              @click="handleSubmit"
            >
              <Loader2 v-if="connectMutation.isPending.value" class="h-4 w-4 mr-2 animate-spin" />
              <Key v-else class="h-4 w-4 mr-2" />
              Connect Stripe
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

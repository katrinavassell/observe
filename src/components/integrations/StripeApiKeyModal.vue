<script setup lang="ts">
import { ref } from 'vue'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { X, Key, Loader2, ExternalLink, Eye, EyeOff } from 'lucide-vue-next'
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
      <div class="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
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
            <p>Enter your Stripe Secret API key to import customers, subscriptions, and invoices.</p>
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

          <!-- API Key Input -->
          <div class="space-y-2">
            <label class="text-sm font-medium">Secret API Key</label>
            <div class="relative">
              <Input
                v-model="apiKey"
                :type="showKey ? 'text' : 'password'"
                placeholder="sk_live_... or sk_test_..."
                class="pr-10 font-mono text-sm"
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
              We only need read access. Your key is stored securely.
            </p>
          </div>

          <!-- Security Note -->
          <div class="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-2">
            <p>
              <strong>Tip:</strong> For production, create a
              <a
                href="https://stripe.com/docs/keys#limit-access"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary hover:underline"
              >
                restricted key
              </a>
              with these read permissions:
            </p>
            <ul class="list-disc list-inside space-y-0.5 ml-1">
              <li>Customers, Subscriptions, Invoices</li>
              <li>Prices, Products</li>
              <li>Usage Records <span class="text-muted-foreground/70">(for metered billing)</span></li>
            </ul>
          </div>

          <!-- Submit -->
          <div class="flex gap-2 pt-2">
            <Button
              class="flex-1"
              :disabled="!apiKey.trim() || connectMutation.isPending.value"
              @click="handleSubmit"
            >
              <Loader2 v-if="connectMutation.isPending.value" class="h-4 w-4 mr-2 animate-spin" />
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

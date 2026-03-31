<script setup lang="ts">
/**
 * StripeApiKeyModal - Connect Stripe to auto-sync revenue data
 *
 * Uses a restricted API key to pull customers, subscriptions, and MRR.
 * Revenue is then auto-enriched on SDK events.
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
  Users,
  CreditCard,
  TrendingUp,
} from 'lucide-vue-next'
import { Button, Input } from '@/components/ui'
import { connectStripeWithApiKey } from '@/api/client'

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
  return (key.startsWith('rk_live_') || key.startsWith('rk_test_') ||
          key.startsWith('sk_live_') || key.startsWith('sk_test_')) && key.length > 20
})

function resetForm() {
  apiKey.value = ''
  showKey.value = false
}

async function handleSubmit() {
  if (!apiKey.value.trim()) return

  const key = apiKey.value.trim()

  if (!isKeyValid.value) {
    toast.error('Invalid API key format', {
      description: 'Stripe keys should start with rk_live_, rk_test_, sk_live_, or sk_test_',
    })
    return
  }

  isConnecting.value = true

  try {
    const result = await connectStripeWithApiKey(key)

    if (result.success) {
      toast.success('Stripe connected!', {
        description: `Synced ${result.account_name}. Revenue will auto-enrich on SDK events.`,
      })

      resetForm()
      emit('connected', 'stripe')
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
            <div class="h-8 w-8 rounded-lg bg-[#635bff] flex items-center justify-center">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="white">
                <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
              </svg>
            </div>
            <h2 class="text-lg font-semibold">Connect Stripe</h2>
          </div>
          <Button variant="ghost" size="sm" @click="handleClose">
            <X class="h-4 w-4" />
          </Button>
        </div>

        <div class="space-y-4">
          <!-- What we'll sync -->
          <div class="grid grid-cols-3 gap-2">
            <div class="flex items-center gap-2 rounded-md border bg-muted/30 p-2.5">
              <Users class="h-4 w-4 text-primary" />
              <div>
                <p class="text-sm font-medium">Customers</p>
                <p class="text-xs text-muted-foreground">Auto-sync</p>
              </div>
            </div>
            <div class="flex items-center gap-2 rounded-md border bg-muted/30 p-2.5">
              <CreditCard class="h-4 w-4 text-primary" />
              <div>
                <p class="text-sm font-medium">Subscriptions</p>
                <p class="text-xs text-muted-foreground">MRR data</p>
              </div>
            </div>
            <div class="flex items-center gap-2 rounded-md border bg-muted/30 p-2.5">
              <TrendingUp class="h-4 w-4 text-primary" />
              <div>
                <p class="text-sm font-medium">Revenue</p>
                <p class="text-xs text-muted-foreground">Auto-enrich</p>
              </div>
            </div>
          </div>

          <!-- How it works -->
          <div class="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            Connect Stripe and revenue is automatically attached to your SDK cost events. Use your Stripe <span class="font-mono">customer_id</span> as <span class="font-mono">customerReferenceId</span> when sending events.
          </div>

          <!-- Instructions -->
          <div class="text-sm text-muted-foreground">
            <p>Enter a Stripe restricted API key with read access to Customers, Subscriptions, Products, and Prices.</p>
            <a
              href="https://dashboard.stripe.com/apikeys/create?name=Observe+Read+Only&permissions%5B%5D=rak_customer_read&permissions%5B%5D=rak_subscription_read&permissions%5B%5D=rak_product_read&permissions%5B%5D=rak_price_read"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 text-primary hover:underline mt-1"
            >
              Create a restricted key on Stripe
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
                placeholder="rk_live_... or rk_test_..."
                :class="`pr-10 font-mono text-sm ${apiKey.trim() && isKeyValid ? 'border-success/50' : ''}`"
                @keydown.enter="handleSubmit"
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
              Your key is encrypted and stored securely. We only read data, never write.
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
              {{ isConnecting ? 'Connecting...' : 'Connect' }}
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

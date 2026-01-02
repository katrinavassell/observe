<script setup lang="ts">
/**
 * StripeConnectModal - Modal for connecting Stripe via API key
 *
 * Handles:
 * - API key input and validation
 * - Test/live mode detection
 * - Connection confirmation
 * - Sync initiation
 */

import { ref, computed, watch } from 'vue'
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'radix-vue'
import { X, Key, AlertCircle, CheckCircle2, Loader2, ExternalLink } from 'lucide-vue-next'
import { Button, Input, Badge, Alert } from '@/components/ui'
import { useStripeConnection } from '@/composables/useStripeConnection'
import { detectKeyMode } from '@/lib/stripe-api'

// =============================================================================
// PROPS & EMITS
// =============================================================================

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  connected: [accountName: string]
  'start-sync': []
}>()

// =============================================================================
// STATE
// =============================================================================

const {
  isValidating,
  validation,
  validateApiKey,
  disconnect,
} = useStripeConnection()

const apiKeyInput = ref('')
const showKey = ref(false)
const hasAttemptedValidation = ref(false)

// =============================================================================
// COMPUTED
// =============================================================================

const keyMode = computed(() => {
  if (!apiKeyInput.value) return null
  return detectKeyMode(apiKeyInput.value)
})

const isValidKeyFormat = computed(() => {
  return keyMode.value !== null
})

const maskedKey = computed(() => {
  if (!apiKeyInput.value) return ''
  if (showKey.value) return apiKeyInput.value
  const prefix = apiKeyInput.value.slice(0, 8)
  const suffix = apiKeyInput.value.slice(-4)
  return `${prefix}${'•'.repeat(20)}${suffix}`
})

const canConnect = computed(() => {
  return isValidKeyFormat.value && !isValidating.value
})

const isConnected = computed(() => {
  return validation.value?.isValid === true
})

// =============================================================================
// HANDLERS
// =============================================================================

async function handleValidate(): Promise<void> {
  if (!canConnect.value) return

  hasAttemptedValidation.value = true
  await validateApiKey(apiKeyInput.value)

  if (validation.value?.isValid) {
    emit('connected', validation.value.accountName || 'Unknown Account')
  }
}

function handleStartSync(): void {
  emit('start-sync')
  emit('update:open', false)
}

function handleClose(): void {
  emit('update:open', false)
}

function handleDisconnect(): void {
  disconnect()
  apiKeyInput.value = ''
  hasAttemptedValidation.value = false
}

// Reset state when modal opens
watch(() => props.open, (isOpen) => {
  if (isOpen) {
    // Don't reset if already connected
    if (!isConnected.value) {
      apiKeyInput.value = ''
      hasAttemptedValidation.value = false
    }
  }
})
</script>

<template>
  <DialogRoot :open="open">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent
        class="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg"
      >
        <!-- Header -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 rounded-lg bg-[#635BFF]/10 flex items-center justify-center">
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="#635BFF">
                <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
              </svg>
            </div>
            <div>
              <DialogTitle class="text-lg font-semibold">
                Connect Stripe
              </DialogTitle>
              <DialogDescription class="text-sm text-muted-foreground">
                Import customers, subscriptions, and invoices
              </DialogDescription>
            </div>
          </div>
          <DialogClose
            class="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
            @click="handleClose"
          >
            <X class="h-4 w-4" />
            <span class="sr-only">Close</span>
          </DialogClose>
        </div>

        <!-- Connected State -->
        <template v-if="isConnected">
          <Alert class="border-green-500/30 bg-green-500/5">
            <CheckCircle2 class="h-4 w-4 text-green-500" />
            <div class="ml-2">
              <p class="text-sm font-medium">Connected to Stripe</p>
              <p class="text-sm text-muted-foreground">
                {{ validation?.accountName }}
                <Badge variant="outline" class="ml-2">
                  {{ validation?.mode === 'test' ? 'Test Mode' : 'Live Mode' }}
                </Badge>
              </p>
            </div>
          </Alert>

          <div class="space-y-3">
            <p class="text-sm text-muted-foreground">
              Ready to import your Stripe data. This will fetch:
            </p>
            <ul class="text-sm space-y-1 text-muted-foreground">
              <li class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 text-green-500" />
                Customers and their metadata
              </li>
              <li class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 text-green-500" />
                Active and canceled subscriptions
              </li>
              <li class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 text-green-500" />
                Invoice history and payment status
              </li>
            </ul>
          </div>

          <div class="flex gap-2 pt-2">
            <Button variant="outline" class="flex-1" @click="handleDisconnect">
              Disconnect
            </Button>
            <Button class="flex-1" @click="handleStartSync">
              Start Import
            </Button>
          </div>
        </template>

        <!-- Not Connected State -->
        <template v-else>
          <!-- API Key Input -->
          <div class="space-y-3">
            <div>
              <label class="text-sm font-medium mb-1.5 block">
                Secret API Key
              </label>
              <div class="relative">
                <Key class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  v-model="apiKeyInput"
                  :type="showKey ? 'text' : 'password'"
                  placeholder="sk_test_... or sk_live_..."
                  class="pl-9 pr-20 font-mono text-sm"
                  :disabled="isValidating"
                  @keyup.enter="handleValidate"
                />
                <button
                  type="button"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                  @click="showKey = !showKey"
                >
                  {{ showKey ? 'Hide' : 'Show' }}
                </button>
              </div>
            </div>

            <!-- Key Mode Badge -->
            <div v-if="apiKeyInput" class="flex items-center gap-2">
              <Badge
                v-if="keyMode"
                :variant="keyMode === 'test' ? 'secondary' : 'default'"
                :class="keyMode === 'live' ? 'bg-green-500 hover:bg-green-600' : ''"
              >
                {{ keyMode === 'test' ? 'Test Mode' : 'Live Mode' }}
              </Badge>
              <span v-else class="text-sm text-destructive flex items-center gap-1">
                <AlertCircle class="h-3.5 w-3.5" />
                Invalid key format
              </span>
            </div>

            <!-- Validation Error -->
            <Alert v-if="hasAttemptedValidation && validation && !validation.isValid" variant="destructive">
              <AlertCircle class="h-4 w-4" />
              <div class="ml-2">
                <p class="text-sm font-medium">Connection failed</p>
                <p class="text-sm">{{ validation.error }}</p>
              </div>
            </Alert>

            <!-- Help Text -->
            <p class="text-xs text-muted-foreground">
              Find your API keys in your
              <a
                href="https://dashboard.stripe.com/apikeys"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                Stripe Dashboard
                <ExternalLink class="h-3 w-3" />
              </a>
            </p>
          </div>

          <!-- Security Note -->
          <div class="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <p class="font-medium text-foreground mb-1">Security Note</p>
            <p>
              Your API key is used only to fetch data and is never stored on our servers.
              We recommend using a restricted API key with read-only access.
            </p>
          </div>

          <!-- Actions -->
          <div class="flex gap-2 pt-2">
            <Button variant="outline" class="flex-1" @click="handleClose">
              Cancel
            </Button>
            <Button
              class="flex-1"
              :disabled="!canConnect"
              @click="handleValidate"
            >
              <Loader2 v-if="isValidating" class="h-4 w-4 mr-2 animate-spin" />
              {{ isValidating ? 'Connecting...' : 'Connect' }}
            </Button>
          </div>
        </template>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

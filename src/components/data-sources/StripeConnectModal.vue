<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'radix-vue'
import { X, CheckCircle2, Loader2, Zap } from 'lucide-vue-next'
import { Button, Badge } from '@/components/ui'
import { useStripeConnection } from '@/composables/useStripeConnection'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  connected: [accountName: string]
  'start-sync': []
}>()

const { isConnected, accountName, checkStatus, isCheckingStatus, disconnect } = useStripeConnection()

const localChecked = ref(false)

onMounted(async () => {
  if (!localChecked.value) {
    localChecked.value = true
    await checkStatus()
  }
})

const displayName = computed(() => accountName.value || 'Your Stripe Account')

function handleStartSync() {
  emit('start-sync')
  emit('update:open', false)
}

function handleClose() {
  emit('update:open', false)
}

function handleDisconnect() {
  disconnect()
  emit('update:open', false)
}
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
              <DialogTitle class="text-lg font-semibold">Stripe Integration</DialogTitle>
              <DialogDescription class="text-sm text-muted-foreground">
                Import customers, subscriptions, and pricing data
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

        <!-- Checking state -->
        <div v-if="isCheckingStatus" class="py-6 flex flex-col items-center gap-3">
          <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
          <p class="text-sm text-muted-foreground">Checking connection...</p>
        </div>

        <!-- Connected state -->
        <template v-else-if="isConnected">
          <div class="rounded-lg border border-green-500/30 bg-green-500/5 p-3 flex items-start gap-3">
            <CheckCircle2 class="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
            <div>
              <p class="text-sm font-medium">Connected to Stripe</p>
              <p class="text-sm text-muted-foreground">{{ displayName }}</p>
              <Badge variant="outline" class="mt-1">Sandbox mode</Badge>
            </div>
          </div>

          <div class="space-y-2">
            <p class="text-sm text-muted-foreground">Importing will fetch:</p>
            <ul class="text-sm space-y-1 text-muted-foreground">
              <li class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 text-green-500 shrink-0" />
                Customers and their metadata
              </li>
              <li class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 text-green-500 shrink-0" />
                Active and canceled subscriptions
              </li>
              <li class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 text-green-500 shrink-0" />
                Products and pricing plans
              </li>
            </ul>
          </div>

          <div class="flex gap-2 pt-2">
            <Button variant="outline" class="flex-1" @click="handleDisconnect">
              Disconnect
            </Button>
            <Button class="flex-1" @click="handleStartSync">
              <Zap class="h-4 w-4 mr-2" />
              Import Data
            </Button>
          </div>
        </template>

        <!-- Not connected state -->
        <template v-else>
          <div class="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground space-y-2">
            <p class="font-medium text-foreground">Native Stripe Integration</p>
            <p>
              This app uses a secure native Stripe connection — no API key required.
              Your Stripe account is connected through the Replit integration.
            </p>
          </div>

          <div class="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
            Stripe connection not found. Please ensure the Stripe integration is set up in the project settings.
          </div>

          <div class="flex gap-2 pt-2">
            <Button variant="outline" class="flex-1" @click="handleClose">
              Close
            </Button>
            <Button class="flex-1" @click="checkStatus">
              <Loader2 v-if="isCheckingStatus" class="h-4 w-4 mr-2 animate-spin" />
              Retry
            </Button>
          </div>
        </template>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

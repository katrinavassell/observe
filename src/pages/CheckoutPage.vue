<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Loader2, CreditCard, Lock, AlertCircle } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui'

const route = useRoute()
const router = useRouter()

const isProcessing = ref(true)
const error = ref<string | null>(null)
const statusMessage = ref('Preparing your subscription...')

const planName = route.query.planName as string || 'Plan'
const planPrice = Number(route.query.planPrice) || 0
const planDescription = route.query.planDescription as string || ''
const planId = route.query.planId as string
const hasExistingSub = route.query.hasExistingSubscription === 'true'

async function apiPost(url: string, body: any) {
  const res = await fetch(`/api${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

async function processCheckout() {
  if (!planId) {
    error.value = 'No plan selected'
    isProcessing.value = false
    return
  }

  try {
    // For upgrades, mark as upgrade for the success page
    if (hasExistingSub) {
      localStorage.setItem('is_upgrade', 'true')
      statusMessage.value = 'Upgrading your plan...'
    } else {
      statusMessage.value = 'Creating your subscription...'
    }

    const data = await apiPost('/tanso/subscribe', { planId })

    if (data.checkoutUrl) {
      statusMessage.value = 'Redirecting to payment...'
      window.location.href = data.checkoutUrl
      return
    }

    // No checkout needed (free plan or upgrade applied immediately)
    router.push({ path: '/checkout/success', query: { plan: planName } })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Checkout failed'
    error.value = message
    toast.error(message)
    isProcessing.value = false
  }
}

onMounted(() => {
  processCheckout()
})
</script>

<template>
  <div class="min-h-[60vh] flex items-center justify-center">
    <div class="grid gap-6 md:grid-cols-2 max-w-3xl w-full mx-4">
      <!-- Order Summary -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base">Order Summary</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div>
            <h3 class="text-lg font-semibold">{{ planName }}</h3>
            <p v-if="planDescription" class="text-sm text-muted-foreground mt-1">{{ planDescription }}</p>
          </div>
          <div class="border-t pt-4">
            <div class="flex justify-between items-center">
              <span class="text-sm text-muted-foreground">Monthly subscription</span>
              <span class="text-lg font-bold">${{ planPrice }}/mo</span>
            </div>
          </div>
          <div class="flex items-center gap-2 text-xs text-muted-foreground pt-2">
            <Lock class="h-3 w-3" />
            <span>Secure payment via Stripe</span>
          </div>
        </CardContent>
      </Card>

      <!-- Payment Processing -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base flex items-center gap-2">
            <CreditCard class="h-4 w-4" />
            Payment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <!-- Processing state -->
          <div v-if="isProcessing" class="flex flex-col items-center justify-center py-8">
            <Loader2 class="h-8 w-8 animate-spin text-primary mb-4" />
            <p class="text-sm text-muted-foreground">{{ statusMessage }}</p>
          </div>

          <!-- Error state -->
          <div v-else-if="error" class="flex flex-col items-center justify-center py-8 space-y-4">
            <AlertCircle class="h-8 w-8 text-red-500" />
            <p class="text-sm text-red-600">{{ error }}</p>
            <div class="flex gap-3">
              <Button variant="outline" @click="router.push('/plans')">Back to Plans</Button>
              <Button @click="isProcessing = true; error = null; processCheckout()">Try Again</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

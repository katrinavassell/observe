<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CheckCircle, Loader2, ArrowRight } from 'lucide-vue-next'
import { tansoGetStatus } from '@/lib/api'
import { Button } from '@/components/ui'

const route = useRoute()
const router = useRouter()

const planName = (route.query.plan as string) || 'Your Plan'
const isActivating = ref(true)
let cancelled = false

async function pollEntitlements() {
  const maxAttempts = 12
  const pollInterval = 500

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (cancelled) return

    try {
      const status = await tansoGetStatus()
      const customer = status?.customer
      const activeSub = customer?.subscriptions?.find((s: any) => s.isActive)

      if (activeSub && status.entitlements?.length > 0) {
        isActivating.value = false
        return
      }
    } catch (err) {
      console.warn('Entitlement poll error:', err)
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }

  // Timeout — proceed anyway
  if (!cancelled) {
    console.warn('Entitlement polling timed out, proceeding')
    isActivating.value = false
  }
}

function goToDashboard() {
  const isUpgrade = localStorage.getItem('is_upgrade') === 'true'
  localStorage.removeItem('is_upgrade')

  if (isUpgrade) {
    router.push({ path: '/', query: { planChanged: planName } })
  } else {
    router.push('/')
  }
}

onMounted(() => {
  pollEntitlements()
})

onUnmounted(() => {
  cancelled = true
})
</script>

<template>
  <div class="min-h-[60vh] flex items-center justify-center">
    <div class="max-w-md w-full mx-4 text-center space-y-6">
      <!-- Success icon -->
      <div class="flex justify-center">
        <div class="rounded-full bg-emerald-100 p-4">
          <CheckCircle class="h-12 w-12 text-emerald-600" />
        </div>
      </div>

      <div>
        <h1 class="text-2xl font-bold tracking-tight">You're all set!</h1>
        <p class="text-muted-foreground mt-2">
          You've been subscribed to the <span class="font-semibold">{{ planName }}</span> plan.
        </p>
      </div>

      <!-- Activating spinner -->
      <div v-if="isActivating" class="flex flex-col items-center gap-2 py-4">
        <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        <p class="text-sm text-muted-foreground">Activating your features...</p>
      </div>

      <!-- Go to dashboard -->
      <Button
        v-else
        size="lg"
        class="w-full"
        @click="goToDashboard"
      >
        Go to Dashboard
        <ArrowRight class="h-4 w-4 ml-2" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { Check, Zap, Loader2, AlertCircle, X, ArrowDown, RotateCcw, XCircle, Calendar, FileText, ExternalLink } from 'lucide-vue-next'
import { tansoGetStatus } from '@/lib/api'
import { toast } from 'vue-sonner'

const queryClient = useQueryClient()
const router = useRouter()
const isPending = ref(false)

const { data: statusData, isLoading } = useQuery({
  queryKey: ['tanso-status'],
  queryFn: tansoGetStatus,
  retry: 1,
  retryDelay: 2000,
})


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

function refresh() {
  queryClient.invalidateQueries({ queryKey: ['tanso-status'] })
}

const isOpeningPortal = ref(false)
async function openStripePortal() {
  isOpeningPortal.value = true
  try {
    const data = await apiPost('/tanso/portal', {})
    if (data.url) {
      window.location.href = data.url
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to open billing portal')
  } finally {
    isOpeningPortal.value = false
  }
}

const isConfigured = computed(() => statusData.value?.configured ?? false)
const plans = computed(() => {
  const raw = statusData.value?.plans || []
  return raw.map((p: any) => p.plan ? { ...p.plan, features: p.features } : p)
})
const entitlements = computed(() => statusData.value?.entitlements || [])
const customer = computed(() => statusData.value?.customer)

const currentSub = computed(() => {
  const subs = customer.value?.subscriptions || []
  return subs.find((s: any) => s.isActive) || subs[0] || null
})

const currentPlanKey = computed(() => currentSub.value?.plan?.key || null)
const currentPlanPrice = computed(() => currentSub.value?.plan?.priceAmount ?? 0)

// Subscription states
const hasScheduledCancellation = computed(() =>
  currentSub.value?.isActive &&
  currentSub.value?.cancelledAt &&
  currentSub.value?.cancelEffectiveAt &&
  new Date(currentSub.value.cancelEffectiveAt) > new Date()
)

const pendingDowngrade = computed(() =>
  currentSub.value?.scheduledChanges?.find(
    (c: any) => c.type === 'DOWNGRADE' && c.status === 'PENDING'
  ) || null
)

const billingPeriodEnd = computed(() => {
  const d = currentSub.value?.currentPeriodEnd
  return d ? new Date(d).toLocaleDateString() : null
})

const cancelEffectiveDate = computed(() => {
  const d = currentSub.value?.cancelEffectiveAt
  return d ? new Date(d).toLocaleDateString() : null
})

const meteredEntitlements = computed(() =>
  entitlements.value.filter((e: any) => e.usageLimit || e.currentUsage != null)
)

const featureLabelMap: Record<string, string> = {
  ai_insights: 'AI Insights',
}
function featureLabel(key: string) {
  return featureLabelMap[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const freePlan = computed(() => plans.value.find((p: any) => p.key === 'free'))
const growthPlan = computed(() => plans.value.find((p: any) => p.key === 'growth'))

function formatFeatureLimit(feature: any): string | boolean {
  if (!feature) return true
  if (feature.pricingType === 'usage_based' && feature.pricing) {
    const maxUsage = feature.pricing.maxUsage ?? feature.pricing.max_usage
    if (maxUsage == null) return 'Unlimited'
    const unit = (feature.pricing.unitLabel || feature.pricing.usage_unit_type || '').replace(/_/g, ' ')
    return `${maxUsage}${unit ? ` ${unit}` : ''} / month`
  }
  return true // included = boolean access
}

// Build a map of featureKey -> feature object per plan
function planFeatureMap(plan: any): Record<string, any> {
  const features = plan?.features || []
  const map: Record<string, any> = {}
  for (const f of features) map[f.key] = f
  return map
}

const featureRows = computed(() => {
  const freeFeatures = planFeatureMap(freePlan.value)
  const proFeatures = planFeatureMap(growthPlan.value)
  const allFeatures = freePlan.value?.features || growthPlan.value?.features || []
  const rows = allFeatures.map((f: any) => {
    const freeVal = formatFeatureLimit(freeFeatures[f.key])
    const proVal = formatFeatureLimit(proFeatures[f.key])
    const highlight = typeof freeVal === 'string' || typeof proVal === 'string'
    return {
      label: f.name || featureLabel(f.key),
      key: f.key,
      free: freeVal,
      pro: proVal,
      highlight,
    }
  })
  // Sort: features with limits/differences first, then identical ones
  return rows.sort((a, b) => {
    const aDiffers = a.highlight || a.free !== a.pro ? 1 : 0
    const bDiffers = b.highlight || b.free !== b.pro ? 1 : 0
    return bDiffers - aDiffers
  })
})

function getUsagePercent(e: any) {
  if (!e.usageLimit || e.usageLimit === 0) return 0
  return Math.min(100, Math.round(((e.currentUsage || 0) / e.usageLimit) * 100))
}

async function handleSubscribe(planId: string) {
  const targetPlan = plans.value.find((p: any) => p.id === planId)
  const targetPrice = targetPlan?.priceAmount ?? 0
  const isDowngrade = currentSub.value?.isActive && targetPrice < currentPlanPrice.value

  // Clear any pending states first (matches reference app Pricing.tsx)
  isPending.value = true
  try {
    if (currentSub.value?.id) {
      if (hasScheduledCancellation.value) {
        await apiPost('/tanso/reactivate', { subscriptionId: currentSub.value.id })
      }
      if (pendingDowngrade.value) {
        await apiPost('/tanso/cancel-scheduled-changes', { subscriptionId: currentSub.value.id })
      }
    }

    if (isDowngrade) {
      // Downgrade — scheduled for end of period, no checkout needed
      await apiPost('/tanso/subscribe', { planId })
      toast.success('Downgrade scheduled for end of billing period')
      refresh()
    } else {
      // Upgrade or new subscription — redirect to checkout page
      const params = new URLSearchParams({
        planId,
        planName: targetPlan?.name || 'Plan',
        planPrice: String(targetPrice),
        planDescription: targetPlan?.description || '',
        hasExistingSubscription: String(!!currentSub.value?.isActive),
        existingSubscriptionId: currentSub.value?.id || '',
      })
      router.push(`/checkout?${params.toString()}`)
    }
  } catch (error: unknown) {
    toast.error(error instanceof Error ? error.message : 'Failed to change plan')
  } finally {
    isPending.value = false
  }
}

async function handleCancel(mode: 'IMMEDIATELY' | 'END_OF_PERIOD' = 'END_OF_PERIOD') {
  if (!currentSub.value?.id) return
  isPending.value = true
  try {
    await apiPost('/tanso/cancel', { subscriptionId: currentSub.value.id, cancelMode: mode })
    toast.success(mode === 'END_OF_PERIOD'
      ? 'Subscription will cancel at end of billing period'
      : 'Subscription cancelled')
    refresh()
  } catch (error: unknown) {
    toast.error(error instanceof Error ? error.message : 'Failed to cancel')
  } finally {
    isPending.value = false
  }
}

async function handleReactivate() {
  if (!currentSub.value?.id) return
  isPending.value = true
  try {
    await apiPost('/tanso/reactivate', { subscriptionId: currentSub.value.id })
    toast.success('Subscription reactivated!')
    refresh()
  } catch (error: unknown) {
    toast.error(error instanceof Error ? error.message : 'Failed to reactivate')
  } finally {
    isPending.value = false
  }
}

async function handleCancelDowngrade() {
  if (!currentSub.value?.id) return
  isPending.value = true
  try {
    await apiPost('/tanso/cancel-scheduled-changes', { subscriptionId: currentSub.value.id })
    toast.success('Scheduled downgrade cancelled')
    refresh()
  } catch (error: unknown) {
    toast.error(error instanceof Error ? error.message : 'Failed to cancel downgrade')
  } finally {
    isPending.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Plans & Billing</h1>
        <p class="text-sm text-muted-foreground mt-1">Manage your subscription and track feature usage</p>
      </div>
      <button
        v-if="currentSub?.isActive && currentPlanPrice > 0"
        class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        :disabled="isOpeningPortal"
        @click="openStripePortal"
      >
        <Loader2 v-if="isOpeningPortal" class="h-4 w-4 animate-spin" />
        <ExternalLink v-else class="h-4 w-4" />
        Manage Billing
      </button>
    </div>

    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>

    <template v-else-if="!isConfigured">
      <div class="rounded-xl border bg-card p-8 text-center">
        <AlertCircle class="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h2 class="text-lg font-semibold">Billing Not Connected</h2>
        <p class="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          The billing system is connecting to Tanso. All features are currently available without limits.
        </p>
      </div>
    </template>

    <template v-else>
      <!-- Subscription status banner -->
      <div v-if="hasScheduledCancellation" class="rounded-xl border border-warning/30 bg-warning/10 p-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Calendar class="h-5 w-5 text-warning" />
          <div>
            <p class="text-sm font-medium text-foreground">Your subscription is cancelling</p>
            <p class="text-xs text-muted-foreground">Access continues until {{ cancelEffectiveDate }}</p>
          </div>
        </div>
        <button
          class="rounded-lg bg-warning px-3 py-1.5 text-xs font-medium text-warning-foreground hover:bg-warning/90 transition-colors disabled:opacity-50"
          :disabled="isPending"
          @click="handleReactivate"
        >
          <RotateCcw class="h-3 w-3 inline mr-1" />
          Keep Subscription
        </button>
      </div>

      <div v-if="pendingDowngrade" class="rounded-xl border border-primary/30 bg-primary/10 p-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <ArrowDown class="h-5 w-5 text-primary" />
          <div>
            <p class="text-sm font-medium text-foreground">Downgrade scheduled</p>
            <p class="text-xs text-muted-foreground">Changes at end of billing period{{ billingPeriodEnd ? ` (${billingPeriodEnd})` : '' }}</p>
          </div>
        </div>
        <button
          class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          :disabled="isPending"
          @click="handleCancelDowngrade"
        >
          <XCircle class="h-3 w-3 inline mr-1" />
          Cancel Downgrade
        </button>
      </div>

      <!-- Usage tracking -->
      <div v-if="meteredEntitlements.length > 0" class="space-y-4">
        <h2 class="text-lg font-semibold">Your Usage</h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="e in meteredEntitlements"
            :key="e.featureKey"
            class="rounded-xl border bg-card p-5"
          >
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-medium">{{ e.featureName || featureLabel(e.featureKey) }}</span>
              <span
                :class="[
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  e.allowed
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive'
                ]"
              >
                {{ e.allowed ? 'Active' : 'Limit reached' }}
              </span>
            </div>
            <div v-if="e.usageLimit" class="space-y-2">
              <div class="flex justify-between text-xs text-muted-foreground">
                <span>{{ e.currentUsage || 0 }} / {{ e.usageLimit }} used</span>
                <span>{{ e.remainingQuota ?? (e.usageLimit - (e.currentUsage || 0)) }} remaining</span>
              </div>
              <div class="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="getUsagePercent(e) >= 90 ? 'bg-destructive' : getUsagePercent(e) >= 70 ? 'bg-warning' : 'bg-success'"
                  :style="{ width: getUsagePercent(e) + '%' }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Plan cards -->
      <div v-if="freePlan && growthPlan" class="space-y-8">
        <div class="grid gap-6 sm:grid-cols-2 max-w-3xl">
          <!-- Free card -->
          <div
            :class="[
              'rounded-xl border p-6 flex flex-col',
              currentPlanKey === 'free' ? 'border-success/30 bg-success/5' : 'border-border bg-card'
            ]"
          >
            <div class="flex items-center justify-between mb-1">
              <h3 class="text-lg font-semibold">Free</h3>
              <span
                v-if="currentPlanKey === 'free'"
                class="inline-flex items-center rounded-full bg-success/10 text-success px-2.5 py-0.5 text-xs font-medium"
              >
                Current
              </span>
            </div>
            <p class="text-sm text-muted-foreground">{{ freePlan.description }}</p>
            <div class="mt-4 mb-5">
              <span class="text-4xl font-bold tracking-tight">$0</span>
              <span class="text-sm text-muted-foreground ml-1">forever</span>
            </div>

            <ul class="space-y-2.5 mb-6 flex-1">
              <li class="flex items-start gap-2 text-sm"><Check class="h-4 w-4 text-success mt-0.5 shrink-0" /> Cost tracking across all models</li>
              <li class="flex items-start gap-2 text-sm"><Check class="h-4 w-4 text-success mt-0.5 shrink-0" /> SDK and proxy integration</li>
              <li class="flex items-start gap-2 text-sm"><Check class="h-4 w-4 text-success mt-0.5 shrink-0" /> CSV data import</li>
              <li class="flex items-start gap-2 text-sm"><Check class="h-4 w-4 text-success mt-0.5 shrink-0" /> Cost alerts</li>
              <li class="flex items-start gap-2 text-sm"><Check class="h-4 w-4 text-success mt-0.5 shrink-0" /> 3 AI insights per month</li>
            </ul>

            <button
              v-if="currentPlanKey === 'growth' && !hasScheduledCancellation"
              class="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              :disabled="isPending"
              @click="handleSubscribe(freePlan.id)"
            >
              <ArrowDown class="h-4 w-4" />
              Downgrade to Free
            </button>
            <button
              v-else-if="!currentPlanKey"
              class="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              :disabled="isPending"
              @click="handleSubscribe(freePlan.id)"
            >
              Get Started
            </button>
            <div
              v-else-if="currentPlanKey === 'free'"
              class="w-full rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-sm font-medium text-success text-center"
            >
              <Check class="h-4 w-4 inline mr-1" />
              Your current plan
            </div>
          </div>

          <!-- Growth card -->
          <div
            :class="[
              'rounded-xl border-2 p-6 flex flex-col relative',
              currentPlanKey === 'growth' ? 'border-success/40 bg-success/5' : 'border-primary bg-card shadow-md'
            ]"
          >
            <div
              v-if="currentPlanKey !== 'growth'"
              class="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground tracking-wide"
            >
              RECOMMENDED
            </div>
            <div class="flex items-center justify-between mb-1">
              <h3 class="text-lg font-semibold">Growth</h3>
              <span
                v-if="currentPlanKey === 'growth'"
                class="inline-flex items-center rounded-full bg-success/10 text-success px-2.5 py-0.5 text-xs font-medium"
              >
                Current
              </span>
            </div>
            <p class="text-sm text-muted-foreground">{{ growthPlan.description }}</p>
            <div class="mt-4 mb-5">
              <span class="text-4xl font-bold tracking-tight">${{ growthPlan.priceAmount }}</span>
              <span class="text-sm text-muted-foreground ml-1">/ month</span>
            </div>

            <ul class="space-y-2.5 mb-6 flex-1">
              <li class="flex items-start gap-2 text-sm font-medium"><Zap class="h-4 w-4 text-primary mt-0.5 shrink-0" /> Unlimited AI insights</li>
              <li class="flex items-start gap-2 text-sm"><Check class="h-4 w-4 text-success mt-0.5 shrink-0" /> Everything in Free</li>
              <li class="flex items-start gap-2 text-sm"><Check class="h-4 w-4 text-success mt-0.5 shrink-0" /> Priority support</li>
            </ul>

            <button
              v-if="currentPlanKey !== 'growth'"
              class="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              :disabled="isPending"
              @click="handleSubscribe(growthPlan.id)"
            >
              <Zap class="h-4 w-4" />
              Upgrade to Growth
            </button>
            <template v-else>
              <div
                class="w-full rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-sm font-medium text-success text-center"
              >
                <Check class="h-4 w-4 inline mr-1" />
                Your current plan
              </div>
              <div v-if="billingPeriodEnd" class="mt-3 text-xs text-muted-foreground text-center">
                Renews {{ billingPeriodEnd }}
              </div>
              <button
                v-if="!hasScheduledCancellation"
                class="mt-3 w-full text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                :disabled="isPending"
                @click="handleCancel('END_OF_PERIOD')"
              >
                Cancel subscription
              </button>
            </template>
          </div>
        </div>
      </div>

      <div v-if="plans.length === 0 && entitlements.length === 0" class="rounded-xl border bg-card p-8 text-center">
        <AlertCircle class="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h2 class="text-lg font-semibold">No Plans Available Yet</h2>
        <p class="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Plans haven't been configured yet. All features are currently available without limits.
        </p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { CreditCard, Check, Zap, Loader2, AlertCircle, Infinity } from 'lucide-vue-next'
import { tansoGetStatus, tansoSubscribe } from '@/lib/api'
import { toast } from 'vue-sonner'

const queryClient = useQueryClient()

const { data: statusData, isLoading, isError: hasError } = useQuery({
  queryKey: ['tanso-status'],
  queryFn: tansoGetStatus,
  retry: 1,
  retryDelay: 2000,
})

const subscribeMutation = useMutation({
  mutationFn: (planId: string) => tansoSubscribe(planId),
  onSuccess: () => {
    toast.success('Subscription created successfully!')
    queryClient.invalidateQueries({ queryKey: ['tanso-status'] })
  },
  onError: (error: Error) => {
    toast.error(error.message || 'Failed to subscribe')
  },
})

const isConfigured = computed(() => statusData.value?.configured ?? false)
const plans = computed(() => statusData.value?.plans || [])
const entitlements = computed(() => statusData.value?.entitlements || [])
const customer = computed(() => statusData.value?.customer)

const activeSubscriptions = computed(() => {
  if (!customer.value?.subscriptions) return []
  return customer.value.subscriptions.filter((s: any) => s.status === 'ACTIVE' || s.status === 'active')
})

const currentPlanKey = computed(() => {
  if (!activeSubscriptions.value.length) return null
  const sub = activeSubscriptions.value[0]
  return sub.planKey || sub.plan?.key || null
})

// Sorted plans: free first, then pro
const sortedPlans = computed(() => {
  const p = [...plans.value]
  p.sort((a: any, b: any) => {
    const priceA = Number(a.priceAmount) || 0
    const priceB = Number(b.priceAmount) || 0
    return priceA - priceB
  })
  return p
})

const gatedFeatureKeys = ['ai_insights', 'simulations']

function isGatedFeature(featureKey: string) {
  return gatedFeatureKeys.includes(featureKey)
}

function isPro(plan: any) {
  return plan.key === 'pro'
}

function getFeatureLabel(feature: any, plan: any) {
  const key = feature.key || feature.featureKey
  const name = feature.name || feature.featureName || key
  if (!isGatedFeature(key)) return name
  if (isPro(plan)) return `Unlimited ${name.toLowerCase()}`
  if (key === 'ai_insights') return `${name} (3/mo)`
  if (key === 'simulations') return `${name} (2/mo)`
  return name
}

function formatPrice(amount: string | number) {
  const num = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0)
  if (isNaN(num)) return '$0'
  if (num === 0) return 'Free'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(num)
}

function getUsagePercent(e: any) {
  if (!e.usageLimit || e.usageLimit === 0) return 0
  return Math.min(100, Math.round(((e.currentUsage || 0) / e.usageLimit) * 100))
}

function handleSubscribe(planId: string) {
  subscribeMutation.mutate(planId)
}
</script>

<template>
  <div class="space-y-8">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Plans & Billing</h1>
      <p class="text-sm text-muted-foreground mt-1">Manage your subscription and track feature usage</p>
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
          Once your Tanso account is fully configured, plans and usage tracking will appear here.
        </p>
      </div>
    </template>

    <template v-else>
      <!-- Usage tracking -->
      <div v-if="entitlements.length > 0" class="space-y-4">
        <h2 class="text-lg font-semibold">Your Usage</h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="e in entitlements"
            :key="e.featureKey"
            class="rounded-xl border bg-card p-5"
          >
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-medium">{{ e.featureName || e.featureKey }}</span>
              <span
                :class="[
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  e.allowed
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                    : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
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
                  :class="getUsagePercent(e) >= 90 ? 'bg-red-500' : getUsagePercent(e) >= 70 ? 'bg-amber-500' : 'bg-emerald-500'"
                  :style="{ width: getUsagePercent(e) + '%' }"
                />
              </div>
            </div>
            <div v-else class="text-xs text-muted-foreground">
              <Check class="h-3.5 w-3.5 inline mr-1 text-emerald-500" />
              Unlimited access
            </div>
          </div>
        </div>
      </div>

      <!-- Active subscription -->
      <div v-if="activeSubscriptions.length > 0" class="space-y-4">
        <h2 class="text-lg font-semibold">Active Subscription</h2>
        <div
          v-for="sub in activeSubscriptions"
          :key="sub.id"
          class="rounded-xl border bg-card p-5"
        >
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <CreditCard class="h-5 w-5 text-primary" />
            </div>
            <div>
              <p class="font-medium">{{ sub.planName || sub.plan?.name || 'Current Plan' }}</p>
              <p class="text-xs text-muted-foreground">{{ sub.status }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Plans comparison -->
      <div v-if="sortedPlans.length > 0" class="space-y-4">
        <h2 class="text-lg font-semibold">Available Plans</h2>
        <div class="grid gap-6 sm:grid-cols-2 max-w-3xl">
          <div
            v-for="plan in sortedPlans"
            :key="plan.id"
            :class="[
              'rounded-xl border p-6 flex flex-col relative',
              isPro(plan)
                ? 'border-primary bg-card shadow-sm'
                : 'border-border bg-card'
            ]"
          >
            <!-- Recommended badge -->
            <div
              v-if="isPro(plan)"
              class="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground"
            >
              Recommended
            </div>

            <!-- Current plan badge -->
            <div
              v-if="currentPlanKey === plan.key"
              class="absolute -top-3 right-4 inline-flex items-center rounded-full bg-emerald-500 px-3 py-0.5 text-xs font-medium text-white"
            >
              Current plan
            </div>

            <h3 class="text-lg font-semibold">{{ plan.name || plan.key }}</h3>
            <p v-if="plan.description" class="text-sm text-muted-foreground mt-1">{{ plan.description }}</p>

            <div class="mt-4 mb-6">
              <span class="text-3xl font-bold tabular-nums">{{ formatPrice(plan.priceAmount) }}</span>
              <span v-if="Number(plan.priceAmount) > 0" class="text-sm text-muted-foreground">/mo</span>
            </div>

            <ul v-if="plan.features?.length" class="space-y-2.5 mb-6 flex-1">
              <li
                v-for="f in plan.features"
                :key="f.id || f.key"
                class="flex items-start gap-2 text-sm"
              >
                <Check
                  :class="[
                    'h-4 w-4 shrink-0 mt-0.5',
                    isGatedFeature(f.key || f.featureKey) && isPro(plan)
                      ? 'text-primary'
                      : 'text-emerald-500'
                  ]"
                />
                <span :class="isGatedFeature(f.key || f.featureKey) && isPro(plan) ? 'font-medium' : ''">
                  {{ getFeatureLabel(f, plan) }}
                </span>
              </li>
            </ul>

            <button
              v-if="currentPlanKey !== plan.key"
              :class="[
                'w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2',
                isPro(plan)
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              ]"
              :disabled="subscribeMutation.isPending.value"
              @click="handleSubscribe(plan.id)"
            >
              <Zap v-if="isPro(plan)" class="h-4 w-4" />
              {{ isPro(plan) ? 'Upgrade to Pro' : 'Start Free' }}
            </button>
            <div
              v-else
              class="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 text-center"
            >
              <Check class="h-4 w-4 inline mr-1" />
              Your current plan
            </div>
          </div>
        </div>
      </div>

      <div v-if="sortedPlans.length === 0 && entitlements.length === 0" class="rounded-xl border bg-card p-8 text-center">
        <CreditCard class="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h2 class="text-lg font-semibold">No Plans Available Yet</h2>
        <p class="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Plans haven't been configured yet. All features are currently available without limits.
        </p>
      </div>
    </template>
  </div>
</template>

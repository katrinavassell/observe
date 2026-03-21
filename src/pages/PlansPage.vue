<script setup lang="ts">
import { computed } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { Check, Zap, Loader2, AlertCircle, Minus, X } from 'lucide-vue-next'
import { tansoGetStatus, tansoSubscribe } from '@/lib/api'
import { toast } from 'vue-sonner'

const queryClient = useQueryClient()

const { data: statusData, isLoading } = useQuery({
  queryKey: ['tanso-status'],
  queryFn: tansoGetStatus,
  retry: 1,
  retryDelay: 2000,
})

const subscribeMutation = useMutation({
  mutationFn: (planId: string) => tansoSubscribe(planId),
  onSuccess: (data: any) => {
    if (data.checkoutUrl) {
      window.open(data.checkoutUrl, '_blank')
      return
    }
    toast.success('Subscription created successfully!')
    queryClient.invalidateQueries({ queryKey: ['tanso-status'] })
  },
  onError: (error: Error) => {
    toast.error(error.message || 'Failed to subscribe')
  },
})

const isConfigured = computed(() => statusData.value?.configured ?? false)
const plans = computed(() => {
  const raw = statusData.value?.plans || []
  return raw.map((p: any) => p.plan ? { ...p.plan, features: p.features } : p)
})
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

const freePlan = computed(() => plans.value.find((p: any) => p.key === 'free'))
const proPlan = computed(() => plans.value.find((p: any) => p.key === 'pro'))

// Feature comparison rows for the table
const featureRows = computed(() => [
  { label: 'AI Insights', key: 'ai_insights', free: '3 / month', pro: 'Unlimited', highlight: true },
  { label: 'Simulations', key: 'simulations', free: '2 / month', pro: 'Unlimited', highlight: true },
  { label: 'SaaS Metrics Dashboard', key: 'saas_metrics', free: true, pro: true },
  { label: 'Plan Health Analysis', key: 'plan_health', free: true, pro: true },
  { label: 'Usage Anomaly Detection', key: 'usage_anomalies', free: true, pro: true },
  { label: 'Negative Margin Analysis', key: 'negative_margin', free: true, pro: true },
  { label: 'Stripe Connection', key: 'stripe_connection', free: true, pro: true },
  { label: 'AI Provider Connection', key: 'ai_provider_connection', free: true, pro: true },
  { label: 'CSV Uploads', key: 'csv_upload', free: true, pro: true },
  { label: 'Sample Data', key: 'sample_data', free: true, pro: true },
])

function getUsagePercent(e: any) {
  if (!e.usageLimit || e.usageLimit === 0) return 0
  return Math.min(100, Math.round(((e.currentUsage || 0) / e.usageLimit) * 100))
}

function handleSubscribe(planId: string) {
  subscribeMutation.mutate(planId)
}
</script>

<template>
  <div class="space-y-10">
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
        </p>
      </div>
    </template>

    <template v-else>
      <!-- Usage tracking (only gated features) -->
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
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-red-700'
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

      <!-- Plan cards + comparison table -->
      <div v-if="freePlan && proPlan" class="space-y-8">
        <!-- Cards -->
        <div class="grid gap-6 sm:grid-cols-2 max-w-3xl">
          <!-- Free card -->
          <div
            :class="[
              'rounded-xl border p-6 flex flex-col',
              currentPlanKey === 'free' ? 'border-emerald-300 bg-emerald-50/30' : 'border-border bg-card'
            ]"
          >
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">Free</h3>
              <span
                v-if="currentPlanKey === 'free'"
                class="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-0.5 text-xs font-medium"
              >
                Current
              </span>
            </div>
            <p class="text-sm text-muted-foreground mt-1">{{ freePlan.description }}</p>
            <div class="mt-4 mb-6">
              <span class="text-4xl font-bold tracking-tight">$0</span>
              <span class="text-sm text-muted-foreground ml-1">forever</span>
            </div>
            <button
              v-if="currentPlanKey !== 'free'"
              class="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              :disabled="subscribeMutation.isPending.value"
              @click="handleSubscribe(freePlan.id)"
            >
              Start Free
            </button>
            <div
              v-else
              class="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 text-center"
            >
              <Check class="h-4 w-4 inline mr-1" />
              Your current plan
            </div>
          </div>

          <!-- Pro card -->
          <div
            :class="[
              'rounded-xl border-2 p-6 flex flex-col relative',
              currentPlanKey === 'pro' ? 'border-emerald-400 bg-emerald-50/30' : 'border-primary bg-card shadow-md'
            ]"
          >
            <div
              v-if="currentPlanKey !== 'pro'"
              class="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground tracking-wide"
            >
              RECOMMENDED
            </div>
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">Pro</h3>
              <span
                v-if="currentPlanKey === 'pro'"
                class="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-0.5 text-xs font-medium"
              >
                Current
              </span>
            </div>
            <p class="text-sm text-muted-foreground mt-1">{{ proPlan.description }}</p>
            <div class="mt-4 mb-6">
              <span class="text-4xl font-bold tracking-tight">$12</span>
              <span class="text-sm text-muted-foreground ml-1">/ month</span>
            </div>
            <button
              v-if="currentPlanKey !== 'pro'"
              class="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              :disabled="subscribeMutation.isPending.value"
              @click="handleSubscribe(proPlan.id)"
            >
              <Zap class="h-4 w-4" />
              Upgrade to Pro
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

        <!-- Comparison table -->
        <div class="max-w-3xl">
          <h3 class="text-base font-semibold mb-4">Compare plans</h3>
          <div class="rounded-xl border overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b bg-muted/50">
                  <th class="text-left py-3 px-4 font-medium text-muted-foreground w-1/2">Feature</th>
                  <th class="text-center py-3 px-4 font-medium text-muted-foreground w-1/4">Free</th>
                  <th class="text-center py-3 px-4 font-medium w-1/4">
                    <span class="inline-flex items-center gap-1 text-primary">
                      Pro
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, i) in featureRows"
                  :key="row.key"
                  :class="[
                    i < featureRows.length - 1 ? 'border-b' : '',
                    row.highlight ? 'bg-primary/[0.02]' : ''
                  ]"
                >
                  <td class="py-3 px-4" :class="row.highlight ? 'font-medium' : ''">
                    {{ row.label }}
                  </td>
                  <td class="py-3 px-4 text-center">
                    <template v-if="row.free === true">
                      <Check class="h-4 w-4 text-emerald-500 mx-auto" />
                    </template>
                    <template v-else-if="row.free === false">
                      <X class="h-4 w-4 text-muted-foreground/40 mx-auto" />
                    </template>
                    <template v-else>
                      <span class="text-muted-foreground">{{ row.free }}</span>
                    </template>
                  </td>
                  <td class="py-3 px-4 text-center">
                    <template v-if="row.pro === true">
                      <Check class="h-4 w-4 text-emerald-500 mx-auto" />
                    </template>
                    <template v-else-if="row.pro === false">
                      <X class="h-4 w-4 text-muted-foreground/40 mx-auto" />
                    </template>
                    <template v-else>
                      <span class="font-medium text-primary">{{ row.pro }}</span>
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div v-else-if="plans.length === 0 && entitlements.length === 0" class="rounded-xl border bg-card p-8 text-center">
        <AlertCircle class="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h2 class="text-lg font-semibold">No Plans Available Yet</h2>
        <p class="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Plans haven't been configured yet. All features are currently available without limits.
        </p>
      </div>
    </template>
  </div>
</template>

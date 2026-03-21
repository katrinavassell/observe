<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { CreditCard, Check, Zap, ArrowUpRight, Loader2, AlertCircle } from 'lucide-vue-next'
import { tansoGetStatus, tansoSubscribe } from '@/lib/api'
import { toast } from 'vue-sonner'

const queryClient = useQueryClient()

const { data: statusData, isLoading: isLoading, isError: hasError } = useQuery({
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

function formatPrice(amount: string | number) {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num)
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

      <div v-if="plans.length > 0" class="space-y-4">
        <h2 class="text-lg font-semibold">Available Plans</h2>
        <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="plan in plans"
            :key="plan.id"
            class="rounded-xl border bg-card p-6 flex flex-col"
          >
            <h3 class="text-lg font-semibold">{{ plan.name }}</h3>
            <p v-if="plan.description" class="text-sm text-muted-foreground mt-1">{{ plan.description }}</p>
            <div class="mt-4 mb-6">
              <span class="text-3xl font-bold tabular-nums">{{ formatPrice(plan.priceAmount ?? 0) }}</span>
              <span class="text-sm text-muted-foreground">/{{ String(plan.intervalMonths) === '1' ? 'mo' : plan.intervalMonths + ' mo' }}</span>
            </div>
            <ul v-if="plan.features?.length" class="space-y-2 mb-6 flex-1">
              <li v-for="f in plan.features" :key="f.id || f.key" class="flex items-start gap-2 text-sm">
                <Check class="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>{{ f.name || f.featureKey || f.key }}</span>
              </li>
            </ul>
            <button
              class="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              :disabled="subscribeMutation.isPending.value"
              @click="handleSubscribe(plan.id)"
            >
              <Zap class="h-4 w-4" />
              Subscribe
            </button>
          </div>
        </div>
      </div>

      <div v-if="plans.length === 0 && entitlements.length === 0" class="rounded-xl border bg-card p-8 text-center">
        <CreditCard class="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h2 class="text-lg font-semibold">No Plans Available Yet</h2>
        <p class="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Plans haven't been configured yet. All features are currently available without limits.
        </p>
      </div>
    </template>
  </div>
</template>

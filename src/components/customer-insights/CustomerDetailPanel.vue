<script setup lang="ts">
/**
 * CustomerDetailPanel - Slide-out panel showing customer details
 */

import { computed } from 'vue'
import {
  X,
  Mail,
  Calendar,
  Package,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Clock,
} from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@/components/ui'
import { formatCurrency, formatPercent } from '@/lib/utils'
import type { CustomerInsight } from '@/api/client'

// =============================================================================
// PROPS & EMITS
// =============================================================================

const props = defineProps<{
  customer: CustomerInsight | null
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

// =============================================================================
// COMPUTED
// =============================================================================

const riskColor = computed(() => {
  if (!props.customer) return ''
  const colors = {
    high: 'text-red-600 bg-red-50',
    medium: 'text-amber-600 bg-amber-50',
    low: 'text-green-600 bg-green-50',
  }
  return colors[props.customer.riskLevel]
})

const statusBadgeVariant = computed(() => {
  if (!props.customer) return 'outline' as const
  const variants = {
    active: 'outline' as const,
    trial: 'secondary' as const,
    churned: 'destructive' as const,
  }
  return variants[props.customer.status]
})

const netMargin = computed(() => {
  if (!props.customer) return 0
  return props.customer.mrr - (props.customer.usageCost || 0)
})
</script>

<template>
  <!-- Backdrop -->
  <Transition name="fade">
    <div
      v-if="open"
      class="fixed inset-0 bg-black/50 z-40"
      @click="emit('close')"
    />
  </Transition>

  <!-- Panel -->
  <Transition name="slide">
    <div
      v-if="open && customer"
      class="fixed right-0 top-0 h-full w-full max-w-md bg-background shadow-xl z-50 overflow-y-auto"
    >
      <!-- Header -->
      <div class="sticky top-0 bg-background border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold">{{ customer.customerName }}</h2>
          <p class="text-sm text-muted-foreground">{{ customer.email }}</p>
        </div>
        <Button variant="ghost" size="sm" @click="emit('close')">
          <X class="h-5 w-5" />
        </Button>
      </div>

      <!-- Content -->
      <div class="p-6 space-y-6">
        <!-- Status & Risk -->
        <div class="flex items-center gap-3">
          <Badge :variant="statusBadgeVariant" class="capitalize">
            {{ customer.status }}
          </Badge>
          <Badge variant="outline" :class="riskColor">
            <component
              :is="customer.riskLevel === 'high' ? AlertTriangle : customer.riskLevel === 'low' ? CheckCircle : Clock"
              class="h-3 w-3 mr-1"
            />
            {{ customer.riskLevel }} risk
          </Badge>
        </div>

        <!-- Key Metrics -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-base">Revenue & Profitability</CardTitle>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <p class="text-sm text-muted-foreground">MRR</p>
                <p class="text-xl font-bold">{{ formatCurrency(customer.mrr) }}</p>
              </div>
              <div>
                <p class="text-sm text-muted-foreground">Usage Cost</p>
                <p class="text-xl font-bold">{{ customer.usageCost ? formatCurrency(customer.usageCost) : 'N/A' }}</p>
              </div>
              <div>
                <p class="text-sm text-muted-foreground">Net Margin $</p>
                <p class="text-xl font-bold" :class="netMargin >= 0 ? 'text-green-600' : 'text-red-600'">
                  {{ formatCurrency(netMargin) }}
                </p>
              </div>
              <div>
                <p class="text-sm text-muted-foreground">True Margin %</p>
                <div class="flex items-center gap-2">
                  <component
                    :is="customer.trueMargin > 0 ? TrendingUp : TrendingDown"
                    class="h-5 w-5"
                    :class="customer.trueMargin > 0 ? 'text-green-500' : 'text-red-500'"
                  />
                  <p class="text-xl font-bold" :class="customer.trueMargin > 0 ? 'text-green-600' : 'text-red-600'">
                    {{ formatPercent(customer.trueMargin / 100) }}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Customer Details -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent class="space-y-3">
            <div class="flex items-center gap-3">
              <Package class="h-4 w-4 text-muted-foreground" />
              <div>
                <p class="text-sm font-medium">{{ customer.planName }}</p>
                <p class="text-xs text-muted-foreground">Current Plan</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <Calendar class="h-4 w-4 text-muted-foreground" />
              <div>
                <p class="text-sm font-medium">{{ customer.tenureMonths }} months</p>
                <p class="text-xs text-muted-foreground">Customer tenure</p>
              </div>
            </div>
            <div v-if="customer.company" class="flex items-center gap-3">
              <Mail class="h-4 w-4 text-muted-foreground" />
              <div>
                <p class="text-sm font-medium">{{ customer.company }}</p>
                <p class="text-xs text-muted-foreground">Company</p>
              </div>
            </div>
            <div v-if="customer.segment" class="flex items-center gap-3">
              <div class="h-4 w-4 flex items-center justify-center text-muted-foreground text-xs font-bold">S</div>
              <div>
                <p class="text-sm font-medium">{{ customer.segment }}</p>
                <p class="text-xs text-muted-foreground">Segment</p>
              </div>
            </div>
            <div v-if="customer.renewalDate" class="flex items-center gap-3">
              <Clock class="h-4 w-4 text-muted-foreground" />
              <div>
                <p class="text-sm font-medium">{{ new Date(customer.renewalDate).toLocaleDateString() }}</p>
                <p class="text-xs text-muted-foreground">Renewal Date</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Usage -->
        <Card v-if="customer.usagePercentage !== undefined">
          <CardHeader class="pb-3">
            <CardTitle class="text-base">Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-2">
              <div class="flex justify-between text-sm">
                <span class="text-muted-foreground">Plan Utilization</span>
                <span class="font-medium">{{ customer.usagePercentage.toFixed(0) }}%</span>
              </div>
              <div class="w-full bg-muted rounded-full h-2">
                <div
                  class="h-2 rounded-full transition-all"
                  :class="customer.usagePercentage > 80 ? 'bg-amber-500' : 'bg-primary'"
                  :style="{ width: `${Math.min(customer.usagePercentage, 100)}%` }"
                />
              </div>
              <p v-if="customer.usagePercentage > 80" class="text-xs text-amber-600">
                High usage - consider upgrade recommendation
              </p>
            </div>
          </CardContent>
        </Card>

        <!-- Actions -->
        <div class="space-y-2">
          <Button variant="outline" class="w-full justify-start">
            <Mail class="h-4 w-4 mr-2" />
            Contact Customer
          </Button>
          <Button variant="outline" class="w-full justify-start">
            <Package class="h-4 w-4 mr-2" />
            Change Plan
          </Button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>

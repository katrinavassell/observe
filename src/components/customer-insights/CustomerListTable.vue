<script setup lang="ts">
/**
 * CustomerListTable - Sortable customer table with key metrics and actions
 */

import { TrendingUp, TrendingDown, ChevronRight, AlertTriangle } from 'lucide-vue-next'
import { Badge, Button } from '@/components/ui'
import { formatCurrency, formatPercent } from '@/lib/utils'
import type { CustomerInsight } from '@/api/client'

// =============================================================================
// PROPS & EMITS
// =============================================================================

defineProps<{
  customers: CustomerInsight[]
  isLoading: boolean
}>()

const emit = defineEmits<{
  selectCustomer: [customer: CustomerInsight]
}>()

// =============================================================================
// HANDLERS
// =============================================================================

function handleSelectCustomer(customer: CustomerInsight) {
  emit('selectCustomer', customer)
}
</script>

<template>
  <div class="overflow-x-auto rounded-lg border">
    <table class="w-full">
      <thead class="bg-muted/50">
        <tr>
          <th class="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Customer
          </th>
          <th class="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Plan
          </th>
          <th class="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            MRR
          </th>
          <th class="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Cost
          </th>
          <th class="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            True Margin
          </th>
          <th class="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Status
          </th>
          <th class="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Actions
          </th>
        </tr>
      </thead>
      <tbody class="divide-y">
        <!-- Loading State -->
        <tr v-if="isLoading">
          <td colspan="7" class="py-8 text-center">
            <div class="flex justify-center">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          </td>
        </tr>

        <!-- Empty State -->
        <tr v-else-if="customers.length === 0">
          <td colspan="7" class="py-8 text-center text-muted-foreground">
            No customers found. Try adjusting your filters.
          </td>
        </tr>

        <!-- Customer Rows -->
        <tr
          v-for="customer in customers"
          :key="customer.customerId"
          class="hover:bg-muted/30 cursor-pointer group"
          @click="handleSelectCustomer(customer)"
        >
          <!-- Customer Info -->
          <td class="py-3 px-4">
            <div class="flex items-center">
              <div class="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                {{ customer.customerName.charAt(0).toUpperCase() }}
              </div>
              <div class="ml-3">
                <div class="flex items-center gap-2">
                  <p class="text-sm font-medium">{{ customer.customerName }}</p>
                  <Badge v-if="customer.riskLevel === 'high'" variant="destructive" class="text-xs">
                    <AlertTriangle class="h-3 w-3 mr-1" />
                    High Risk
                  </Badge>
                </div>
                <p class="text-xs text-muted-foreground truncate max-w-[200px]">{{ customer.email }}</p>
                <p v-if="customer.company" class="text-xs text-muted-foreground/70">{{ customer.company }}</p>
              </div>
            </div>
          </td>

          <!-- Plan -->
          <td class="py-3 px-4">
            <Badge variant="outline">{{ customer.planName }}</Badge>
            <p class="text-xs text-muted-foreground mt-1">{{ customer.tenureMonths }} months</p>
          </td>

          <!-- MRR -->
          <td class="py-3 px-4 text-right">
            <div class="text-sm font-semibold">{{ formatCurrency(customer.mrr) }}</div>
            <div v-if="customer.usagePercentage" class="text-xs text-muted-foreground">
              {{ customer.usagePercentage.toFixed(0) }}% usage
            </div>
          </td>

          <!-- Cost -->
          <td class="py-3 px-4 text-right">
            <div class="text-sm" :class="customer.usageCost ? '' : 'text-muted-foreground'">
              {{ customer.usageCost ? formatCurrency(customer.usageCost) : 'N/A' }}
            </div>
          </td>

          <!-- True Margin -->
          <td class="py-3 px-4 text-right">
            <div class="flex items-center justify-end gap-2">
              <component
                :is="customer.trueMargin > 0 ? TrendingUp : TrendingDown"
                class="h-4 w-4"
                :class="customer.trueMargin > 0 ? 'text-green-500' : 'text-red-500'"
              />
              <span
                class="font-semibold"
                :class="customer.trueMargin > 0 ? 'text-green-600' : 'text-red-600'"
              >
                {{ formatPercent(customer.trueMargin / 100) }}
              </span>
            </div>
          </td>

          <!-- Status -->
          <td class="py-3 px-4 text-center">
            <Badge
              :variant="customer.status === 'active' ? 'outline' : customer.status === 'trial' ? 'secondary' : 'destructive'"
            >
              {{ customer.status }}
            </Badge>
          </td>

          <!-- Actions -->
          <td class="py-3 px-4 text-center">
            <Button
              variant="ghost"
              size="sm"
              class="opacity-0 group-hover:opacity-100 transition-opacity"
              @click.stop="handleSelectCustomer(customer)"
            >
              <ChevronRight class="h-4 w-4" />
              <span class="sr-only">View details</span>
            </Button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { Settings } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui'
import type { SimulationAssumptions as AssumptionsType, SimulationSummary } from '@/types/simulation'

defineProps<{
  assumptions: AssumptionsType
  summary: SimulationSummary
}>()
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-base flex items-center gap-2">
        <Settings class="h-4 w-4" />
        Simulation Assumptions
      </CardTitle>
    </CardHeader>
    <CardContent class="space-y-3">
      <div class="flex justify-between">
        <span class="text-sm text-muted-foreground">Pricing Model</span>
        <span class="font-medium">{{ summary.pricingModel }}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-sm text-muted-foreground">Billing Period</span>
        <span class="font-medium">{{ summary.billingPeriod }}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-sm text-muted-foreground">Growth Rate</span>
        <span class="font-medium">{{ (assumptions.growthRate * 100).toFixed(1) }}% monthly</span>
      </div>
      <div class="flex justify-between">
        <span class="text-sm text-muted-foreground">Date Range</span>
        <span class="font-medium text-xs">
          {{ assumptions.dateRange.start }} to {{ assumptions.dateRange.end }}
        </span>
      </div>
      <div v-if="assumptions.dataSources.length > 0" class="pt-3 border-t">
        <p class="text-sm font-medium mb-2">Data Sources:</p>
        <div class="space-y-1">
          <div
            v-for="source in assumptions.dataSources"
            :key="source.id"
            class="text-sm text-muted-foreground flex items-center gap-2"
          >
            <span class="w-2 h-2 rounded-full bg-green-500"></span>
            {{ source.name }}
            <Badge variant="outline" class="text-xs">
              {{ source.dataTypes.join(', ') }}
            </Badge>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

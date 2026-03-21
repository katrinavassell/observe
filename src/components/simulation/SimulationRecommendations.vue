<script setup lang="ts">
import { TrendingUp } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import type { PricingRecommendation } from '@/types/simulation'

defineProps<{
  recommendations: PricingRecommendation
}>()
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-base flex items-center gap-2">
        <TrendingUp class="h-4 w-4" />
        Pricing Recommendations
      </CardTitle>
    </CardHeader>
    <CardContent class="space-y-3">
      <div class="flex justify-between items-center">
        <span class="text-sm text-muted-foreground">Current Implied Price</span>
        <span class="font-medium">${{ recommendations.currentImpliedPrice.toFixed(2) }}/M tokens</span>
      </div>
      <div class="flex justify-between items-center">
        <span class="text-sm text-muted-foreground">Break-even Price</span>
        <span class="font-medium text-red-600">${{ recommendations.breakEvenPrice.toFixed(2) }}/M tokens</span>
      </div>
      <div class="border-t pt-3 mt-3">
        <p class="text-xs text-muted-foreground mb-2">Recommended prices for target margins:</p>
        <div class="grid grid-cols-2 gap-2">
          <div class="flex justify-between items-center">
            <span class="text-sm text-muted-foreground">20% Margin</span>
            <span class="font-medium text-yellow-600">
              ${{ recommendations.recommendedPriceFor20Percent.toFixed(2) }}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-sm text-muted-foreground">30% Margin</span>
            <span class="font-medium text-green-600">
              ${{ recommendations.recommendedPriceFor30Percent.toFixed(2) }}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-sm text-muted-foreground">40% Margin</span>
            <span class="font-medium text-green-600">
              ${{ recommendations.recommendedPriceFor40Percent.toFixed(2) }}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-sm text-muted-foreground">50% Margin</span>
            <span class="font-medium text-green-700">
              ${{ recommendations.recommendedPriceFor50Percent.toFixed(2) }}
            </span>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

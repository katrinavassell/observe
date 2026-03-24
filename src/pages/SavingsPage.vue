<script setup lang="ts">
// Terminology: "model swap", "underwater", "potential savings", "current → optimized"
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { PiggyBank, ArrowRight, AlertTriangle, Loader2, TrendingDown, FlaskConical } from 'lucide-vue-next'
import { useDemoMode } from '@/composables/useDemoMode'
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui'
import { fetchModelSwapRecommendations, fetchUnderwaterCustomers } from '@/lib/api'

const router = useRouter()
const { enterDemoMode, isLoadingDemo } = useDemoMode()

const { data: swapData, isLoading: swapLoading } = useQuery({
  queryKey: ['recommendations-model-swap'],
  queryFn: () => fetchModelSwapRecommendations(90),
})

const { data: underwaterData, isLoading: underwaterLoading } = useQuery({
  queryKey: ['recommendations-underwater'],
  queryFn: () => fetchUnderwaterCustomers(90),
})

const isLoading = computed(() => swapLoading.value || underwaterLoading.value)
const recommendations = computed(() => swapData.value?.recommendations || [])
const totalSavings = computed(() => swapData.value?.total_potential_savings || 0)
const underwaterCustomers = computed(() => underwaterData.value?.customers || [])
const totalLoss = computed(() => underwaterCustomers.value.reduce((s, c) => s + c.loss_amount, 0))

const hasAnyData = computed(() => recommendations.value.length > 0 || underwaterCustomers.value.length > 0)

function formatCurrency(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  if (n >= 1) return `$${n.toFixed(0)}`
  return `$${n.toFixed(4)}`
}
</script>

<template>
  <div class="space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Savings</h1>
      <p class="text-muted-foreground text-sm">Actionable recommendations to reduce AI costs and improve margins</p>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>

    <template v-else-if="hasAnyData">
      <!-- Aggregate savings hero -->
      <Card v-if="totalSavings > 0" class="border-success/20 bg-success/5">
        <CardContent class="p-6">
          <p class="text-xs font-medium text-muted-foreground mb-1">Total Potential Savings</p>
          <p class="text-3xl font-bold text-success tabular-nums tracking-tight">
            {{ formatCurrency(totalSavings) }}<span class="text-lg font-medium text-muted-foreground">/mo</span>
          </p>
          <div class="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
            <span>{{ formatCurrency(totalSavings * 12) }}/year</span>
            <span>&middot;</span>
            <span>{{ recommendations.length }} recommendation{{ recommendations.length === 1 ? '' : 's' }}</span>
          </div>
        </CardContent>
      </Card>

      <!-- Model Swap Recommendations -->
      <div v-if="recommendations.length > 0" class="space-y-3">
        <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Model Swap Recommendations</h2>

        <div v-for="rec in recommendations" :key="rec.feature_key"
          class="group rounded-lg border bg-card p-5 transition-colors hover:border-success/30">
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-3 flex-1 min-w-0">
              <!-- Header row -->
              <div class="flex items-center gap-2.5">
                <span class="text-sm font-semibold">{{ rec.feature_key }}</span>
                <span class="text-[10px] font-semibold uppercase tracking-wide bg-success/10 text-success px-2 py-0.5 rounded">Optimization</span>
              </div>

              <!-- Swap visual -->
              <div class="flex items-center gap-3">
                <div class="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5">
                  <span class="text-xs text-muted-foreground">{{ formatCurrency(rec.total_cost) }}/mo</span>
                  <code class="text-[11px] font-medium text-foreground">{{ rec.current_model }}</code>
                </div>
                <ArrowRight class="h-4 w-4 text-success shrink-0" />
                <div class="flex items-center gap-2 rounded-md bg-success/10 px-3 py-1.5">
                  <span class="text-xs text-success">{{ formatCurrency(Math.max(0, rec.total_cost - rec.recommendations[0].estimated_monthly_savings)) }}/mo</span>
                  <code class="text-[11px] font-medium text-success">{{ rec.recommendations[0].model }}</code>
                </div>
              </div>

              <!-- Stats row -->
              <div class="flex items-center gap-3 text-xs text-muted-foreground">
                <span class="inline-flex items-center gap-1 font-semibold text-success">
                  <TrendingDown class="h-3 w-3" />
                  Save {{ formatCurrency(rec.recommendations[0].estimated_monthly_savings) }}/mo
                </span>
                <span class="text-border">|</span>
                <span>{{ rec.recommendations[0].estimated_savings_pct }}% reduction</span>
                <span class="text-border">|</span>
                <span>{{ rec.event_count.toLocaleString() }} events</span>
                <template v-if="!rec.recommendations[0].same_provider">
                  <span class="text-border">|</span>
                  <span class="inline-flex items-center gap-1 text-warning">
                    <AlertTriangle class="h-3 w-3" />
                    provider migration
                  </span>
                </template>
              </div>

              <!-- Other candidates -->
              <details v-if="rec.recommendations.length > 1" class="group/alt">
                <summary class="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground select-none">
                  {{ rec.recommendations.length - 1 }} other option{{ rec.recommendations.length > 2 ? 's' : '' }}
                </summary>
                <div class="mt-2 space-y-1.5 pl-1">
                  <div v-for="alt in rec.recommendations.slice(1)" :key="alt.model"
                    class="flex items-center gap-2 text-xs text-muted-foreground">
                    <code class="bg-muted px-1.5 py-0.5 rounded text-[11px]">{{ alt.model }}</code>
                    <span>save {{ formatCurrency(alt.estimated_monthly_savings) }}/mo ({{ alt.estimated_savings_pct }}%)</span>
                    <span v-if="alt.same_provider" class="text-success font-medium">drop-in</span>
                    <span v-else class="text-warning font-medium">migration</span>
                  </div>
                </div>
              </details>
            </div>

            <Button variant="outline" size="sm" class="shrink-0 mt-1" @click="router.push(`/features/${rec.feature_key}`)">
              Review
            </Button>
          </div>
        </div>
      </div>

      <!-- Underwater Customers -->
      <div v-if="underwaterCustomers.length > 0" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <AlertTriangle class="h-3.5 w-3.5 text-destructive" />
            Underwater Customers
          </h2>
          <span class="text-xs font-medium text-destructive">{{ formatCurrency(totalLoss) }}/mo total loss</span>
        </div>

        <div v-for="cust in underwaterCustomers" :key="cust.customer_id"
          class="rounded-lg border border-destructive/30 bg-card p-4 transition-colors hover:border-destructive/50">
          <div class="flex items-center justify-between gap-4">
            <div class="space-y-1.5 min-w-0">
              <span class="text-sm font-semibold">{{ cust.customer_name }}</span>
              <div class="flex items-center gap-3 text-xs text-muted-foreground">
                <span>Cost: <span class="font-medium text-destructive">{{ formatCurrency(cust.total_ai_cost) }}</span></span>
                <span class="text-border">|</span>
                <span>Revenue: <span class="font-medium">{{ formatCurrency(cust.total_revenue) }}</span></span>
                <span class="text-border">|</span>
                <span>Loss: <span class="font-medium text-destructive">-{{ formatCurrency(cust.loss_amount) }}</span></span>
                <span class="text-border">|</span>
                <span>Margin: <span class="font-medium text-destructive">{{ cust.margin_pct }}%</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- No recommendations but has underwater -->
      <Card v-if="recommendations.length === 0 && underwaterCustomers.length > 0">
        <CardContent class="p-6 text-center">
          <PiggyBank class="h-8 w-8 text-success mx-auto mb-3" />
          <p class="text-sm font-medium">No model swap opportunities found</p>
          <p class="text-xs text-muted-foreground mt-1">Your model selection looks efficient. No cheaper alternatives would save more than 20%.</p>
        </CardContent>
      </Card>
    </template>

    <!-- No data at all -->
    <Card v-else>
      <CardContent class="p-8 text-center">
        <TrendingDown class="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h2 class="text-lg font-semibold">No recommendations yet</h2>
        <p class="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Recommendations appear once you have event data with model and cost information.
          Send events via the SDK or proxy mode to get started.
        </p>
        <div class="flex gap-3 justify-center mt-4">
          <Button :disabled="isLoadingDemo" @click="enterDemoMode">
            <FlaskConical class="h-4 w-4 mr-2" />
            {{ isLoadingDemo ? 'Loading...' : 'Try Demo' }}
          </Button>
          <Button variant="outline" @click="router.push('/data-sources')">
            Set up data sources
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

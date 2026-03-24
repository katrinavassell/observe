<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { listInsights, generateInsights, clearInsights, getUsageLimits } from '@/lib/api'
import type { AiInsight } from '@/lib/api'
import {
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Cpu,
  Users,
  Loader2,
  Trash2,
  RefreshCw,
  Lightbulb,
  DollarSign,
  ChevronRight,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const router = useRouter()
const queryClient = useQueryClient()

const { data: insights, isLoading } = useQuery({
  queryKey: ['insights'],
  queryFn: listInsights,
})

const generateMutation = useMutation({
  mutationFn: generateInsights,
  onSuccess: (data) => {
    queryClient.invalidateQueries({ queryKey: ['insights'] })
    const source = data.source === 'openai' ? 'OpenAI' : 'local analysis'
    toast.success(`Generated ${data.insights.length} insights via ${source}`)
  },
  onError: (error: Error) => {
    if (error.message?.includes('403')) {
      toast.error('Insight generation limit reached. Upgrade to generate more.')
      queryClient.invalidateQueries({ queryKey: ['usage-limits'] })
    } else {
      toast.error(error.message || 'Failed to generate insights')
    }
  },
})

const clearMutation = useMutation({
  mutationFn: clearInsights,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['insights'] })
    toast.success('Insights cleared')
  },
})

// Fetch usage limits
const { data: usageLimits } = useQuery({
  queryKey: ['usage-limits'],
  queryFn: getUsageLimits,
})

const insightsAllowed = computed(() => {
  if (!usageLimits.value?.configured) return true
  return usageLimits.value.ai_insights?.allowed !== false
})

const insightsUsage = computed(() => {
  if (!usageLimits.value?.configured) return null
  return usageLimits.value.ai_insights?.usage ?? null
})

function severityIcon(severity: string) {
  switch (severity) {
    case 'critical': return AlertTriangle
    case 'warning': return AlertTriangle
    case 'positive': return TrendingUp
    default: return Lightbulb
  }
}

function severityClass(severity: string) {
  switch (severity) {
    case 'critical': return 'border-l-4 border-l-destructive border border-border bg-card'
    case 'warning': return 'border-l-4 border-l-warning border border-border bg-card'
    case 'positive': return 'border-l-4 border-l-success border border-border bg-card'
    default: return 'border-l-4 border-l-primary border border-border bg-card'
  }
}

function severityIconClass(severity: string) {
  switch (severity) {
    case 'critical': return 'text-destructive'
    case 'warning': return 'text-warning'
    case 'positive': return 'text-success'
    default: return 'text-primary'
  }
}

function severityTextClass(_severity: string) {
  return 'text-foreground'
}

function typeIcon(type: string) {
  switch (type) {
    case 'margin_alert': return AlertTriangle
    case 'pricing_opportunity': return DollarSign
    case 'cost_optimization': return Cpu
    case 'customer_risk': return Users
    default: return Lightbulb
  }
}

function typeLabel(type: string) {
  switch (type) {
    case 'margin_alert': return 'Margin Alert'
    case 'pricing_opportunity': return 'Pricing Opportunity'
    case 'cost_optimization': return 'Cost Optimization'
    case 'customer_risk': return 'Customer Risk'
    default: return type
  }
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function navigateToContext(insight: AiInsight) {
  if (insight.feature_key) {
    router.push(`/features/${insight.feature_key}`)
  } else if (insight.customer_id) {
    router.push(`/customers/${insight.customer_id}`)
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Sparkles class="h-6 w-6 text-primary" />
          AI Insights
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
          AI-powered analysis of your margins, pricing, and customer health
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="insightsUsage" class="text-xs text-muted-foreground mr-1">
          {{ insightsUsage.used }} of {{ insightsUsage.limit }} insights used
        </span>
        <button
          v-if="insights && insights.length > 0"
          class="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          :disabled="clearMutation.isPending.value"
          @click="clearMutation.mutate()"
        >
          <Trash2 class="h-3.5 w-3.5" />
          Clear
        </button>
        <button
          class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          :disabled="generateMutation.isPending.value || !insightsAllowed"
          @click="generateMutation.mutate()"
        >
          <Loader2 v-if="generateMutation.isPending.value" class="h-4 w-4 animate-spin" />
          <Sparkles v-else class="h-4 w-4" />
          {{ !insightsAllowed ? 'Limit Reached' : generateMutation.isPending.value ? 'Analyzing...' : 'Generate Insights' }}
        </button>
      </div>
    </div>

    <!-- Usage limit banner -->
    <div
      v-if="!insightsAllowed"
      class="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-foreground"
    >
      You've used all {{ insightsUsage?.limit ?? '' }} insight generations. Upgrade to generate more.
    </div>

    <!-- Cost transparency -->
    <div
      v-if="generateMutation.data?.value"
      class="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <span>
        Last run: {{ generateMutation.data.value.source === 'openai' ? 'OpenAI gpt-4o-mini' : 'Local analysis' }}
      </span>
      <span v-if="generateMutation.data.value?.tokens_used && generateMutation.data.value.tokens_used > 0">
        · {{ generateMutation.data.value.tokens_used.toLocaleString() }} tokens
        · ${{ generateMutation.data.value.cost_usd?.toFixed(4) ?? '0.0000' }}
      </span>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="p-8 text-center text-muted-foreground text-sm">Loading insights...</div>

    <!-- Empty state -->
    <div
      v-else-if="!insights || insights.length === 0"
      class="rounded-lg border bg-card p-12 text-center"
    >
      <div class="flex items-center justify-center w-14 h-14 rounded-full bg-purple-100 mx-auto mb-4">
        <Sparkles class="h-7 w-7 text-purple-500" />
      </div>
      <h2 class="text-lg font-semibold mb-2">No insights yet</h2>
      <p class="text-sm text-muted-foreground max-w-md mx-auto mb-4">
        Click "Generate Insights" to analyze your data. If an OpenAI API key is configured,
        insights are powered by gpt-4o-mini. Otherwise, a local analysis engine is used.
      </p>
      <button
        class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        :disabled="generateMutation.isPending.value || !insightsAllowed"
        @click="generateMutation.mutate()"
      >
        <Loader2 v-if="generateMutation.isPending.value" class="h-4 w-4 animate-spin" />
        <Sparkles v-else class="h-4 w-4" />
        {{ !insightsAllowed ? 'Limit Reached' : generateMutation.isPending.value ? 'Analyzing...' : 'Generate Insights' }}
      </button>
    </div>

    <!-- Insights list -->
    <div v-else class="space-y-4">
      <div
        v-for="insight in insights"
        :key="insight.id"
        :class="[
          'rounded-lg border p-5 transition-shadow',
          severityClass(insight.severity),
          (insight.feature_key || insight.customer_id) ? 'cursor-pointer hover:shadow-sm' : ''
        ]"
        @click="navigateToContext(insight)"
      >
        <div class="flex items-start gap-3">
          <component
            :is="severityIcon(insight.severity)"
            :class="['h-5 w-5 shrink-0 mt-0.5', severityIconClass(insight.severity)]"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2 mb-1">
              <h3 :class="['text-sm font-semibold', severityTextClass(insight.severity)]">
                {{ insight.title }}
              </h3>
              <div class="flex items-center gap-2 shrink-0">
                <span class="inline-flex items-center gap-1 rounded-full bg-white/60 border border-black/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <component :is="typeIcon(insight.insight_type)" class="h-3 w-3" />
                  {{ typeLabel(insight.insight_type) }}
                </span>
              </div>
            </div>

            <p :class="['text-sm leading-relaxed', severityTextClass(insight.severity)]" style="opacity: 0.85">
              {{ insight.description }}
            </p>

            <div class="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span v-if="insight.feature_key" class="font-mono bg-white/40 px-1.5 py-0.5 rounded">
                {{ insight.feature_key }}
              </span>
              <span v-if="insight.customer_id" class="font-mono bg-white/40 px-1.5 py-0.5 rounded">
                {{ insight.customer_id }}
              </span>
              <span>{{ formatDate(insight.created_at) }}</span>
              <ChevronRight
                v-if="insight.feature_key || insight.customer_id"
                class="h-3 w-3 ml-auto"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

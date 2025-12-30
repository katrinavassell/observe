<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import {
  Database,
  Upload,
  BarChart3,
  ArrowRight,
  ArrowLeft,
  Link2,
  DollarSign,
  FileSpreadsheet,
  Building2,
  Bot,
  Zap,
  TrendingUp,
  Users,
  Wallet
} from 'lucide-vue-next'
import { Card, CardContent, CardTitle, Button } from '@/components/ui'
import { loadSampleData } from '@/api/client'
import { useAppMode, type AppMode } from '@/composables/useAppMode'

const router = useRouter()
const queryClient = useQueryClient()
const { mode, setMode, labels } = useAppMode()

// Step 1: Mode selection, Step 2: Data source selection
const step = ref<1 | 2>(1)

function selectMode(selectedMode: AppMode) {
  setMode(selectedMode)
  step.value = 2
}

function goBack() {
  step.value = 1
}

const loadSampleMutation = useMutation({
  mutationFn: loadSampleData,
  onSuccess: (data) => {
    queryClient.invalidateQueries({ queryKey: ['data-status'] })
    queryClient.invalidateQueries({ queryKey: ['revenue-analytics'] })
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
    toast.success('Sample data loaded!', {
      description: `${data.account_count} ${labels.value.accounts.toLowerCase()}, ${data.subscription_count} ${labels.value.subscriptions.toLowerCase()}`,
    })
    router.push('/')
  },
  onError: (error) => {
    toast.error('Couldn\'t load sample data', {
      description: error instanceof Error ? error.message : 'Please check your connection and try again.',
    })
  },
})

// Mode-specific features
const saasFeatures = [
  { icon: BarChart3, title: 'Revenue Metrics', desc: 'ARR, MRR, and segment analysis' },
  { icon: Link2, title: 'Account Matching', desc: 'Cross-system deduplication' },
  { icon: DollarSign, title: 'Pricing Insights', desc: 'SHAP-style price explanations' },
]

const agentFeatures = [
  { icon: Zap, title: 'Transaction Volume', desc: 'Real-time API call tracking' },
  { icon: Link2, title: 'Agent Reconciliation', desc: 'Match agent IDs across systems' },
  { icon: TrendingUp, title: 'Cost Analysis', desc: 'API costs and margin tracking' },
]

const features = computed(() => mode.value === 'agent' ? agentFeatures : saasFeatures)

// Mode-specific data types
const saasDataTypes = [
  { name: 'Accounts', desc: 'Customer accounts with ARR' },
  { name: 'Subscriptions', desc: 'Plan and billing details' },
  { name: 'Invoices', desc: 'Payment history' },
  { name: 'Usage', desc: 'API calls, storage, seats' },
  { name: 'Users', desc: 'Team members per account' },
]

const agentDataTypes = [
  { name: 'Agents', desc: 'Agent registry and identifiers' },
  { name: 'API Calls', desc: 'OpenAI, Anthropic usage logs' },
  { name: 'Settlements', desc: 'Payment transactions' },
  { name: 'Costs', desc: 'Token usage and pricing' },
]

const dataTypes = computed(() => mode.value === 'agent' ? agentDataTypes : saasDataTypes)

// Mode-specific sample data description
const sampleDataDesc = computed(() => {
  if (mode.value === 'agent') {
    return {
      title: 'Explore with Demo Agents',
      subtitle: 'See agent analytics in action with sample data.',
      bullets: [
        '5 demo agents with transaction history',
        'API usage across OpenAI & Anthropic',
        'Cost tracking and settlement data',
      ],
    }
  }
  return {
    title: 'Explore with Sample Data',
    subtitle: 'See Tanso in action with 5 realistic demo accounts.',
    bullets: [
      '$390K total ARR across segments',
      'Enterprise, Mid-Market & SMB accounts',
      'Subscriptions, invoices & usage data',
    ],
  }
})
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-8">
    <div class="max-w-4xl w-full space-y-8">

      <!-- ==================== STEP 1: MODE SELECTION ==================== -->
      <template v-if="step === 1">
        <!-- Hero -->
        <div class="text-center space-y-4">
          <div class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
            <FileSpreadsheet class="h-4 w-4" />
            Revenue Intelligence Platform
          </div>
          <h1 class="text-4xl font-bold tracking-tight">Welcome to Tanso</h1>
          <p class="text-xl text-muted-foreground max-w-2xl mx-auto">
            What are you tracking?
          </p>
        </div>

        <!-- Mode Selection Cards -->
        <div class="grid md:grid-cols-2 gap-6">
          <!-- SaaS Revenue -->
          <Card
            class="hover:border-primary/50 transition-all cursor-pointer group relative overflow-hidden"
            @click="selectMode('saas')"
          >
            <CardContent class="p-8 text-center space-y-4">
              <div class="mx-auto w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Building2 class="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle class="text-xl">SaaS Revenue</CardTitle>
              <p class="text-muted-foreground text-sm">
                Human customers with subscriptions
              </p>
              <ul class="text-xs text-muted-foreground space-y-1.5 text-left max-w-[200px] mx-auto">
                <li class="flex items-center gap-2">
                  <BarChart3 class="h-3 w-3 shrink-0" />
                  ARR / MRR tracking
                </li>
                <li class="flex items-center gap-2">
                  <Users class="h-3 w-3 shrink-0" />
                  Customer segments
                </li>
                <li class="flex items-center gap-2">
                  <TrendingUp class="h-3 w-3 shrink-0" />
                  Churn analysis
                </li>
              </ul>
              <Button variant="outline" class="w-full">
                Select
                <ArrowRight class="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

          <!-- Agent Commerce -->
          <Card
            class="hover:border-primary/50 transition-all cursor-pointer group relative overflow-hidden"
            @click="selectMode('agent')"
          >
            <CardContent class="p-8 text-center space-y-4">
              <div class="mx-auto w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Bot class="w-8 h-8 text-purple-600 dark:text-purple-400" />
              </div>
              <CardTitle class="text-xl">Agent Commerce</CardTitle>
              <p class="text-muted-foreground text-sm">
                AI agents buying & selling services
              </p>
              <ul class="text-xs text-muted-foreground space-y-1.5 text-left max-w-[200px] mx-auto">
                <li class="flex items-center gap-2">
                  <Zap class="h-3 w-3 shrink-0" />
                  Transaction volume
                </li>
                <li class="flex items-center gap-2">
                  <Wallet class="h-3 w-3 shrink-0" />
                  API costs & margins
                </li>
                <li class="flex items-center gap-2">
                  <TrendingUp class="h-3 w-3 shrink-0" />
                  Agent activity
                </li>
              </ul>
              <Button variant="outline" class="w-full">
                Select
                <ArrowRight class="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>

        <!-- Footer note -->
        <p class="text-center text-xs text-muted-foreground">
          You can change this later in settings.
        </p>
      </template>

      <!-- ==================== STEP 2: DATA SOURCE SELECTION ==================== -->
      <template v-else>
        <!-- Back button + Hero -->
        <div class="text-center space-y-4">
          <button
            class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            @click="goBack"
          >
            <ArrowLeft class="h-4 w-4" />
            Change mode
          </button>
          <div class="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium"
            :class="mode === 'agent' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'"
          >
            <component :is="mode === 'agent' ? Bot : Building2" class="h-4 w-4" />
            {{ mode === 'agent' ? 'Agent Commerce' : 'SaaS Revenue' }}
          </div>
          <h1 class="text-4xl font-bold tracking-tight">Get Started</h1>
          <p class="text-xl text-muted-foreground max-w-2xl mx-auto">
            {{ mode === 'agent' ? 'Import your agent data or explore with demo data.' : 'Import your revenue data or explore with demo data.' }}
          </p>
        </div>

        <!-- CTA Cards -->
        <div class="grid md:grid-cols-2 gap-6">
          <!-- Sample Data Card -->
          <Card
            class="hover:border-primary/50 transition-colors cursor-pointer group"
            @click="loadSampleMutation.mutate()"
          >
            <CardContent class="p-8 text-center space-y-4">
              <div class="mx-auto w-16 h-16 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform"
                :class="mode === 'agent' ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-blue-100 dark:bg-blue-900/30'"
              >
                <Database class="w-8 h-8" :class="mode === 'agent' ? 'text-purple-600 dark:text-purple-400' : 'text-blue-600 dark:text-blue-400'" />
              </div>
              <CardTitle class="text-xl">{{ sampleDataDesc.title }}</CardTitle>
              <p class="text-muted-foreground text-sm">
                {{ sampleDataDesc.subtitle }}
                No setup required.
              </p>
              <ul class="text-xs text-muted-foreground space-y-1">
                <li v-for="bullet in sampleDataDesc.bullets" :key="bullet">{{ bullet }}</li>
              </ul>
              <Button
                :loading="loadSampleMutation.isPending.value"
                class="w-full"
              >
                Load Sample Data
                <ArrowRight class="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

          <!-- Upload Card -->
          <Card
            class="hover:border-primary/50 transition-colors cursor-pointer group"
            @click="router.push('/onboarding/upload')"
          >
            <CardContent class="p-8 text-center space-y-4">
              <div class="mx-auto w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Upload class="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle class="text-xl">Upload Your Data</CardTitle>
              <p class="text-muted-foreground text-sm">
                Import your {{ mode === 'agent' ? 'agents and transactions' : 'accounts and subscriptions' }}
                from CSV files.
              </p>
              <div class="flex flex-wrap justify-center gap-2">
                <span
                  v-for="type in dataTypes"
                  :key="type.name"
                  class="text-xs bg-muted px-2 py-1 rounded"
                  :title="type.desc"
                >
                  {{ type.name }}
                </span>
              </div>
              <Button variant="outline" class="w-full">
                Start Upload
                <ArrowRight class="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>

        <!-- Feature highlights -->
        <div class="grid md:grid-cols-3 gap-4 pt-8 border-t">
          <div
            v-for="feature in features"
            :key="feature.title"
            class="flex items-start gap-3 p-4 rounded-lg hover:bg-muted/50 transition-colors"
          >
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <component :is="feature.icon" class="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 class="font-medium text-sm">{{ feature.title }}</h3>
              <p class="text-xs text-muted-foreground">{{ feature.desc }}</p>
            </div>
          </div>
        </div>

        <!-- Footer note -->
        <p class="text-center text-xs text-muted-foreground">
          Your data stays on your machine. No external API calls.
        </p>
      </template>

    </div>
  </div>
</template>

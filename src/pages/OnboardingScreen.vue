<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import {
  Database,
  Upload,
  BarChart3,
  ArrowRight,
  Link2,
  DollarSign,
  FileSpreadsheet,
} from 'lucide-vue-next'
import { Card, CardContent, CardTitle, Button } from '@/components/ui'
import { loadSampleData } from '@/api/client'
import { useAppMode } from '@/composables/useAppMode'

const router = useRouter()
const queryClient = useQueryClient()
const { labels } = useAppMode()

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

// Features
const features = [
  { icon: BarChart3, title: 'Revenue Metrics', desc: 'ARR, MRR, and segment analysis' },
  { icon: Link2, title: 'Account Matching', desc: 'Cross-system deduplication' },
  { icon: DollarSign, title: 'Pricing Insights', desc: 'SHAP-style price explanations' },
]

// Data types
const dataTypes = [
  { name: 'Accounts', desc: 'Customer accounts with ARR' },
  { name: 'Subscriptions', desc: 'Plan and billing details' },
  { name: 'Invoices', desc: 'Payment history' },
  { name: 'Usage', desc: 'API calls, storage, seats' },
  { name: 'Users', desc: 'Team members per account' },
]

// Sample data description
const sampleDataDesc = {
  title: 'Explore with Sample Data',
  subtitle: 'See Tanso in action with 5 realistic demo accounts.',
  bullets: [
    '$390K total ARR across segments',
    'Enterprise, Mid-Market & SMB accounts',
    'Subscriptions, invoices & usage data',
  ],
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-8">
    <div class="max-w-4xl w-full space-y-8">

      <!-- Hero -->
      <div class="text-center space-y-4">
        <div class="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
          <FileSpreadsheet class="h-4 w-4" />
          Revenue Intelligence Platform
        </div>
        <h1 class="text-4xl font-bold tracking-tight">Welcome to Tanso</h1>
        <p class="text-xl text-muted-foreground max-w-2xl mx-auto">
          Import your revenue data or explore with demo data.
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
            <div class="mx-auto w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Database class="w-8 h-8 text-blue-600 dark:text-blue-400" />
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
              Import your accounts and subscriptions from CSV files.
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

    </div>
  </div>
</template>

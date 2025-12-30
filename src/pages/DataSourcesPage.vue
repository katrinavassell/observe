<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import {
  Upload,
  CreditCard,
  FileSpreadsheet,
  Plus,
  MessageSquarePlus,
  X,
  Download,
  FileText,
} from 'lucide-vue-next'
import { Card, CardContent, Button, Input, Badge } from '@/components/ui'
import Skeleton from '@/components/ui/skeleton.vue'
import IntegrationCard from '@/components/integrations/IntegrationCard.vue'
import type { Integration } from '@/components/integrations/IntegrationCard.vue'
import {
  getIntegrations,
  getStripeAuthUrl,
  syncStripeData,
  disconnectIntegration,
  requestIntegration,
  downloadTemplate,
} from '@/api/client'

// Template definitions
const templates = [
  {
    id: 'accounts',
    name: 'Accounts',
    description: 'Customer accounts with company info and ARR',
    columns: 8,
    required: ['account_id', 'company_name'],
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    description: 'Plan and billing information',
    columns: 7,
    required: ['subscription_id', 'customer_id'],
  },
  {
    id: 'invoices',
    name: 'Invoices',
    description: 'Payment history and details',
    columns: 7,
    required: ['invoice_id', 'customer_id', 'amount'],
  },
  {
    id: 'usage',
    name: 'Usage',
    description: 'API calls, storage, seats metrics',
    columns: 5,
    required: ['customer_id', 'metric_key', 'metric_value'],
  },
]

async function handleDownloadTemplate(templateId: string) {
  try {
    const blob = await downloadTemplate(templateId)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${templateId}_template.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Template downloaded', {
      description: `${templateId}_template.csv`,
    })
  } catch (error) {
    toast.error('Failed to download template')
  }
}

const router = useRouter()
const route = useRoute()
const queryClient = useQueryClient()

// Show toast if redirected from OAuth
onMounted(() => {
  const connected = route.query.connected as string | undefined
  if (connected) {
    toast.success(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected!`, {
      description: 'Click "Sync" to import your data.',
    })
    // Clean up URL
    router.replace({ query: {} })
  }
})

// Fetch integrations
const { data: integrationsData, isLoading } = useQuery({
  queryKey: ['integrations'],
  queryFn: getIntegrations,
})

const integrations = computed(() => integrationsData.value?.integrations ?? [])

// Group integrations by category
const billingIntegrations = computed(() =>
  integrations.value.filter((i: Integration) => i.category === 'billing')
)

// Connect to Stripe
const connectingProvider = ref<string | null>(null)
const syncingProvider = ref<string | null>(null)

async function handleConnect(provider: string) {
  if (provider === 'stripe') {
    connectingProvider.value = 'stripe'
    try {
      const { url } = await getStripeAuthUrl()
      window.location.href = url
    } catch (error) {
      console.error('Failed to get auth URL:', error)
      connectingProvider.value = null
    }
  }
}

const syncMutation = useMutation({
  mutationFn: syncStripeData,
  onSuccess: (data) => {
    queryClient.invalidateQueries({ queryKey: ['integrations'] })
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
    queryClient.invalidateQueries({ queryKey: ['revenue-analytics'] })
    syncingProvider.value = null
    toast.success('Sync complete!', {
      id: 'stripe-sync',
      description: `Imported ${data.total_customers} customers, ${data.total_subscriptions} subscriptions, ${data.total_invoices} invoices.`,
    })
  },
  onError: (error) => {
    syncingProvider.value = null
    toast.error('Sync failed', {
      id: 'stripe-sync',
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  },
})

function handleSync(provider: string) {
  if (provider === 'stripe') {
    syncingProvider.value = 'stripe'
    toast.loading('Syncing Stripe data...', { id: 'stripe-sync' })
    syncMutation.mutate()
  }
}

const disconnectMutation = useMutation({
  mutationFn: disconnectIntegration,
  onSuccess: (_, provider) => {
    queryClient.invalidateQueries({ queryKey: ['integrations'] })
    toast.success(`${provider.charAt(0).toUpperCase() + provider.slice(1)} disconnected`)
  },
  onError: (error) => {
    toast.error('Failed to disconnect', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  },
})

function handleDisconnect(provider: string) {
  if (confirm(`Are you sure you want to disconnect ${provider}?`)) {
    disconnectMutation.mutate(provider)
  }
}

function goToUpload() {
  router.push('/onboarding/upload')
}

// Request Integration Modal
const showRequestModal = ref(false)
const requestEmail = ref('')
const requestProvider = ref('')

const requestMutation = useMutation({
  mutationFn: requestIntegration,
  onSuccess: () => {
    toast.success('Request submitted!', {
      description: `We'll notify you when ${requestProvider.value} is available.`,
    })
    showRequestModal.value = false
    requestEmail.value = ''
    requestProvider.value = ''
  },
  onError: (error) => {
    toast.error('Failed to submit request', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  },
})

function submitRequest() {
  if (!requestEmail.value || !requestProvider.value) return
  requestMutation.mutate({
    email: requestEmail.value,
    provider_name: requestProvider.value,
  })
}
</script>

<template>
  <div class="space-y-8">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Data Sources</h1>
        <p class="text-muted-foreground">
          Connect your tools to import revenue and customer data
        </p>
      </div>
      <Button @click="goToUpload">
        <Plus class="mr-2 h-4 w-4" />
        Upload CSV
      </Button>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="space-y-6">
      <div v-for="i in 3" :key="i" class="space-y-4">
        <Skeleton class="h-6 w-32" />
        <div class="grid gap-4 md:grid-cols-2">
          <Skeleton class="h-32" />
          <Skeleton class="h-32" />
        </div>
      </div>
    </div>

    <template v-else>
      <!-- Files Section -->
      <section>
        <div class="flex items-center gap-2 mb-4">
          <FileSpreadsheet class="h-5 w-5 text-muted-foreground" />
          <h2 class="text-lg font-semibold">Files</h2>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <!-- CSV Upload Card (special) -->
          <Card
            class="cursor-pointer transition-all hover:border-primary/50"
            @click="goToUpload"
          >
            <CardContent class="p-5">
              <div class="flex items-start gap-4">
                <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <Upload class="h-6 w-6 text-primary" />
                </div>
                <div class="flex-1">
                  <h3 class="font-semibold">CSV Upload</h3>
                  <p class="text-sm text-muted-foreground mt-0.5">
                    Import accounts, subscriptions, invoices, and usage data from CSV files
                  </p>
                  <div class="flex flex-wrap gap-1.5 mt-3">
                    <span class="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] capitalize">
                      accounts
                    </span>
                    <span class="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] capitalize">
                      subscriptions
                    </span>
                    <span class="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] capitalize">
                      invoices
                    </span>
                    <span class="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] capitalize">
                      usage
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </section>

      <!-- CSV Templates Section -->
      <section>
        <div class="flex items-center gap-2 mb-4">
          <FileText class="h-5 w-5 text-muted-foreground" />
          <h2 class="text-lg font-semibold">CSV Templates</h2>
        </div>

        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card
            v-for="template in templates"
            :key="template.id"
            class="transition-all hover:border-primary/50"
          >
            <CardContent class="p-4">
              <div class="flex items-start justify-between mb-2">
                <div>
                  <h3 class="font-medium">{{ template.name }}</h3>
                  <p class="text-xs text-muted-foreground">{{ template.columns }} columns</p>
                </div>
                <Badge variant="outline" class="text-[10px]">CSV</Badge>
              </div>
              <p class="text-xs text-muted-foreground mb-3">{{ template.description }}</p>
              <div class="text-xs text-muted-foreground mb-3">
                <span class="font-medium">Required: </span>
                <span class="font-mono">{{ template.required.join(', ') }}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                class="w-full"
                @click="handleDownloadTemplate(template.id)"
              >
                <Download class="h-3 w-3 mr-1.5" />
                Download
              </Button>
            </CardContent>
          </Card>
        </div>

        <p class="text-xs text-muted-foreground mt-3">
          Templates include example data rows and all available columns.
        </p>
      </section>

      <!-- Billing Section -->
      <section v-if="billingIntegrations.length > 0">
        <div class="flex items-center gap-2 mb-4">
          <CreditCard class="h-5 w-5 text-muted-foreground" />
          <h2 class="text-lg font-semibold">Billing</h2>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <IntegrationCard
            v-for="integration in billingIntegrations"
            :key="integration.provider"
            :integration="integration"
            :connecting="connectingProvider === integration.provider"
            :syncing="syncingProvider === integration.provider"
            @connect="handleConnect(integration.provider)"
            @sync="handleSync(integration.provider)"
            @disconnect="handleDisconnect(integration.provider)"
          />
        </div>
      </section>

      <!-- Request Integration Section -->
      <section>
        <div class="flex items-center gap-2 mb-4">
          <MessageSquarePlus class="h-5 w-5 text-muted-foreground" />
          <h2 class="text-lg font-semibold">Need a different integration?</h2>
        </div>

        <Card
          class="cursor-pointer transition-all hover:border-primary/50 max-w-md"
          @click="showRequestModal = true"
        >
          <CardContent class="p-5">
            <div class="flex items-start gap-4">
              <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                <Plus class="h-6 w-6 text-muted-foreground" />
              </div>
              <div class="flex-1">
                <h3 class="font-semibold">Request an Integration</h3>
                <p class="text-sm text-muted-foreground mt-0.5">
                  Tell us what tools you use and we'll prioritize building integrations for them.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </template>

    <!-- Request Integration Modal -->
    <Teleport to="body">
      <div
        v-if="showRequestModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
        @click.self="showRequestModal = false"
      >
        <div class="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold">Request an Integration</h2>
            <Button variant="ghost" size="sm" @click="showRequestModal = false">
              <X class="h-4 w-4" />
            </Button>
          </div>

          <div class="space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">Your email</label>
              <Input
                v-model="requestEmail"
                type="email"
                placeholder="you@company.com"
              />
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium">Integration name</label>
              <Input
                v-model="requestProvider"
                placeholder="e.g. Salesforce, HubSpot, QuickBooks"
              />
            </div>

            <p class="text-xs text-muted-foreground">
              We'll notify you when this integration becomes available.
            </p>

            <div class="flex gap-2 pt-2">
              <Button
                class="flex-1"
                :disabled="!requestEmail || !requestProvider"
                :loading="requestMutation.isPending.value"
                @click="submitRequest"
              >
                Submit Request
              </Button>
              <Button variant="outline" @click="showRequestModal = false">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

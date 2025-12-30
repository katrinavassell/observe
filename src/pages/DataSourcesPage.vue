<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import {
  DollarSign,
  Cpu,
  Clock,
  Building2,
  Wallet,
  ArrowRight,
  Bell,
  TrendingUp,
} from 'lucide-vue-next'
import { Card, CardContent, Button } from '@/components/ui'
import Skeleton from '@/components/ui/skeleton.vue'
import IntegrationCard from '@/components/integrations/IntegrationCard.vue'
import InterestCaptureModal from '@/components/integrations/InterestCaptureModal.vue'
import IntegrationRequestModal from '@/components/integrations/IntegrationRequestModal.vue'
import StripeApiKeyModal from '@/components/integrations/StripeApiKeyModal.vue'
import type { Integration } from '@/components/integrations/IntegrationCard.vue'
import type { ComingSoonIntegration } from '@/api/client'
import {
  getIntegrations,
  getComingSoonIntegrations,
  syncStripeData,
  disconnectIntegration,
} from '@/api/client'

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
    router.replace({ query: {} })
  }
})

// Fetch integrations
const { data: integrationsData, isLoading } = useQuery({
  queryKey: ['integrations'],
  queryFn: getIntegrations,
})

// Fetch coming soon integrations
const { data: comingSoonData } = useQuery({
  queryKey: ['coming-soon-integrations'],
  queryFn: getComingSoonIntegrations,
})

const integrations = computed(() => integrationsData.value?.integrations ?? [])
const comingSoonIntegrations = computed(() => comingSoonData.value?.integrations ?? [])

// Group integrations by category
const revenueIntegrations = computed(() =>
  integrations.value.filter((i: Integration) => i.category === 'revenue')
)

const aiCostsIntegrations = computed(() =>
  integrations.value.filter((i: Integration) => i.category === 'ai_costs')
)

const comingSoonCRM = computed(() =>
  comingSoonIntegrations.value.filter((i: ComingSoonIntegration) => i.category === 'crm')
)

const comingSoonFinance = computed(() =>
  comingSoonIntegrations.value.filter((i: ComingSoonIntegration) => i.category === 'finance')
)

// Connect to Stripe
const connectingProvider = ref<string | null>(null)
const syncingProvider = ref<string | null>(null)
const showStripeModal = ref(false)

function handleConnect(provider: string) {
  if (provider === 'stripe') {
    showStripeModal.value = true
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

// Sample data handling
const isLoadingSample = ref(false)

function handleTrySampleData() {
  isLoadingSample.value = true
  // Navigate to pricing page with loadSample flag
  router.push('/pricing?loadSample=true')
}

// Interest Capture Modal (for "Notify me" flows)
const showInterestModal = ref(false)
const selectedComingSoonIntegration = ref<ComingSoonIntegration | null>(null)

function handleNotifyMe(integration: ComingSoonIntegration) {
  selectedComingSoonIntegration.value = integration
  showInterestModal.value = true
}

// Integration Request Modal
const showRequestModal = ref(false)

// Provider icon mapping
const providerIcons: Record<string, string> = {
  stripe: '/icons/stripe.svg',
  openai: '/icons/openai.svg',
  anthropic: '/icons/anthropic.svg',
  salesforce: '/icons/salesforce.svg',
  hubspot: '/icons/hubspot.svg',
  quickbooks: '/icons/quickbooks.svg',
  brex: '/icons/brex.svg',
}
</script>

<template>
  <div class="space-y-8">
    <!-- Header -->
    <div>
      <h1 class="text-3xl font-bold tracking-tight">Connect your data</h1>
      <p class="text-muted-foreground">
        Import revenue and cost data to see your unit economics
      </p>
    </div>

    <!-- Sample Data Hero -->
    <Card class="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
      <CardContent class="p-6">
        <div class="flex items-start justify-between gap-6">
          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <TrendingUp class="h-5 w-5 text-primary" />
              <h2 class="font-semibold">See it in action first</h2>
            </div>
            <p class="text-sm text-muted-foreground max-w-md">
              Load 6 months of realistic SaaS data to explore the Pricing Analyzer:
            </p>
            <ul class="text-sm text-muted-foreground space-y-1">
              <li>30 customers across 4 pricing tiers</li>
              <li>Revenue, costs, and usage data</li>
              <li>Real margin compression and churn risk scenarios</li>
            </ul>
          </div>
          <Button @click="handleTrySampleData" :disabled="isLoadingSample">
            <TrendingUp class="h-4 w-4 mr-2" />
            {{ isLoadingSample ? 'Loading...' : 'Try Sample Data' }}
          </Button>
        </div>
      </CardContent>
    </Card>

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
      <!-- REVENUE Section -->
      <section>
        <div class="flex items-center gap-2 mb-4">
          <DollarSign class="h-5 w-5 text-muted-foreground" />
          <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Revenue</h2>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <IntegrationCard
            v-for="integration in revenueIntegrations"
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

      <!-- AI COSTS Section -->
      <section>
        <div class="flex items-center gap-2 mb-4">
          <Cpu class="h-5 w-5 text-muted-foreground" />
          <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">AI Costs</h2>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <IntegrationCard
            v-for="integration in aiCostsIntegrations"
            :key="integration.provider"
            :integration="integration"
            :connecting="connectingProvider === integration.provider"
            :syncing="syncingProvider === integration.provider"
            @connect="handleConnect(integration.provider)"
            @sync="handleSync(integration.provider)"
            @disconnect="handleDisconnect(integration.provider)"
          />
        </div>

        <!-- CSV Upload Option -->
        <div class="mt-4">
          <p class="text-sm text-muted-foreground">
            Using a different provider?
            <button
              class="text-primary hover:underline font-medium ml-1"
              @click="goToUpload"
            >
              Upload CSV
            </button>
          </p>
        </div>
      </section>

      <!-- Divider -->
      <div class="border-t" />

      <!-- COMING SOON Section -->
      <section>
        <div class="flex items-center gap-2 mb-6">
          <Clock class="h-5 w-5 text-muted-foreground" />
          <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Coming Soon</h2>
        </div>

        <!-- CRM & Sales -->
        <div v-if="comingSoonCRM.length > 0" class="mb-6">
          <div class="flex items-center gap-2 mb-3">
            <Building2 class="h-4 w-4 text-muted-foreground" />
            <h3 class="text-sm font-medium text-muted-foreground">CRM & Sales</h3>
          </div>

          <div class="space-y-2">
            <Card
              v-for="integration in comingSoonCRM"
              :key="integration.provider"
              class="transition-all hover:border-primary/30"
            >
              <CardContent class="p-4">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <img
                        v-if="providerIcons[integration.provider]"
                        :src="providerIcons[integration.provider]"
                        :alt="integration.name"
                        class="h-6 w-6"
                        @error="($event.target as HTMLImageElement).style.display = 'none'"
                      />
                      <span v-else class="text-sm font-bold text-muted-foreground">
                        {{ integration.name.charAt(0) }}
                      </span>
                    </div>
                    <div>
                      <h4 class="font-medium">{{ integration.name }}</h4>
                      <p class="text-xs text-muted-foreground">{{ integration.description }}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    @click="handleNotifyMe(integration)"
                  >
                    <Bell class="h-3.5 w-3.5 mr-1.5" />
                    Notify me
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <!-- Finance & Expenses -->
        <div v-if="comingSoonFinance.length > 0">
          <div class="flex items-center gap-2 mb-3">
            <Wallet class="h-4 w-4 text-muted-foreground" />
            <h3 class="text-sm font-medium text-muted-foreground">Finance & Expenses</h3>
          </div>

          <div class="space-y-2">
            <Card
              v-for="integration in comingSoonFinance"
              :key="integration.provider"
              class="transition-all hover:border-primary/30"
            >
              <CardContent class="p-4">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <img
                        v-if="providerIcons[integration.provider]"
                        :src="providerIcons[integration.provider]"
                        :alt="integration.name"
                        class="h-6 w-6"
                        @error="($event.target as HTMLImageElement).style.display = 'none'"
                      />
                      <span v-else class="text-sm font-bold text-muted-foreground">
                        {{ integration.name.charAt(0) }}
                      </span>
                    </div>
                    <div>
                      <h4 class="font-medium">{{ integration.name }}</h4>
                      <p class="text-xs text-muted-foreground">{{ integration.description }}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    @click="handleNotifyMe(integration)"
                  >
                    <Bell class="h-3.5 w-3.5 mr-1.5" />
                    Notify me
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <!-- Request Integration Link -->
        <div class="mt-6 pt-4 border-t">
          <button
            class="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 group"
            @click="showRequestModal = true"
          >
            Don't see what you need?
            <span class="text-primary font-medium group-hover:underline flex items-center gap-1">
              Request an integration
              <ArrowRight class="h-3.5 w-3.5" />
            </span>
          </button>
        </div>
      </section>
    </template>

    <!-- Interest Capture Modal -->
    <InterestCaptureModal
      :open="showInterestModal"
      :integration="selectedComingSoonIntegration"
      @close="showInterestModal = false"
    />

    <!-- Integration Request Modal -->
    <IntegrationRequestModal
      :open="showRequestModal"
      @close="showRequestModal = false"
    />

    <!-- Stripe API Key Modal -->
    <StripeApiKeyModal
      :open="showStripeModal"
      @close="showStripeModal = false"
      @connected="() => {}"
    />
  </div>
</template>

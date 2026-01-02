<script setup lang="ts">
/**
 * CustomerInsightsPage - Granular customer-level profitability analysis
 *
 * Layout:
 * - Header with navigation, title, actions
 * - Summary metrics row
 * - Two-column layout: filters/table (left), stats/actions (right)
 * - Slide-out detail panel
 */

import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import {
  Search,
  Users,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Download,
  RefreshCw,
  BarChart3,
  Mail,
  Package,
  ArrowLeft,
} from 'lucide-vue-next'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Input,
} from '@/components/ui'
import {
  CustomerListTable,
  CustomerDetailPanel,
  CustomerProfitabilityChart,
  PlanComparisonView,
} from '@/components/customer-insights'
import { getCustomerInsights, type CustomerInsight } from '@/api/client'
import { formatCurrency, formatPercent } from '@/lib/utils'

// =============================================================================
// ROUTING & STATE
// =============================================================================

const router = useRouter()

const selectedCustomer = ref<CustomerInsight | null>(null)
const showDetailPanel = ref(false)
const searchQuery = ref('')
const filters = ref({
  plan: 'all',
  status: 'all',
  profitability: 'all',
  risk: 'all',
})

// =============================================================================
// DATA FETCHING
// =============================================================================

const { data: customers, isLoading, refetch } = useQuery({
  queryKey: ['customer-insights'],
  queryFn: getCustomerInsights,
})

// =============================================================================
// COMPUTED
// =============================================================================

// Filtered customers
const filteredCustomers = computed(() => {
  if (!customers.value) return []

  let filtered = customers.value

  // Search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(c =>
      c.customerName.toLowerCase().includes(query) ||
      c.email.toLowerCase().includes(query) ||
      c.company?.toLowerCase().includes(query)
    )
  }

  // Plan filter
  if (filters.value.plan !== 'all') {
    filtered = filtered.filter(c => c.planName === filters.value.plan)
  }

  // Status filter
  if (filters.value.status !== 'all') {
    filtered = filtered.filter(c => c.status === filters.value.status)
  }

  // Profitability filter
  if (filters.value.profitability !== 'all') {
    if (filters.value.profitability === 'profitable') {
      filtered = filtered.filter(c => c.trueMargin > 0)
    } else if (filters.value.profitability === 'negative') {
      filtered = filtered.filter(c => c.trueMargin <= 0)
    }
  }

  // Risk filter
  if (filters.value.risk !== 'all') {
    filtered = filtered.filter(c => c.riskLevel === filters.value.risk)
  }

  return filtered
})

// Summary metrics
const summary = computed(() => {
  if (!customers.value || customers.value.length === 0) return null

  const total = customers.value.length
  const profitable = customers.value.filter(c => c.trueMargin > 0).length
  const negativeMargin = customers.value.filter(c => c.trueMargin <= 0).length
  const atRisk = customers.value.filter(c => c.riskLevel === 'high').length
  const totalMRR = customers.value.reduce((sum, c) => sum + c.mrr, 0)
  const avgMargin = customers.value.reduce((sum, c) => sum + c.trueMargin, 0) / total

  return {
    total,
    profitable,
    negativeMargin,
    atRisk,
    totalMRR,
    avgMargin,
    profitablePercentage: (profitable / total) * 100,
  }
})

// Unique plans for filter
const uniquePlans = computed(() => {
  if (!customers.value) return []
  return Array.from(new Set(customers.value.map(c => c.planName))).sort()
})

// Risk distribution
const riskDistribution = computed(() => {
  if (!customers.value) return { high: 0, medium: 0, low: 0 }

  return {
    high: customers.value.filter(c => c.riskLevel === 'high').length,
    medium: customers.value.filter(c => c.riskLevel === 'medium').length,
    low: customers.value.filter(c => c.riskLevel === 'low').length,
  }
})

// Has active filters
const hasActiveFilters = computed(() => {
  return filters.value.plan !== 'all' ||
    filters.value.status !== 'all' ||
    filters.value.profitability !== 'all' ||
    filters.value.risk !== 'all'
})

// =============================================================================
// HANDLERS
// =============================================================================

function handleSelectCustomer(customer: CustomerInsight) {
  selectedCustomer.value = customer
  showDetailPanel.value = true
}

function handleCloseDetail() {
  selectedCustomer.value = null
  showDetailPanel.value = false
}

function clearFilters() {
  filters.value = {
    plan: 'all',
    status: 'all',
    profitability: 'all',
    risk: 'all',
  }
}

function handleExport() {
  console.log('Exporting customer data')
}

function handleSync() {
  refetch()
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <!-- Header -->
    <div class="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
      <div class="container mx-auto px-4 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <Button variant="ghost" size="sm" @click="router.push('/')">
              <ArrowLeft class="h-4 w-4 mr-2" />
              Dashboard
            </Button>
            <div>
              <h1 class="text-2xl font-bold">Customer Insights</h1>
              <p class="text-sm text-muted-foreground">
                Customer-level profitability and health analysis
              </p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <Button variant="outline" size="sm" @click="handleSync">
              <RefreshCw class="h-4 w-4 mr-2" />
              Sync
            </Button>
            <Button variant="outline" size="sm" @click="handleExport">
              <Download class="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button @click="router.push('/pricing')">
              <TrendingUp class="h-4 w-4 mr-2" />
              Run Simulation
            </Button>
          </div>
        </div>

        <!-- Summary Metrics -->
        <div v-if="summary" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-6">
          <Card>
            <CardContent class="p-4">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-muted-foreground">Total</p>
                  <p class="text-2xl font-bold">{{ summary.total }}</p>
                </div>
                <Users class="h-8 w-8 text-primary/30" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent class="p-4">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-muted-foreground">Profitable</p>
                  <p class="text-2xl font-bold text-green-600">{{ summary.profitable }}</p>
                  <p class="text-xs text-muted-foreground">{{ summary.profitablePercentage.toFixed(0) }}%</p>
                </div>
                <CheckCircle class="h-8 w-8 text-green-300" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent class="p-4">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-muted-foreground">Negative</p>
                  <p class="text-2xl font-bold text-red-600">{{ summary.negativeMargin }}</p>
                </div>
                <XCircle class="h-8 w-8 text-red-300" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent class="p-4">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-muted-foreground">At Risk</p>
                  <p class="text-2xl font-bold text-amber-600">{{ summary.atRisk }}</p>
                </div>
                <AlertTriangle class="h-8 w-8 text-amber-300" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent class="p-4">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-muted-foreground">Total MRR</p>
                  <p class="text-2xl font-bold">{{ formatCurrency(summary.totalMRR) }}</p>
                </div>
                <DollarSign class="h-8 w-8 text-blue-300" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent class="p-4">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-muted-foreground">Avg Margin</p>
                  <p class="text-2xl font-bold" :class="summary.avgMargin >= 0 ? 'text-green-600' : 'text-red-600'">
                    {{ formatPercent(summary.avgMargin / 100) }}
                  </p>
                </div>
                <BarChart3 class="h-8 w-8 text-purple-300" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="container mx-auto px-4 py-6">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left Column: Filters & Table -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Search & Filters -->
          <Card>
            <CardContent class="p-4">
              <div class="space-y-4">
                <!-- Search -->
                <div class="relative">
                  <Search class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    v-model="searchQuery"
                    placeholder="Search customers by name, email, or company..."
                    class="pl-10"
                  />
                </div>

                <!-- Filter Row -->
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <!-- Plan Filter -->
                  <select
                    v-model="filters.plan"
                    class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="all">All Plans</option>
                    <option v-for="plan in uniquePlans" :key="plan" :value="plan">
                      {{ plan }}
                    </option>
                  </select>

                  <!-- Status Filter -->
                  <select
                    v-model="filters.status"
                    class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="churned">Churned</option>
                    <option value="trial">Trial</option>
                  </select>

                  <!-- Profitability Filter -->
                  <select
                    v-model="filters.profitability"
                    class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="all">All Profitability</option>
                    <option value="profitable">Profitable Only</option>
                    <option value="negative">Negative Margin</option>
                  </select>

                  <!-- Risk Filter -->
                  <select
                    v-model="filters.risk"
                    class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="all">All Risk</option>
                    <option value="high">High Risk</option>
                    <option value="medium">Medium Risk</option>
                    <option value="low">Low Risk</option>
                  </select>
                </div>

                <!-- Active Filters -->
                <div v-if="hasActiveFilters" class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm text-muted-foreground">Active filters:</span>
                  <Badge v-if="filters.plan !== 'all'" variant="outline" class="gap-1">
                    {{ filters.plan }}
                    <button class="ml-1 hover:text-destructive" @click="filters.plan = 'all'">&times;</button>
                  </Badge>
                  <Badge v-if="filters.status !== 'all'" variant="outline" class="gap-1">
                    {{ filters.status }}
                    <button class="ml-1 hover:text-destructive" @click="filters.status = 'all'">&times;</button>
                  </Badge>
                  <Badge v-if="filters.profitability !== 'all'" variant="outline" class="gap-1">
                    {{ filters.profitability === 'profitable' ? 'Profitable' : 'Negative' }}
                    <button class="ml-1 hover:text-destructive" @click="filters.profitability = 'all'">&times;</button>
                  </Badge>
                  <Badge v-if="filters.risk !== 'all'" variant="outline" class="gap-1">
                    {{ filters.risk }} risk
                    <button class="ml-1 hover:text-destructive" @click="filters.risk = 'all'">&times;</button>
                  </Badge>
                  <Button variant="ghost" size="sm" @click="clearFilters">Clear all</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- Profitability Chart -->
          <CustomerProfitabilityChart
            v-if="customers && customers.length > 0"
            :customers="customers"
            :risk-distribution="riskDistribution"
          />

          <!-- Customer Table -->
          <Card>
            <CardHeader class="pb-3">
              <div class="flex items-center justify-between">
                <div>
                  <CardTitle>Customer List</CardTitle>
                  <CardDescription>
                    Showing {{ filteredCustomers.length }} of {{ customers?.length || 0 }} customers
                  </CardDescription>
                </div>
                <div class="flex items-center gap-2">
                  <Badge variant="outline">
                    {{ filteredCustomers.filter(c => c.trueMargin > 0).length }} profitable
                  </Badge>
                  <Badge variant="outline" class="text-amber-600">
                    {{ filteredCustomers.filter(c => c.riskLevel === 'high').length }} at risk
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <CustomerListTable
                :customers="filteredCustomers"
                :is-loading="isLoading"
                @select-customer="handleSelectCustomer"
              />
            </CardContent>
          </Card>
        </div>

        <!-- Right Column: Stats & Actions -->
        <div class="space-y-6">
          <!-- Risk Distribution -->
          <Card>
            <CardHeader>
              <CardTitle>Risk Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div class="space-y-4">
                <div v-for="level in ['high', 'medium', 'low'] as const" :key="level" class="space-y-2">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <div class="h-3 w-3 rounded-full" :class="{
                        'bg-red-500': level === 'high',
                        'bg-yellow-500': level === 'medium',
                        'bg-green-500': level === 'low'
                      }"></div>
                      <span class="text-sm font-medium capitalize">{{ level }} Risk</span>
                    </div>
                    <span class="font-semibold">{{ riskDistribution[level] }}</span>
                  </div>
                  <div class="w-full bg-muted rounded-full h-2">
                    <div
                      :class="{
                        'bg-red-500': level === 'high',
                        'bg-yellow-500': level === 'medium',
                        'bg-green-500': level === 'low'
                      }"
                      class="h-2 rounded-full transition-all"
                      :style="{ width: `${(riskDistribution[level] / (customers?.length || 1)) * 100}%` }"
                    ></div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- Plan Comparison -->
          <PlanComparisonView
            v-if="customers && customers.length > 0"
            :customers="customers"
          />

          <!-- Quick Actions -->
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <Button variant="outline" class="w-full justify-start" @click="router.push('/pricing')">
                <TrendingUp class="h-4 w-4 mr-2" />
                Adjust Pricing
              </Button>
              <Button variant="outline" class="w-full justify-start">
                <Mail class="h-4 w-4 mr-2" />
                Email At-Risk
              </Button>
              <Button variant="outline" class="w-full justify-start">
                <Package class="h-4 w-4 mr-2" />
                Plan Upgrades
              </Button>
              <Button variant="outline" class="w-full justify-start" @click="handleExport">
                <Download class="h-4 w-4 mr-2" />
                Export Report
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>

    <!-- Customer Detail Panel -->
    <CustomerDetailPanel
      :customer="selectedCustomer"
      :open="showDetailPanel"
      @close="handleCloseDetail"
    />
  </div>
</template>

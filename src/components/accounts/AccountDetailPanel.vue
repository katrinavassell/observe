<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import {
  X,
  Building2,
  Globe,
  Mail,
  CreditCard,
  Receipt,
  Link2,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  ExternalLink,
} from 'lucide-vue-next'
import { Button, Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import Skeleton from '@/components/ui/skeleton.vue'
import { getAccountById } from '@/api/client'
import { formatCurrency } from '@/lib/utils'

const props = defineProps<{
  accountId: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { data: account, isLoading, error } = useQuery({
  queryKey: ['account-detail', props.accountId],
  queryFn: () => getAccountById(props.accountId),
})

function getStatusBadgeVariant(status: string) {
  switch (status.toLowerCase()) {
    case 'active': return 'success'
    case 'paid': return 'success'
    case 'canceled':
    case 'cancelled': return 'destructive'
    case 'past_due':
    case 'pending': return 'warning'
    default: return 'secondary'
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString()
}
</script>

<template>
  <div class="h-full flex flex-col bg-background">
    <!-- Header -->
    <div class="flex items-start justify-between p-6 border-b">
      <div v-if="isLoading" class="space-y-2">
        <Skeleton class="h-6 w-48" />
        <Skeleton class="h-4 w-32" />
      </div>
      <div v-else-if="account" class="space-y-1">
        <h2 class="text-xl font-semibold">{{ account.name }}</h2>
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary" class="capitalize">{{ account.source_system }}</Badge>
          <span v-if="account.domain">{{ account.domain }}</span>
        </div>
      </div>
      <Button variant="ghost" size="icon" @click="emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-6 space-y-6">
      <!-- Loading -->
      <div v-if="isLoading" class="space-y-4">
        <Skeleton class="h-24" />
        <Skeleton class="h-32" />
        <Skeleton class="h-32" />
      </div>

      <!-- Error -->
      <div v-else-if="error" class="text-center py-8 text-destructive">
        <p>Failed to load account details</p>
      </div>

      <template v-else-if="account">
        <!-- Key Metrics -->
        <div class="grid grid-cols-2 gap-4">
          <Card>
            <CardContent class="p-4">
              <div class="text-2xl font-bold">{{ formatCurrency(account.arr) }}</div>
              <div class="text-xs text-muted-foreground">Annual Recurring Revenue</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="p-4">
              <div class="text-2xl font-bold">{{ formatCurrency(account.mrr) }}</div>
              <div class="text-xs text-muted-foreground">Monthly Recurring Revenue</div>
            </CardContent>
          </Card>
        </div>

        <!-- Account Info -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-sm flex items-center gap-2">
              <Building2 class="h-4 w-4" />
              Account Info
            </CardTitle>
          </CardHeader>
          <CardContent class="space-y-3">
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div class="text-muted-foreground text-xs">Segment</div>
                <div>
                  <Badge v-if="account.segment" variant="outline">{{ account.segment }}</Badge>
                  <span v-else class="text-muted-foreground">—</span>
                </div>
              </div>
              <div>
                <div class="text-muted-foreground text-xs">Plan</div>
                <div>{{ account.plan_tier || '—' }}</div>
              </div>
              <div>
                <div class="text-muted-foreground text-xs">Industry</div>
                <div>{{ account.industry || '—' }}</div>
              </div>
              <div>
                <div class="text-muted-foreground text-xs">Created</div>
                <div>{{ formatDate(account.created_at) }}</div>
              </div>
            </div>

            <div v-if="account.website || account.email_domain" class="flex flex-wrap gap-2 pt-2 border-t">
              <a
                v-if="account.website"
                :href="account.website.startsWith('http') ? account.website : `https://${account.website}`"
                target="_blank"
                class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Globe class="h-3 w-3" />
                {{ account.website }}
                <ExternalLink class="h-3 w-3" />
              </a>
              <span
                v-if="account.email_domain"
                class="inline-flex items-center gap-1 text-xs text-muted-foreground"
              >
                <Mail class="h-3 w-3" />
                {{ account.email_domain }}
              </span>
            </div>
          </CardContent>
        </Card>

        <!-- Subscriptions -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-sm flex items-center justify-between">
              <span class="flex items-center gap-2">
                <CreditCard class="h-4 w-4" />
                Subscriptions
              </span>
              <Badge variant="secondary">{{ account.subscriptions.length }}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="account.subscriptions.length === 0" class="text-sm text-muted-foreground text-center py-4">
              No subscriptions
            </div>
            <div v-else class="space-y-3">
              <div
                v-for="sub in account.subscriptions"
                :key="sub.id"
                class="flex items-center justify-between p-3 rounded-lg border"
              >
                <div>
                  <div class="font-medium text-sm">{{ sub.plan_tier }}</div>
                  <div class="text-xs text-muted-foreground">
                    {{ sub.billing_interval || 'monthly' }}
                    <span v-if="sub.discount_percent"> · {{ sub.discount_percent }}% off</span>
                  </div>
                </div>
                <div class="text-right">
                  <Badge :variant="getStatusBadgeVariant(sub.status)" class="text-[10px] uppercase mb-1">
                    {{ sub.status }}
                  </Badge>
                  <div class="font-mono text-sm">{{ formatCurrency(sub.amount) }}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Usage -->
        <Card v-if="account.usage.length > 0">
          <CardHeader class="pb-3">
            <CardTitle class="text-sm flex items-center gap-2">
              <TrendingUp class="h-4 w-4" />
              Usage Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-3">
              <div
                v-for="usage in account.usage"
                :key="usage.metric_key"
                class="flex items-center justify-between"
              >
                <span class="text-sm capitalize">{{ usage.metric_key.replace(/_/g, ' ') }}</span>
                <span class="font-mono text-sm">{{ usage.metric_value.toLocaleString() }}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Recent Invoices -->
        <Card v-if="account.invoices.length > 0">
          <CardHeader class="pb-3">
            <CardTitle class="text-sm flex items-center justify-between">
              <span class="flex items-center gap-2">
                <Receipt class="h-4 w-4" />
                Recent Invoices
              </span>
              <Badge variant="secondary">{{ account.invoices.length }}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-2">
              <div
                v-for="invoice in account.invoices.slice(0, 5)"
                :key="invoice.id"
                class="flex items-center justify-between text-sm py-2 border-b last:border-0"
              >
                <div class="flex items-center gap-2">
                  <Badge :variant="getStatusBadgeVariant(invoice.status)" class="text-[10px] uppercase">
                    {{ invoice.status }}
                  </Badge>
                  <span class="text-muted-foreground">{{ formatDate(invoice.date) }}</span>
                </div>
                <span class="font-mono">{{ formatCurrency(invoice.amount) }}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Matched Accounts -->
        <Card v-if="account.matches.length > 0">
          <CardHeader class="pb-3">
            <CardTitle class="text-sm flex items-center justify-between">
              <span class="flex items-center gap-2">
                <Link2 class="h-4 w-4" />
                Matched Accounts
              </span>
              <Badge variant="secondary">{{ account.matches.length }}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-3">
              <div
                v-for="match in account.matches"
                :key="match.id"
                class="flex items-center justify-between p-3 rounded-lg border"
              >
                <div class="flex items-center gap-3">
                  <component
                    :is="match.is_confirmed ? CheckCircle : match.is_rejected ? XCircle : Clock"
                    :class="[
                      'h-4 w-4',
                      match.is_confirmed ? 'text-success' : match.is_rejected ? 'text-destructive' : 'text-warning'
                    ]"
                  />
                  <div>
                    <div class="font-medium text-sm">{{ match.matched_account_name }}</div>
                    <div class="text-xs text-muted-foreground capitalize">{{ match.matched_source_system }}</div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-sm font-mono">{{ (match.score * 100).toFixed(0) }}%</div>
                  <div class="text-xs text-muted-foreground capitalize">{{ match.confidence }}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </template>
    </div>
  </div>
</template>

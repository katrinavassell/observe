<script setup lang="ts">
/**
 * StripeSyncProgress - Shows Stripe data sync progress
 *
 * Displays:
 * - Overall sync progress bar
 * - Per-data-type progress (customers, subscriptions, invoices)
 * - Error states and retry options
 * - Completion summary
 */

import { computed } from 'vue'
import {
  Users,
  CreditCard,
  Receipt,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  AlertTriangle,
} from 'lucide-vue-next'
import { Card, CardContent, Progress, Button, Badge, Alert } from '@/components/ui'
import type { SyncState } from '@/composables/useStripeConnection'
import type { StripeSyncStatus } from '@/lib/stripe-api'

// =============================================================================
// PROPS & EMITS
// =============================================================================

const props = defineProps<{
  syncState: SyncState
  onCancel?: () => void
  onRetry?: () => void
}>()

const emit = defineEmits<{
  cancel: []
  retry: []
  close: []
}>()

// =============================================================================
// COMPUTED
// =============================================================================

const overallProgress = computed(() => {
  const { customers, subscriptions, invoices } = props.syncState
  const total = customers.total + subscriptions.total + invoices.total
  const synced = customers.synced + subscriptions.synced + invoices.synced

  if (total === 0) return 0
  return Math.round((synced / total) * 100)
})

const isComplete = computed(() => props.syncState.status === 'completed')
const isFailed = computed(() => props.syncState.status === 'failed')
const isInProgress = computed(() => props.syncState.status === 'in_progress')
const isCancelled = computed(() => props.syncState.status === 'cancelled')

const duration = computed(() => {
  if (!props.syncState.startedAt) return null

  const end = props.syncState.completedAt || new Date()
  const durationMs = end.getTime() - props.syncState.startedAt.getTime()
  const seconds = Math.round(durationMs / 1000)

  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
})

const dataTypes = computed(() => [
  {
    key: 'customers' as const,
    label: 'Customers',
    icon: Users,
    progress: props.syncState.customers,
  },
  {
    key: 'subscriptions' as const,
    label: 'Subscriptions',
    icon: CreditCard,
    progress: props.syncState.subscriptions,
  },
  {
    key: 'invoices' as const,
    label: 'Invoices',
    icon: Receipt,
    progress: props.syncState.invoices,
  },
])

// =============================================================================
// HELPERS
// =============================================================================

function getStatusIcon(status: StripeSyncStatus) {
  switch (status) {
    case 'completed':
      return CheckCircle2
    case 'failed':
      return XCircle
    case 'in_progress':
      return Loader2
    case 'cancelled':
      return XCircle
    default:
      return Clock
  }
}

function getStatusColor(status: StripeSyncStatus): string {
  switch (status) {
    case 'completed':
      return 'text-green-500'
    case 'failed':
      return 'text-destructive'
    case 'in_progress':
      return 'text-primary animate-spin'
    case 'cancelled':
      return 'text-muted-foreground'
    default:
      return 'text-muted-foreground'
  }
}
</script>

<template>
  <Card class="border-primary/20">
    <CardContent class="p-6 space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div
            class="h-10 w-10 rounded-lg flex items-center justify-center"
            :class="[
              isComplete ? 'bg-green-500/10' : '',
              isFailed ? 'bg-destructive/10' : '',
              isInProgress ? 'bg-primary/10' : '',
              !isComplete && !isFailed && !isInProgress ? 'bg-muted' : '',
            ]"
          >
            <component
              :is="getStatusIcon(syncState.status)"
              class="h-5 w-5"
              :class="getStatusColor(syncState.status)"
            />
          </div>
          <div>
            <h3 class="font-medium">
              {{
                isComplete ? 'Sync Complete' :
                isFailed ? 'Sync Failed' :
                isCancelled ? 'Sync Cancelled' :
                isInProgress ? 'Syncing Stripe Data...' :
                'Preparing Sync'
              }}
            </h3>
            <p class="text-sm text-muted-foreground">
              {{ syncState.totalSynced.toLocaleString() }} records
              <template v-if="duration">
                in {{ duration }}
              </template>
            </p>
          </div>
        </div>

        <Badge
          v-if="isInProgress"
          variant="secondary"
          class="font-mono"
        >
          {{ overallProgress }}%
        </Badge>
      </div>

      <!-- Overall Progress Bar -->
      <div v-if="isInProgress || isComplete" class="space-y-2">
        <Progress
          :value="overallProgress"
          :class="[
            isComplete ? 'bg-green-500/20' : '',
            isFailed ? 'bg-destructive/20' : '',
          ]"
          :indicator-class="[
            isComplete ? 'bg-green-500' : '',
            isFailed ? 'bg-destructive' : '',
          ]"
        />
      </div>

      <!-- Per-Type Progress -->
      <div class="grid gap-3">
        <div
          v-for="{ key, label, icon, progress } in dataTypes"
          :key="key"
          class="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
        >
          <component :is="icon" class="h-4 w-4 text-muted-foreground" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between mb-1">
              <span class="text-sm font-medium">{{ label }}</span>
              <span class="text-xs text-muted-foreground tabular-nums">
                {{ progress.synced.toLocaleString() }}
                <template v-if="progress.total > 0">
                  / {{ progress.total.toLocaleString() }}
                </template>
              </span>
            </div>
            <Progress
              v-if="progress.status !== 'pending'"
              :value="progress.percentage"
              class="h-1"
              :indicator-class="[
                progress.status === 'completed' ? 'bg-green-500' : '',
                progress.status === 'failed' ? 'bg-destructive' : '',
              ]"
            />
          </div>
          <component
            :is="getStatusIcon(progress.status)"
            class="h-4 w-4 shrink-0"
            :class="getStatusColor(progress.status)"
          />
        </div>
      </div>

      <!-- Errors -->
      <Alert v-if="syncState.errors.length > 0" variant="destructive">
        <AlertTriangle class="h-4 w-4" />
        <div class="ml-2">
          <p class="text-sm font-medium">
            {{ syncState.errors.length }} error{{ syncState.errors.length > 1 ? 's' : '' }} occurred
          </p>
          <ul class="text-sm mt-1 space-y-0.5">
            <li v-for="(error, index) in syncState.errors" :key="index">
              <span class="font-medium capitalize">{{ error.type }}:</span>
              {{ error.message }}
            </li>
          </ul>
        </div>
      </Alert>

      <!-- Actions -->
      <div class="flex gap-2 pt-2">
        <template v-if="isInProgress">
          <Button
            variant="outline"
            class="flex-1"
            @click="emit('cancel')"
          >
            Cancel
          </Button>
        </template>

        <template v-else-if="isFailed || isCancelled">
          <Button
            variant="outline"
            class="flex-1"
            @click="emit('close')"
          >
            Close
          </Button>
          <Button
            class="flex-1"
            @click="emit('retry')"
          >
            Retry
          </Button>
        </template>

        <template v-else-if="isComplete">
          <Button
            class="w-full"
            @click="emit('close')"
          >
            <CheckCircle2 class="h-4 w-4 mr-2" />
            View Analysis
          </Button>
        </template>
      </div>
    </CardContent>
  </Card>
</template>

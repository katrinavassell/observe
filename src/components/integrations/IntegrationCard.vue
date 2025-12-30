<script setup lang="ts">
import { computed } from 'vue'
import {
  Check,
  ExternalLink,
  RefreshCw,
  Loader2,
  AlertCircle,
} from 'lucide-vue-next'
import { Card, CardContent, Badge, Button } from '@/components/ui'

export interface Integration {
  provider: string
  name: string
  description: string
  category: string
  data_types: string[]
  available: boolean
  status: 'connected' | 'disconnected' | 'syncing' | 'error'
  connected_at: string | null
  last_sync_at: string | null
  records_synced: number
  account_name: string | null
}

const props = defineProps<{
  integration: Integration
  connecting?: boolean
  syncing?: boolean
}>()

const emit = defineEmits<{
  connect: []
  disconnect: []
  sync: []
}>()

const isConnected = computed(() => props.integration.status === 'connected')
const isSyncing = computed(() => props.integration.status === 'syncing' || props.syncing)
const hasError = computed(() => props.integration.status === 'error')

const cardClass = computed(() => {
  const classes = ['relative', 'transition-all']
  if (!props.integration.available) classes.push('opacity-60')
  if (isConnected.value) classes.push('border-success/50')
  if (hasError.value) classes.push('border-destructive/50')
  return classes.join(' ')
})

const iconMap: Record<string, string> = {
  stripe: '/icons/stripe.svg',
  salesforce: '/icons/salesforce.svg',
  hubspot: '/icons/hubspot.svg',
  quickbooks: '/icons/quickbooks.svg',
  google_sheets: '/icons/google-sheets.svg',
}

const categoryColors: Record<string, string> = {
  billing: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  crm: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  files: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}

function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never'
  const date = new Date(dateString)
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <Card :class="cardClass">
    <CardContent class="p-5">
      <div class="flex items-start justify-between gap-4">
        <!-- Logo & Info -->
        <div class="flex items-start gap-4 flex-1">
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
            <img
              v-if="iconMap[integration.provider]"
              :src="iconMap[integration.provider]"
              :alt="integration.name"
              class="h-8 w-8"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            />
            <span
              v-else
              class="text-lg font-bold text-muted-foreground"
            >
              {{ integration.name.charAt(0) }}
            </span>
          </div>

          <div class="flex-1">
            <div class="flex items-center gap-2">
              <h3 class="font-semibold">{{ integration.name }}</h3>
              <Badge
                v-if="isConnected"
                variant="success"
                class="text-[10px] gap-1"
              >
                <Check class="h-3 w-3" />
                Connected
              </Badge>
              <Badge
                v-else-if="hasError"
                variant="destructive"
                class="text-[10px] gap-1"
              >
                <AlertCircle class="h-3 w-3" />
                Error
              </Badge>
              <Badge
                v-else-if="!integration.available"
                variant="secondary"
                class="text-[10px]"
              >
                Coming Soon
              </Badge>
            </div>

            <p class="text-sm text-muted-foreground mt-0.5">
              {{ integration.description }}
            </p>

            <!-- Connected Account Info -->
            <div v-if="isConnected && integration.account_name" class="mt-2 text-xs text-muted-foreground">
              <span class="font-medium">{{ integration.account_name }}</span>
              <span v-if="integration.last_sync_at">
                 &middot; Last synced {{ formatDate(integration.last_sync_at) }}
              </span>
              <span v-if="integration.records_synced > 0">
                 &middot; {{ integration.records_synced.toLocaleString() }} records
              </span>
            </div>

            <!-- Data Type Tags -->
            <div class="flex flex-wrap gap-1.5 mt-3">
              <Badge
                v-for="type in integration.data_types"
                :key="type"
                variant="outline"
                class="text-[10px] capitalize"
              >
                {{ type }}
              </Badge>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex flex-col gap-2">
          <template v-if="integration.available">
            <template v-if="isConnected">
              <Button
                variant="outline"
                size="sm"
                :disabled="isSyncing"
                @click="emit('sync')"
              >
                <Loader2 v-if="isSyncing" class="mr-1 h-3 w-3 animate-spin" />
                <RefreshCw v-else class="mr-1 h-3 w-3" />
                {{ isSyncing ? 'Syncing...' : 'Sync' }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="text-destructive hover:text-destructive"
                @click="emit('disconnect')"
              >
                Disconnect
              </Button>
            </template>
            <Button
              v-else
              size="sm"
              :disabled="connecting"
              @click="emit('connect')"
            >
              <Loader2 v-if="connecting" class="mr-1 h-3 w-3 animate-spin" />
              <ExternalLink v-else class="mr-1 h-3 w-3" />
              {{ connecting ? 'Connecting...' : 'Connect' }}
            </Button>
          </template>
          <Badge
            v-else
            :class="categoryColors[integration.category]"
            class="text-[10px]"
          >
            {{ integration.category }}
          </Badge>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

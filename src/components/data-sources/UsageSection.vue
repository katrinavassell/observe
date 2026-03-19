<script setup lang="ts">
/**
 * UsageSection - Usage data upload component.
 *
 * Handles:
 * - CSV file upload for usage data
 * - Sample usage data loading
 * - Template downloads
 * - Stripe metered billing info
 */

import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import Papa from 'papaparse'
import {
  BarChart3,
  Upload,
  Download,
  CheckCircle,
  X,
  Info,
} from 'lucide-vue-next'
import { Card, CardContent } from '@/components/ui'
import Alert from '@/components/ui/alert.vue'
import * as api from '@/lib/api'
import {
  validateFileSize,
  validateCsvExtension,
  validateUsageRecords,
} from '@/lib/validation'
import { useStripeConnection } from '@/composables/useStripeConnection'

const props = defineProps<{
  /** Current file info if any */
  file: { name: string; isSample: boolean } | null
  /** Whether sample data is being loaded */
  isLoadingSample?: boolean
}>()

const emit = defineEmits<{
  /** Emitted after successful upload with updated file info */
  fileUploaded: [file: { name: string; isSample: boolean }]
  /** Emitted when file is cleared */
  fileCleared: []
  /** Emitted when user wants to use sample data */
  useSample: []
}>()

// Stripe connection to check for synced usage
const { syncState, isConnected } = useStripeConnection()
const hasStripeUsage = computed(() => isConnected.value && syncState.value.usage.synced > 0)

// Upload state
const isUploading = ref(false)
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function triggerFileInput(): void {
  fileInput.value?.click()
}

function handleFileSelect(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    processFile(file)
  }
  input.value = ''
}

function handleDrop(event: DragEvent): void {
  isDragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file) {
    processFile(file)
  }
}

/**
 * Process and upload a usage CSV file.
 * Expected columns: month, customer_id, metric, value, limit (optional)
 */
async function processFile(file: File): Promise<void> {
  // Validate file extension
  const extValidation = validateCsvExtension(file)
  if (!extValidation.valid) {
    toast.error(extValidation.error!)
    return
  }

  // Validate file size
  const sizeValidation = validateFileSize(file)
  if (!sizeValidation.valid) {
    toast.error(sizeValidation.error!)
    return
  }

  isUploading.value = true

  try {
    const parseResult = await new Promise<Papa.ParseResult<Record<string, unknown>>>((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: resolve,
        error: reject,
      })
    })

    const rows = parseResult.data

    // Validate records (supports both metric/value and metric_key/metric_value naming)
    const validation = validateUsageRecords(rows as {
      customer_id?: string
      month?: string
      metric?: string
      value?: number | string
      limit?: number | string
    }[])

    if (!validation.valid) {
      toast.error('No valid usage records found', {
        description: validation.errors.length > 0
          ? validation.errors.slice(0, 3).join('; ')
          : 'CSV must have columns: month, customer_id, metric, value',
      })
      return
    }

    // Filter to valid records only
    const records: UsageRecord[] = rows
      .filter(r => r.month && r.customer_id && r.metric && r.value)
      .map(r => ({
        month: String(r.month),
        customer_id: String(r.customer_id),
        metric: String(r.metric),
        value: parseFloat(String(r.value)) || 0,
        limit: r.limit ? parseFloat(String(r.limit)) : undefined,
      }))

    const result = await api.uploadUsageData(records)
    emit('fileUploaded', { name: file.name, isSample: false })

    // Show success with validation summary
    const description = validation.invalidRecords > 0
      ? `${result.count} records saved, ${validation.invalidRecords} invalid rows skipped`
      : `${result.count} usage records saved`

    toast.success('Usage uploaded!', { description })
  } catch (error) {
    toast.error('Failed to upload usage data', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    isUploading.value = false
  }
}

/**
 * Download a CSV template for usage data.
 */
function downloadTemplate(): void {
  const content = `month,customer_id,metric,value,limit
2024-12,cust_001,api_calls,8500,10000
2024-12,cust_001,tokens,9500000,10000000
2024-12,cust_002,api_calls,1800,2000
2024-12,cust_002,tokens,1900000,2000000`

  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'usage-template.csv'
  a.click()
  URL.revokeObjectURL(url)

  toast.success('Usage template downloaded', {
    description: 'Fill in your data and upload it back.',
  })
}
</script>

<template>
  <section>
    <div class="flex items-center gap-2 mb-4">
      <BarChart3 class="h-5 w-5 text-muted-foreground" />
      <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Usage</h2>
    </div>

    <Card>
      <CardContent class="p-5 space-y-4">
        <!-- Info if Stripe usage exists -->
        <Alert v-if="hasStripeUsage" variant="info" class="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <Info class="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <div class="ml-2">
            <p class="text-sm text-blue-800 dark:text-blue-200">
              You have usage data from Stripe. Any CSV data will be added to it.
            </p>
          </div>
        </Alert>

        <!-- Hidden file input -->
        <input
          ref="fileInput"
          type="file"
          accept=".csv"
          class="hidden"
          @change="handleFileSelect"
        />

        <!-- Drop zone - only show when no file -->
        <div
          v-if="!file"
          :class="[
            'border-2 border-dashed rounded-lg p-5 transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25'
          ]"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
        >
          <div
            class="text-center cursor-pointer"
            @click="triggerFileInput"
          >
            <Upload class="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
            <p class="text-sm text-muted-foreground">
              Drop one CSV here or <span class="text-primary font-medium">browse</span>
            </p>
          </div>
        </div>

        <!-- File display - only show when file exists -->
        <div v-if="file" class="border rounded-lg p-4">
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2">
              <CheckCircle class="h-4 w-4 text-green-500" />
              <span>{{ file.name }}</span>
            </div>
            <button
              type="button"
              class="p-0.5 rounded hover:bg-muted transition-colors"
              @click="emit('fileCleared')"
            >
              <X class="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div class="flex items-center justify-center gap-4">
          <button
            type="button"
            class="text-xs text-primary hover:underline flex items-center gap-1"
            @click="downloadTemplate"
          >
            <Download class="h-3 w-3" />
            Download template
          </button>
          <span class="text-muted-foreground/30">|</span>
          <button
            type="button"
            class="text-xs text-muted-foreground hover:text-foreground"
            :disabled="isLoadingSample"
            @click="emit('useSample')"
          >
            {{ isLoadingSample ? 'Loading...' : 'Use sample data' }}
          </button>
        </div>

        <!-- Stripe metered billing note -->
        <Alert variant="info" class="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <Info class="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <div class="ml-2">
            <p class="text-sm font-medium text-blue-800 dark:text-blue-200">Using Stripe metered billing?</p>
            <p class="text-xs text-blue-700 dark:text-blue-300 mt-1">
              If you connected Stripe above and use Billing Meters or Usage Records,
              we'll detect and pull usage automatically. No CSV needed.
            </p>
          </div>
        </Alert>
      </CardContent>
    </Card>
  </section>
</template>

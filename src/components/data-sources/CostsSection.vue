<script setup lang="ts">
/**
 * CostsSection - AI costs data upload component.
 *
 * Handles:
 * - OpenAI/Anthropic integration placeholders
 * - CSV file upload for cost data
 * - Sample cost data loading
 * - Template downloads
 */

import { ref } from 'vue'
import { toast } from 'vue-sonner'
import Papa from 'papaparse'
import {
  Cpu,
  Upload,
  Download,
  CheckCircle,
  X,
} from 'lucide-vue-next'
import { Card, CardContent, Button } from '@/components/ui'
import { uploadCostData, type CostRecord } from '@/lib/supabase-data'
import {
  validateFileSize,
  validateCsvExtension,
  validateCostRecords,
} from '@/lib/validation'
import AnthropicApiKeyModal from '@/components/integrations/AnthropicApiKeyModal.vue'

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

// Upload state
const isUploading = ref(false)
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

// Modal state
const showAnthropicModal = ref(false)
const isAnthropicConnected = ref(false)

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
 * Process and upload a cost CSV file.
 * Expected columns: month, provider (optional), customer_id (optional), cost
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

    // Validate records
    const validation = validateCostRecords(rows as { customer_id?: string; month?: string; cost?: number | string }[])

    if (!validation.valid) {
      toast.error('No valid cost records found', {
        description: validation.errors.length > 0
          ? validation.errors.slice(0, 3).join('; ')
          : 'CSV must have columns: month, cost (and optionally provider)',
      })
      return
    }

    // Filter to valid records only
    const records: CostRecord[] = rows
      .filter(r => r.month && r.cost)
      .map(r => ({
        month: String(r.month),
        provider: r.provider ? String(r.provider) : undefined,
        customer_id: r.customer_id ? String(r.customer_id) : undefined,
        cost: parseFloat(String(r.cost)) || 0,
      }))

    const result = await uploadCostData(records)
    emit('fileUploaded', { name: file.name, isSample: false })

    // Show success with validation summary
    const description = validation.invalidRecords > 0
      ? `${result.count} records saved, ${validation.invalidRecords} invalid rows skipped`
      : `${result.count} cost records saved`

    toast.success('Costs uploaded!', { description })
  } catch (error) {
    toast.error('Failed to upload cost data', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    isUploading.value = false
  }
}

/**
 * Download a CSV template for cost data.
 */
function downloadTemplate(): void {
  const content = `month,provider,cost
2024-12,openai,3200
2024-12,anthropic,3000
2024-11,openai,2800
2024-11,anthropic,2600`

  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'costs-template.csv'
  a.click()
  URL.revokeObjectURL(url)

  toast.success('Costs template downloaded', {
    description: 'Fill in your data and upload it back.',
  })
}

function handleConnectOpenAI(): void {
  toast.info('OpenAI integration coming soon', {
    description: 'Export usage from OpenAI Dashboard and upload as CSV',
  })
}

function handleConnectAnthropic(): void {
  showAnthropicModal.value = true
}

function handleAnthropicConnected(): void {
  isAnthropicConnected.value = true
}
</script>

<template>
  <section>
    <div class="flex items-center gap-2 mb-4">
      <Cpu class="h-5 w-5 text-muted-foreground" />
      <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">AI Costs</h2>
    </div>

    <Card>
      <CardContent class="p-5 space-y-4">
        <!-- OpenAI -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 rounded-lg bg-black flex items-center justify-center">
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="white">
                <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
              </svg>
            </div>
            <div>
              <p class="font-medium">OpenAI</p>
              <p class="text-xs text-muted-foreground">Pull monthly usage and token costs</p>
            </div>
          </div>
          <Button variant="outline" size="sm" @click="handleConnectOpenAI">
            Connect
          </Button>
        </div>

        <!-- Anthropic -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 rounded-lg bg-[#D4A574]/10 flex items-center justify-center">
              <span class="text-lg font-semibold text-[#D4A574]">A</span>
            </div>
            <div>
              <p class="font-medium">Anthropic</p>
              <p class="text-xs text-muted-foreground">
                {{ isAnthropicConnected ? 'Connected' : 'Pull monthly usage and token costs' }}
              </p>
            </div>
          </div>
          <Button
            v-if="!isAnthropicConnected"
            variant="outline"
            size="sm"
            @click="handleConnectAnthropic"
          >
            Connect
          </Button>
          <CheckCircle v-else class="h-5 w-5 text-green-500" />
        </div>

        <!-- Divider -->
        <div class="relative">
          <div class="absolute inset-0 flex items-center">
            <div class="w-full border-t"></div>
          </div>
          <div class="relative flex justify-center text-xs">
            <span class="bg-card px-2 text-muted-foreground">add CSV for other providers</span>
          </div>
        </div>

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
      </CardContent>
    </Card>

    <!-- Anthropic API Key Modal -->
    <AnthropicApiKeyModal
      :open="showAnthropicModal"
      @close="showAnthropicModal = false"
      @connected="handleAnthropicConnected"
    />
  </section>
</template>

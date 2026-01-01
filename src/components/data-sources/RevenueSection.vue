<script setup lang="ts">
/**
 * RevenueSection - Stripe data upload and reconciliation component.
 *
 * Handles:
 * - Stripe CSV file uploads (customers, subscriptions, invoices)
 * - Auto-detection of file types
 * - Data reconciliation across files
 * - Sample data loading
 */

import { ref } from 'vue'
import {
  DollarSign,
  Upload,
  Info,
  CheckCircle,
  X,
  ChevronDown,
  Check,
  AlertTriangle,
  Loader2,
  ArrowRight,
} from 'lucide-vue-next'
import { Card, CardContent, Button } from '@/components/ui'
import { useStripeUpload } from '@/composables/useStripeUpload'

const props = defineProps<{
  /** Whether sample revenue data is being loaded */
  isLoadingSample?: boolean
  /** Whether Stripe is connected */
  isStripeConnected?: boolean
  /** Connected Stripe account name */
  stripeAccountName?: string
}>()

const emit = defineEmits<{
  /** Emitted when user wants to use sample revenue data */
  useSample: []
  /** Emitted when Stripe connect button is clicked */
  connectStripe: []
  /** Emitted when files change (for unsaved changes tracking) */
  filesChanged: []
  /** Emitted when all revenue files are cleared */
  allFilesCleared: []
}>()

// Initialize the Stripe upload composable
const {
  stripeCustomersFile,
  stripeSubscriptionsFile,
  stripeInvoicesFile,
  stripeFileCount,
  reconciliationReport,
  isReconciling,
  showReconciliation,
  canReconcile,
  isUploading,
  uploadError,
  isDragging,
  processStripeFile,
  clearStripeFile,
  handleReconcile,
  handleUploadAndContinue,
  setSampleDataLoaded,
  formatCurrency,
} = useStripeUpload()

// Expose setSampleDataLoaded for parent to call when sample data is loaded
defineExpose({
  setSampleDataLoaded,
})

// File input ref
const stripeFileInput = ref<HTMLInputElement | null>(null)

// Show Stripe export instructions
const showStripeInstructions = ref(false)

function triggerFileInput(): void {
  stripeFileInput.value?.click()
}

function handleFileSelect(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (files) {
    for (const file of files) {
      processStripeFile(file)
    }
    emit('filesChanged')
  }
  // Reset input so same file can be selected again
  input.value = ''
}

function handleDrop(event: DragEvent): void {
  isDragging.value = false
  const files = event.dataTransfer?.files
  if (files) {
    for (const file of files) {
      processStripeFile(file)
    }
    emit('filesChanged')
  }
}

function handleClearFile(type: 'customers' | 'subscriptions' | 'invoices'): void {
  clearStripeFile(type)
  emit('filesChanged')

  // Check if all files are now cleared
  if (!stripeCustomersFile.value && !stripeSubscriptionsFile.value && !stripeInvoicesFile.value) {
    emit('allFilesCleared')
  }
}
</script>

<template>
  <section>
    <div class="flex items-center gap-2 mb-4">
      <DollarSign class="h-5 w-5 text-muted-foreground" />
      <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Revenue</h2>
    </div>

    <Card>
      <CardContent class="p-5 space-y-4">
        <!-- Stripe Connect -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 rounded-lg bg-[#635BFF]/10 flex items-center justify-center">
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="#635BFF">
                <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
              </svg>
            </div>
            <div>
              <p class="font-medium">Stripe</p>
              <p class="text-xs text-muted-foreground">
                {{ props.isStripeConnected ? props.stripeAccountName : 'Pull customers, subscriptions, and invoices' }}
              </p>
            </div>
          </div>
          <Button
            :variant="props.isStripeConnected ? 'outline' : 'outline'"
            size="sm"
            :class="props.isStripeConnected ? 'border-green-500/50 text-green-600 hover:text-green-700 hover:bg-green-50' : ''"
            @click="emit('connectStripe')"
          >
            <span v-if="props.isStripeConnected" class="flex items-center gap-1.5">
              <span class="h-2 w-2 rounded-full bg-green-500"></span>
              Connected
            </span>
            <span v-else>Connect</span>
          </Button>
        </div>

        <!-- When connected via API, show sync status -->
        <div v-if="props.isStripeConnected" class="bg-green-50 border border-green-200 rounded-lg p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle class="h-4 w-4" />
              <span>Connected to Stripe API - data will sync automatically</span>
            </div>
            <Button variant="outline" size="sm" class="text-green-700 border-green-300 hover:bg-green-100">
              Sync Now
            </Button>
          </div>
        </div>

        <!-- CSV Upload Section - only show when NOT connected via API -->
        <template v-if="!props.isStripeConnected">
          <!-- Divider -->
          <div class="relative">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t"></div>
            </div>
            <div class="relative flex justify-center text-xs">
              <span class="bg-card px-2 text-muted-foreground">or upload CSVs</span>
            </div>
          </div>

          <!-- Hidden file input (multiple) -->
          <input
            ref="stripeFileInput"
            type="file"
            accept=".csv"
            multiple
            class="hidden"
            @change="handleFileSelect"
          />

          <!-- Stripe CSV Dropzone - only show when < 3 files -->
          <div
            v-if="stripeFileCount < 3"
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
              Drop your Stripe exports here or <span class="text-primary font-medium">browse</span>
            </p>
            <p class="text-xs text-muted-foreground/60 mt-1">Drop all 3 files at once or one at a time</p>
          </div>
        </div>

        <!-- File slots - only show when at least 1 file uploaded -->
        <div v-if="stripeFileCount > 0" class="space-y-2 border rounded-lg p-4" :class="{ 'mt-4': stripeFileCount < 3 }">
          <!-- Customers slot -->
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2">
              <CheckCircle v-if="stripeCustomersFile" class="h-4 w-4 text-green-500" />
              <div v-else class="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
              <span :class="stripeCustomersFile ? 'text-foreground' : 'text-muted-foreground'">
                {{ stripeCustomersFile?.name || 'customers.csv' }}
              </span>
            </div>
            <button
              v-if="stripeCustomersFile"
              type="button"
              class="p-0.5 rounded hover:bg-muted transition-colors"
              @click="handleClearFile('customers')"
            >
              <X class="h-3 w-3 text-muted-foreground" />
            </button>
          </div>

          <!-- Subscriptions slot -->
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2">
              <CheckCircle v-if="stripeSubscriptionsFile" class="h-4 w-4 text-green-500" />
              <div v-else class="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
              <span :class="stripeSubscriptionsFile ? 'text-foreground' : 'text-muted-foreground'">
                {{ stripeSubscriptionsFile?.name || 'subscriptions.csv' }}
              </span>
            </div>
            <button
              v-if="stripeSubscriptionsFile"
              type="button"
              class="p-0.5 rounded hover:bg-muted transition-colors"
              @click="handleClearFile('subscriptions')"
            >
              <X class="h-3 w-3 text-muted-foreground" />
            </button>
          </div>

          <!-- Invoices slot (optional) -->
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2">
              <CheckCircle v-if="stripeInvoicesFile" class="h-4 w-4 text-green-500" />
              <div v-else class="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
              <span :class="stripeInvoicesFile ? 'text-foreground' : 'text-muted-foreground'">
                {{ stripeInvoicesFile?.name || 'invoices.csv' }}
                <span v-if="!stripeInvoicesFile" class="text-muted-foreground/50">(optional)</span>
              </span>
            </div>
            <button
              v-if="stripeInvoicesFile"
              type="button"
              class="p-0.5 rounded hover:bg-muted transition-colors"
              @click="handleClearFile('invoices')"
            >
              <X class="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        </div>

        <!-- Reconcile button - only show when subscriptions are uploaded -->
        <div v-if="canReconcile && !showReconciliation" class="flex justify-center">
          <Button
            @click="handleReconcile"
            :disabled="isReconciling"
            class="w-full sm:w-auto"
          >
            <Loader2 v-if="isReconciling" class="h-4 w-4 mr-2 animate-spin" />
            {{ isReconciling ? 'Processing...' : 'Reconcile Data' }}
          </Button>
        </div>

        <!-- Reconciliation Report -->
        <div v-if="showReconciliation && reconciliationReport" class="border rounded-lg p-4 space-y-3 bg-muted/30">
          <div class="flex items-center gap-2">
            <CheckCircle class="h-5 w-5 text-green-500" />
            <h3 class="font-medium">Data Reconciliation</h3>
          </div>

          <div class="space-y-2 text-sm">
            <!-- Customers -->
            <div v-if="reconciliationReport.customersTotal > 0" class="flex items-center gap-2">
              <Check class="h-4 w-4 text-green-500" />
              <span>{{ reconciliationReport.customersTotal }} customers found</span>
            </div>

            <!-- Subscriptions matched -->
            <div class="flex items-center gap-2">
              <Check class="h-4 w-4 text-green-500" />
              <span>
                {{ reconciliationReport.subscriptionsMatched }} subscriptions matched
                <span v-if="reconciliationReport.customersTotal > 0" class="text-muted-foreground">
                  ({{ Math.round((reconciliationReport.subscriptionsMatched / reconciliationReport.subscriptionsTotal) * 100) }}%)
                </span>
              </span>
            </div>

            <!-- Orphaned subscriptions warning -->
            <div v-if="reconciliationReport.subscriptionsOrphaned > 0" class="flex items-center gap-2 text-amber-600">
              <AlertTriangle class="h-4 w-4" />
              <span>{{ reconciliationReport.subscriptionsOrphaned }} subscriptions with no matching customer</span>
            </div>

            <!-- Active subscriptions -->
            <div class="flex items-center gap-2">
              <Check class="h-4 w-4 text-green-500" />
              <span>{{ reconciliationReport.activeSubscriptions }} active subscriptions</span>
            </div>

            <!-- Canceled subscriptions (churn data) -->
            <div v-if="reconciliationReport.canceledSubscriptions > 0" class="flex items-center gap-2">
              <Check class="h-4 w-4 text-green-500" />
              <span>{{ reconciliationReport.canceledSubscriptions }} canceled (churn data available)</span>
            </div>

            <!-- Total MRR -->
            <div class="pt-2 border-t mt-2">
              <div class="flex items-center justify-between">
                <span class="font-medium">Calculated MRR:</span>
                <span class="text-lg font-semibold text-green-600">
                  {{ formatCurrency(reconciliationReport.totalMrr) }}
                </span>
              </div>
            </div>

            <!-- Warnings -->
            <div v-if="reconciliationReport.warnings.length > 0" class="pt-2 space-y-1">
              <div
                v-for="warning in reconciliationReport.warnings"
                :key="warning"
                class="text-xs text-amber-600 flex items-center gap-1"
              >
                <AlertTriangle class="h-3 w-3" />
                {{ warning }}
              </div>
            </div>
          </div>

          <!-- Upload button -->
          <div class="pt-3 border-t">
            <Button
              @click="handleUploadAndContinue"
              :disabled="isUploading"
              class="w-full"
            >
              <Loader2 v-if="isUploading" class="h-4 w-4 mr-2 animate-spin" />
              {{ isUploading ? 'Uploading...' : 'Continue to Analysis' }}
              <ArrowRight v-if="!isUploading" class="h-4 w-4 ml-2" />
            </Button>
            <p v-if="uploadError" class="text-xs text-red-500 mt-2 text-center">
              {{ uploadError }}
            </p>
          </div>
        </div>

        <!-- Action links -->
        <div class="flex items-center justify-center gap-4">
          <button
            type="button"
            class="text-xs text-muted-foreground hover:text-foreground"
            :disabled="isLoadingSample"
            @click="emit('useSample')"
          >
            {{ isLoadingSample ? 'Loading...' : 'Use sample data' }}
          </button>
          <span class="text-muted-foreground/30">|</span>
          <button
            type="button"
            class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            @click="showStripeInstructions = !showStripeInstructions"
          >
            <Info class="h-3 w-3" />
            How to export from Stripe
            <ChevronDown
              :class="[
                'h-3 w-3 transition-transform',
                showStripeInstructions ? 'rotate-180' : ''
              ]"
            />
          </button>
        </div>

        <!-- Stripe export instructions (collapsible) -->
        <div v-if="showStripeInstructions" class="bg-muted/50 rounded-lg p-4 text-sm space-y-3">
          <p class="font-medium">Export these CSVs from your Stripe Dashboard:</p>
          <div class="space-y-2">
            <div class="flex items-start gap-2">
              <span class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">1</span>
              <div>
                <p class="font-medium">Customers</p>
                <p class="text-muted-foreground text-xs">Customers &rarr; Export</p>
              </div>
            </div>
            <div class="flex items-start gap-2">
              <span class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">2</span>
              <div>
                <p class="font-medium">Subscriptions</p>
                <p class="text-muted-foreground text-xs">Billing &rarr; Subscriptions &rarr; Export</p>
              </div>
            </div>
            <div class="flex items-start gap-2">
              <span class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">3</span>
              <div>
                <p class="font-medium">Invoices <span class="text-muted-foreground">(optional)</span></p>
                <p class="text-muted-foreground text-xs">Billing &rarr; Invoices &rarr; Export</p>
              </div>
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            We auto-detect file types from the CSV headers. Just drop them all in!
          </p>
        </div>
      </CardContent>
    </Card>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Check, AlertCircle, ArrowRight, ChevronDown } from 'lucide-vue-next'
import { Button, Badge } from '@/components/ui'
import type { ColumnValidation } from '@/api/client'

interface FieldDefinition {
  key: string
  label: string
  required: boolean
  description: string
}

const props = defineProps<{
  dataType: string
  validation: ColumnValidation
  fileName: string
}>()

const emit = defineEmits<{
  (e: 'confirm', mapping: Record<string, string>): void
  (e: 'cancel'): void
}>()

// Field definitions by data type
const fieldDefinitions: Record<string, FieldDefinition[]> = {
  accounts: [
    { key: 'account_id', label: 'Account ID', required: true, description: 'Unique identifier for each customer' },
    { key: 'company_name', label: 'Company Name', required: true, description: 'Customer or company name' },
    { key: 'domain', label: 'Domain', required: false, description: 'Company website (for matching)' },
    { key: 'email', label: 'Email', required: false, description: 'Primary contact email' },
    { key: 'segment', label: 'Segment', required: false, description: 'e.g., SMB, Mid-Market, Enterprise' },
    { key: 'industry', label: 'Industry', required: false, description: 'e.g., Technology, Healthcare' },
    { key: 'plan_tier', label: 'Plan Tier', required: false, description: 'e.g., Starter, Pro, Enterprise' },
    { key: 'arr', label: 'ARR', required: false, description: 'Annual Recurring Revenue' },
  ],
  subscriptions: [
    { key: 'subscription_id', label: 'Subscription ID', required: true, description: 'Unique subscription identifier' },
    { key: 'customer_id', label: 'Customer ID', required: true, description: 'Links to account_id' },
    { key: 'plan_name', label: 'Plan Name', required: false, description: 'Name of the plan' },
    { key: 'amount', label: 'Amount', required: false, description: 'Subscription amount' },
    { key: 'status', label: 'Status', required: false, description: 'active, canceled, past_due' },
    { key: 'start_date', label: 'Start Date', required: false, description: 'When subscription started' },
    { key: 'billing_interval', label: 'Billing Interval', required: false, description: 'monthly, yearly' },
  ],
  invoices: [
    { key: 'invoice_id', label: 'Invoice ID', required: true, description: 'Unique invoice identifier' },
    { key: 'customer_id', label: 'Customer ID', required: true, description: 'Links to account_id' },
    { key: 'amount', label: 'Amount', required: true, description: 'Invoice amount' },
    { key: 'net_amount', label: 'Net Amount', required: false, description: 'Amount after discounts' },
    { key: 'currency', label: 'Currency', required: false, description: 'e.g., USD, EUR' },
    { key: 'status', label: 'Status', required: false, description: 'paid, pending, failed' },
    { key: 'invoice_date', label: 'Invoice Date', required: false, description: 'When invoice was issued' },
  ],
  usage: [
    { key: 'customer_id', label: 'Customer ID', required: true, description: 'Links to account_id' },
    { key: 'metric_key', label: 'Metric Key', required: true, description: 'e.g., api_calls, storage_gb' },
    { key: 'metric_value', label: 'Metric Value', required: true, description: 'Numeric value' },
    { key: 'timestamp', label: 'Timestamp', required: false, description: 'When metric was recorded' },
    { key: 'aggregation_type', label: 'Aggregation', required: false, description: 'sum, avg, max' },
  ],
  users: [
    { key: 'user_id', label: 'User ID', required: true, description: 'Unique user identifier' },
    { key: 'account_id', label: 'Account ID', required: true, description: 'Links to account' },
    { key: 'email', label: 'Email', required: true, description: 'User email address' },
    { key: 'role', label: 'Role', required: false, description: 'User role in account' },
    { key: 'created_at', label: 'Created At', required: false, description: 'When user was added' },
    { key: 'last_active_at', label: 'Last Active', required: false, description: 'Last activity timestamp' },
  ],
}

const fields = computed(() => fieldDefinitions[props.dataType] || [])

// Initialize mapping from auto-matched columns
const mapping = ref<Record<string, string>>({})

watch(() => props.validation, (val) => {
  if (val?.matched_columns) {
    // Invert the mapping: matched_columns is { csvCol: expectedCol }
    // We want { expectedCol: csvCol }
    const inverted: Record<string, string> = {}
    for (const [csvCol, expectedCol] of Object.entries(val.matched_columns)) {
      inverted[expectedCol] = csvCol
    }
    mapping.value = inverted
  }
}, { immediate: true })

// Get available options for a specific field (include current value + unmapped)
function getOptionsForField(fieldKey: string): string[] {
  const currentValue = mapping.value[fieldKey]
  const used = new Set(Object.values(mapping.value))
  const available = props.validation.detected_columns.filter(col => !used.has(col) || col === currentValue)
  return ['', ...available]
}

// Check if all required fields are mapped
const requiredFields = computed(() => fields.value.filter(f => f.required))
const mappedRequiredCount = computed(() =>
  requiredFields.value.filter(f => mapping.value[f.key]).length
)
const allRequiredMapped = computed(() =>
  mappedRequiredCount.value === requiredFields.value.length
)

const totalMappedCount = computed(() =>
  Object.values(mapping.value).filter(v => v).length
)

function updateMapping(fieldKey: string, csvColumn: string) {
  if (csvColumn) {
    mapping.value[fieldKey] = csvColumn
  } else {
    delete mapping.value[fieldKey]
  }
}

function handleConfirm() {
  // Convert to { csvCol: expectedCol } format for backend
  const result: Record<string, string> = {}
  for (const [expectedCol, csvCol] of Object.entries(mapping.value)) {
    if (csvCol) {
      result[csvCol] = expectedCol
    }
  }
  emit('confirm', result)
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-start justify-between">
      <div>
        <h3 class="font-semibold">Map Your Columns</h3>
        <p class="text-sm text-muted-foreground">
          Tell us which columns in <span class="font-mono text-xs bg-muted px-1 rounded">{{ fileName }}</span>
          match our fields
        </p>
      </div>
      <div class="text-right">
        <div class="text-sm">
          <span class="font-medium">{{ totalMappedCount }}</span>
          <span class="text-muted-foreground"> of {{ fields.length }} mapped</span>
        </div>
        <div
          :class="[
            'text-xs',
            allRequiredMapped ? 'text-success' : 'text-destructive'
          ]"
        >
          {{ mappedRequiredCount }}/{{ requiredFields.length }} required
        </div>
      </div>
    </div>

    <!-- Mapping Table -->
    <div class="border rounded-lg overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-muted/50">
          <tr>
            <th class="text-left py-2 px-3 font-medium text-muted-foreground">Our Field</th>
            <th class="text-center py-2 px-3 w-12"></th>
            <th class="text-left py-2 px-3 font-medium text-muted-foreground">Your Column</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="field in fields"
            :key="field.key"
            class="border-t"
          >
            <td class="py-2 px-3">
              <div class="flex items-center gap-2">
                <span class="font-medium">{{ field.label }}</span>
                <Badge
                  v-if="field.required"
                  variant="outline"
                  class="text-[10px] py-0"
                >
                  required
                </Badge>
              </div>
              <p class="text-xs text-muted-foreground">{{ field.description }}</p>
            </td>
            <td class="py-2 px-3 text-center">
              <ArrowRight class="h-4 w-4 text-muted-foreground/40 inline" />
            </td>
            <td class="py-2 px-3">
              <div class="flex items-center gap-2">
                <div class="relative flex-1">
                  <select
                    :value="mapping[field.key] || ''"
                    class="w-full appearance-none rounded-md border bg-background px-3 py-1.5 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    @change="updateMapping(field.key, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">-- not mapped --</option>
                    <option
                      v-for="col in getOptionsForField(field.key)"
                      :key="col"
                      :value="col"
                      v-show="col"
                    >
                      {{ col }}
                    </option>
                  </select>
                  <ChevronDown class="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
                <Check
                  v-if="mapping[field.key]"
                  class="h-4 w-4 text-success shrink-0"
                />
                <AlertCircle
                  v-else-if="field.required"
                  class="h-4 w-4 text-destructive shrink-0"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Unmapped columns hint -->
    <div
      v-if="validation.detected_columns.length > totalMappedCount"
      class="text-xs text-muted-foreground"
    >
      {{ validation.detected_columns.length - totalMappedCount }} columns in your file won't be imported
    </div>

    <!-- Actions -->
    <div class="flex justify-between pt-2">
      <Button variant="outline" size="sm" @click="emit('cancel')">
        Cancel
      </Button>
      <Button
        size="sm"
        :disabled="!allRequiredMapped"
        @click="handleConfirm"
      >
        <Check class="mr-1.5 h-4 w-4" />
        Use This Mapping
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown, ChevronRight, Download, ExternalLink } from 'lucide-vue-next'
import { Button } from '@/components/ui'

interface Guide {
  id: string
  title: string
  icon: string
  url?: string
  urlLabel?: string
  steps: string[]
  columnHints?: Record<string, string>
  tip?: string
}

const props = defineProps<{
  dataType: string
}>()

// Auto-expand Stripe since it's the most common source
const expandedGuide = ref<string | null>('stripe')

function toggleGuide(id: string) {
  expandedGuide.value = expandedGuide.value === id ? null : id
}

const guides: Guide[] = [
  {
    id: 'stripe',
    title: 'Exporting from Stripe',
    icon: '💳',
    url: 'https://dashboard.stripe.com/customers',
    urlLabel: 'Open Stripe Customers',
    steps: [
      'Go to Stripe Dashboard → Customers',
      'Click "Export" in the top right corner',
      'Select "All customers" and CSV format',
      'Download the file and upload here',
    ],
    columnHints: {
      'id': 'account_id',
      'name': 'company_name',
      'email': 'email',
      'description': 'segment (optional)',
    },
    tip: 'Stripe exports include customer emails which work well as unique identifiers.',
  },
  {
    id: 'quickbooks',
    title: 'Exporting from QuickBooks',
    icon: '📗',
    url: 'https://app.qbo.intuit.com/app/customers',
    urlLabel: 'Open QuickBooks Customers',
    steps: [
      'Go to Reports → Customers & Receivables',
      'Select "Customer Contact List" or similar report',
      'Click "Export to Excel" or "Export to CSV"',
      'Upload the exported file here',
    ],
    columnHints: {
      'Customer': 'company_name',
      'Company': 'company_name',
      'Email': 'email',
    },
    tip: 'QuickBooks column names vary by report. Use the column mapper if needed.',
  },
  {
    id: 'spreadsheet',
    title: 'Using a Spreadsheet',
    icon: '📊',
    steps: [
      'Create a new spreadsheet in Excel or Google Sheets',
      'Add column headers in the first row',
      'Enter your customer data (one row per customer)',
      'Export/Download as CSV',
    ],
    tip: 'Download our template for the exact columns needed.',
  },
  {
    id: 'hubspot',
    title: 'Exporting from HubSpot',
    icon: '🟠',
    url: 'https://app.hubspot.com/contacts',
    urlLabel: 'Open HubSpot Contacts',
    steps: [
      'Go to Contacts → Companies',
      'Click "Actions" → "Export"',
      'Select properties to export (Name, Domain, Annual Revenue)',
      'Choose CSV format and download',
    ],
    columnHints: {
      'Company name': 'company_name',
      'Company domain name': 'domain',
      'Annual revenue': 'arr',
    },
  },
  {
    id: 'salesforce',
    title: 'Exporting from Salesforce',
    icon: '☁️',
    url: 'https://login.salesforce.com',
    urlLabel: 'Open Salesforce',
    steps: [
      'Go to Reports → Create New Report',
      'Select "Accounts" as the report type',
      'Add fields: Account Name, Website, Annual Revenue',
      'Run report and click "Export" → CSV',
    ],
    columnHints: {
      'Account Name': 'company_name',
      'Website': 'domain',
      'Annual Revenue': 'arr',
    },
  },
]

// Column requirements by data type — matches server Zod schemas in routes/data.ts
const columnInfo: Record<string, { required: string[]; optional: string[]; descriptions: Record<string, string> }> = {
  costs: {
    required: ['month', 'cost'],
    optional: ['provider', 'customer_id'],
    descriptions: {
      month: 'YYYY-MM format, e.g. 2024-12',
      cost: 'Total cost in dollars for the month',
      provider: 'AI provider name, e.g. openai, anthropic',
      customer_id: 'Customer this cost belongs to',
    },
  },
  usage: {
    required: ['month'],
    optional: ['customer_id', 'metric', 'value', 'limit'],
    descriptions: {
      month: 'YYYY-MM format, e.g. 2024-12',
      customer_id: 'Customer this usage belongs to',
      metric: 'Metric name, e.g. api_calls, tokens',
      value: 'Numeric usage value',
      limit: 'Usage limit or cap',
    },
  },
  revenue: {
    required: ['customer_id', 'name'],
    optional: ['email', 'segment', 'plan_id', 'plan_name', 'price_amount'],
    descriptions: {
      customer_id: 'Unique customer identifier',
      name: 'Customer or company name',
      email: 'Primary contact email',
      segment: 'e.g., SMB, Mid-Market, Enterprise',
      plan_id: 'Plan identifier',
      plan_name: 'Display name of the plan',
      price_amount: 'Monthly price in dollars',
    },
  },
}

const currentColumnInfo = columnInfo[props.dataType] ?? columnInfo.costs ?? {
  required: [],
  optional: [],
  descriptions: {},
}

const emit = defineEmits<{ downloadTemplate: [dataType: string] }>()

function handleDownloadTemplate() {
  emit('downloadTemplate', props.dataType)
}
</script>

<template>
  <div class="space-y-3">
    <div class="text-sm font-medium text-muted-foreground">Import Help</div>

    <!-- Source guides -->
    <div class="space-y-1">
      <div
        v-for="guide in guides"
        :key="guide.id"
        class="border rounded-lg overflow-hidden"
      >
        <button
          class="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50 transition-colors"
          @click="toggleGuide(guide.id)"
        >
          <div class="flex items-center gap-2">
            <span>{{ guide.icon }}</span>
            <span class="text-sm font-medium">{{ guide.title }}</span>
          </div>
          <component
            :is="expandedGuide === guide.id ? ChevronDown : ChevronRight"
            class="h-4 w-4 text-muted-foreground"
          />
        </button>

        <div
          v-if="expandedGuide === guide.id"
          class="border-t bg-muted/30 p-3 space-y-3"
        >
          <!-- Direct link button - prominent at top -->
          <a
            v-if="guide.url"
            :href="guide.url"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center justify-center gap-2 w-full px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            {{ guide.urlLabel }}
            <ExternalLink class="h-3.5 w-3.5" />
          </a>

          <ol class="text-sm space-y-1.5 list-decimal list-inside text-muted-foreground">
            <li v-for="(step, i) in guide.steps" :key="i">
              {{ step }}
            </li>
          </ol>

          <div v-if="guide.columnHints" class="text-xs">
            <div class="font-medium text-foreground mb-1">Column mapping:</div>
            <div class="space-y-0.5 text-muted-foreground">
              <div v-for="(to, from) in guide.columnHints" :key="from">
                <span class="font-mono bg-muted px-1 rounded">{{ from }}</span>
                →
                <span class="font-mono">{{ to }}</span>
              </div>
            </div>
          </div>

          <div
            v-if="guide.tip"
            class="text-xs text-muted-foreground bg-primary/5 p-2 rounded"
          >
            💡 {{ guide.tip }}
          </div>
        </div>
      </div>
    </div>

    <!-- Column requirements -->
    <div class="border rounded-lg overflow-hidden">
      <button
        class="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50 transition-colors"
        @click="toggleGuide('columns')"
      >
        <div class="flex items-center gap-2">
          <span>📋</span>
          <span class="text-sm font-medium">What columns do I need?</span>
        </div>
        <component
          :is="expandedGuide === 'columns' ? ChevronDown : ChevronRight"
          class="h-4 w-4 text-muted-foreground"
        />
      </button>

      <div
        v-if="expandedGuide === 'columns'"
        class="border-t bg-muted/30 p-3 space-y-3"
      >
        <div>
          <div class="text-xs font-medium text-foreground mb-1">Required:</div>
          <div class="space-y-1">
            <div
              v-for="col in currentColumnInfo.required"
              :key="col"
              class="text-xs"
            >
              <span class="font-mono bg-destructive/10 text-destructive px-1 rounded">{{ col }}</span>
              <span class="text-muted-foreground ml-1">{{ currentColumnInfo.descriptions[col] }}</span>
            </div>
          </div>
        </div>

        <div>
          <div class="text-xs font-medium text-foreground mb-1">Optional (recommended):</div>
          <div class="space-y-1">
            <div
              v-for="col in currentColumnInfo.optional"
              :key="col"
              class="text-xs"
            >
              <span class="font-mono bg-muted px-1 rounded">{{ col }}</span>
              <span class="text-muted-foreground ml-1">{{ currentColumnInfo.descriptions[col] }}</span>
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          class="w-full"
          @click="handleDownloadTemplate"
        >
          <Download class="h-3 w-3 mr-1.5" />
          Download {{ dataType }} template
        </Button>
      </div>
    </div>
  </div>
</template>

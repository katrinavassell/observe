<script setup lang="ts">
/**
 * ComingSoonSection - Upcoming integrations and request form.
 *
 * Handles:
 * - Display of upcoming integrations (Salesforce, HubSpot, QuickBooks)
 * - "Notify me" functionality
 * - Custom integration request form
 */

import { ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  Clock,
  Bell,
  Check,
  ArrowRight,
} from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Input } from '@/components/ui'

const API_BASE = '/api'

/** Integrations that user has requested notifications for */
const requestedIntegrations = ref<Set<string>>(new Set())

/** Request form state */
const showRequestForm = ref(false)
const requestFormData = ref({ integration: '' })
const isSubmittingRequest = ref(false)

/**
 * Request notification when an integration becomes available.
 */
async function handleNotifyMe(integration: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/integration-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ integration_name: integration, request_type: 'notify' }),
    })
    if (!response.ok) throw new Error('Failed')

    requestedIntegrations.value.add(integration)
    toast.success('Got it!', {
      description: `We'll let you know when ${integration} is ready.`,
    })
  } catch {
    toast.error('Failed to save request')
  }
}

/**
 * Submit a custom integration request.
 */
async function submitRequestForm(): Promise<void> {
  if (!requestFormData.value.integration.trim()) {
    toast.error('Please enter which integration you need')
    return
  }

  isSubmittingRequest.value = true
  try {
    const response = await fetch(`${API_BASE}/integration-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        integration_name: requestFormData.value.integration.trim(),
        request_type: 'request',
      }),
    })
    if (!response.ok) throw new Error('Failed')

    requestedIntegrations.value.add('custom')
    showRequestForm.value = false
    requestFormData.value = { integration: '' }
    toast.success('Request submitted!', {
      description: 'We\'ll reach out to discuss your needs.',
    })
  } catch {
    toast.error('Failed to save request')
  } finally {
    isSubmittingRequest.value = false
  }
}

/** List of coming soon integrations with their branding */
const comingSoonIntegrations = [
  { id: 'Salesforce', name: 'Salesforce', color: '#00A1E0' },
  { id: 'HubSpot', name: 'HubSpot', color: '#FF7A59' },
  { id: 'QuickBooks', name: 'QuickBooks', color: '#2CA01C' },
]
</script>

<template>
  <section>
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-base flex items-center gap-2">
          <Clock class="h-4 w-4" />
          Coming Soon
        </CardTitle>
        <CardDescription>Integrations we're working on</CardDescription>
      </CardHeader>
      <CardContent class="p-5 pt-0 space-y-3">
        <!-- Integration list -->
        <div
          v-for="integration in comingSoonIntegrations"
          :key="integration.id"
          class="flex items-center justify-between py-1"
        >
          <div class="flex items-center gap-3">
            <div
              class="h-8 w-8 rounded flex items-center justify-center"
              :style="{ backgroundColor: `${integration.color}10` }"
            >
              <span
                class="text-xs font-bold"
                :style="{ color: integration.color }"
              >
                {{ integration.name.substring(0, 2).toUpperCase() }}
              </span>
            </div>
            <span class="font-medium">{{ integration.name }}</span>
          </div>
          <Button
            v-if="!requestedIntegrations.has(integration.id)"
            variant="ghost"
            size="sm"
            @click="handleNotifyMe(integration.id)"
          >
            <Bell class="h-3.5 w-3.5 mr-1.5" />
            Notify me
          </Button>
          <span v-else class="text-xs text-green-600 flex items-center gap-1">
            <Check class="h-3.5 w-3.5" />
            On the list
          </span>
        </div>

        <!-- Request integration -->
        <div class="pt-3 border-t">
          <button
            v-if="!requestedIntegrations.has('custom')"
            class="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 group"
            @click="showRequestForm = true"
          >
            Need something else?
            <span class="text-primary font-medium group-hover:underline flex items-center gap-1">
              Request integration
              <ArrowRight class="h-3.5 w-3.5" />
            </span>
          </button>
          <span v-else class="text-sm text-green-600 flex items-center gap-1">
            <Check class="h-4 w-4" />
            Request submitted - we'll be in touch!
          </span>
        </div>

        <!-- Request Form (inline) -->
        <div v-if="showRequestForm" class="pt-3 border-t space-y-3">
          <p class="text-sm font-medium">What integration do you need?</p>
          <Input
            v-model="requestFormData.integration"
            type="text"
            placeholder="e.g., Xero, Chargebee, Recurly..."
          />
          <div class="flex gap-2">
            <Button
              size="sm"
              :disabled="isSubmittingRequest"
              @click="submitRequestForm"
            >
              {{ isSubmittingRequest ? 'Submitting...' : 'Submit Request' }}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              @click="showRequestForm = false"
            >
              Cancel
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </section>
</template>

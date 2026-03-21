const TANSO_API_KEY = process.env.TANSO_API_KEY || ''
const TANSO_BASE_URL = (process.env.TANSO_MCP_URL || 'https://api.tansohq.com/mcp').replace('/mcp', '')

// =============================================================================
// REST API client — used for all runtime operations (fast, no MCP overhead)
// =============================================================================

async function apiGet(path: string): Promise<any> {
  const res = await fetch(`${TANSO_BASE_URL}${path}`, {
    headers: { 'Authorization': `Bearer ${TANSO_API_KEY}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Tanso API error (${res.status}): ${text.substring(0, 200)}`)
  }
  const data = await res.json()
  return data.data ?? data
}

async function apiPost(path: string, body?: any): Promise<any> {
  const res = await fetch(`${TANSO_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TANSO_API_KEY}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Tanso API error (${res.status}): ${text.substring(0, 200)}`)
  }
  const data = await res.json()
  return data.data ?? data
}

async function apiDelete(path: string): Promise<any> {
  const res = await fetch(`${TANSO_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${TANSO_API_KEY}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Tanso API error (${res.status}): ${text.substring(0, 200)}`)
  }
  const text = await res.text()
  if (!text) return {}
  const data = JSON.parse(text)
  return data.data ?? data
}

// =============================================================================
// Plans & Features (catalog)
// =============================================================================

export async function tansoListPlans() {
  return apiGet('/api/v1/client/plans')
}

export async function tansoListFeatures() {
  return apiGet('/api/v1/client/features')
}

// =============================================================================
// Customers
// =============================================================================

export async function tansoGetCustomer(customerReferenceId: string) {
  return apiGet(`/api/v1/client/customers/${encodeURIComponent(customerReferenceId)}`)
}

export async function tansoCreateCustomer(externalClientCustomerId: string, email: string, firstName?: string) {
  return apiPost('/api/v1/client/customers', {
    externalClientCustomerId,
    email,
    ...(firstName ? { firstName } : {}),
  })
}

// =============================================================================
// Entitlements
// =============================================================================

export async function tansoCheckEntitlement(customerReferenceId: string, featureKey: string) {
  return apiGet(`/api/v1/client/entitlements/${encodeURIComponent(customerReferenceId)}/${encodeURIComponent(featureKey)}`)
}

export async function tansoListCustomerEntitlements(customerReferenceId: string) {
  return apiGet(`/api/v1/client/entitlements/${encodeURIComponent(customerReferenceId)}`)
}

// =============================================================================
// Subscriptions
// =============================================================================

export async function tansoCreateSubscription(customerReferenceId: string, planId: string, gracePeriod = 7) {
  return apiPost('/api/v1/client/subscriptions', {
    customerReferenceId,
    planId,
    gracePeriod,
  })
}

export async function tansoCancelSubscription(subscriptionId: string, cancelMode: 'IMMEDIATELY' | 'END_OF_PERIOD' = 'IMMEDIATELY') {
  return apiPost(`/api/v1/client/subscriptions/cancellation/${encodeURIComponent(subscriptionId)}?cancelMode=${cancelMode}`)
}

export async function tansoCancelScheduledCancellation(subscriptionId: string) {
  return apiDelete(`/api/v1/client/subscriptions/cancellation/${encodeURIComponent(subscriptionId)}/scheduled`)
}

export async function tansoCancelScheduledPlanChanges(subscriptionId: string) {
  return apiDelete(`/api/v1/client/subscriptions/${encodeURIComponent(subscriptionId)}/plan-change/scheduled`)
}

export async function tansoChangeSubscriptionPlan(subscriptionId: string, changeToPlanId: string, changeType: 'UPGRADE' | 'DOWNGRADE') {
  return apiPost(`/api/v1/client/subscriptions/${encodeURIComponent(subscriptionId)}/plan-change`, {
    changeToPlanId,
    changeType,
  })
}

// Combined entitlement check + usage tracking (single call)
export async function tansoCheckEntitlementAndTrack(params: {
  customerReferenceId: string
  featureKey: string
  track?: { eventName?: string; usageUnits?: number; costAmount?: number }
  context?: { idempotencyKey?: string; flowId?: string }
}) {
  return apiPost('/api/v1/client/entitlements', params)
}

// Batch entitlement check
export async function tansoCheckMultipleEntitlements(
  customerReferenceId: string,
  featureKeys: string[]
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {}
  await Promise.all(
    featureKeys.map(async (key) => {
      try {
        const result = await tansoCheckEntitlement(customerReferenceId, key)
        results[key] = result?.allowed !== false
      } catch (_) {
        results[key] = true // fail open
      }
    })
  )
  return results
}

// =============================================================================
// Events
// =============================================================================

export async function tansoIngestEvent(params: {
  eventIdempotencyKey: string
  eventName: string
  occurredAt: string
  customerReferenceId: string
  featureKey: string
  usageUnits?: number
}) {
  return apiPost('/api/v1/client/events', params)
}

// =============================================================================
// Billing & Invoices
// =============================================================================

export async function tansoListCustomerInvoices(customerReferenceId: string) {
  return apiGet(`/api/v1/client/billing/invoices/${encodeURIComponent(customerReferenceId)}`)
}

export async function tansoMarkInvoicePaid(invoiceId: string) {
  return apiPost(`/api/v1/client/billing/invoices/${encodeURIComponent(invoiceId)}/mark-paid`)
}

export async function tansoCreateCheckoutSession(invoiceId: string): Promise<{ url: string }> {
  return apiPost(`/api/v1/client/billing/invoices/${encodeURIComponent(invoiceId)}/stripe/checkout`)
}

// =============================================================================
// Credits
// =============================================================================

export async function tansoGetCreditPools(customerReferenceId: string) {
  return apiGet(`/api/v1/client/credits/${encodeURIComponent(customerReferenceId)}/pools`)
}

// =============================================================================

export function isTansoConfigured(): boolean {
  return !!TANSO_API_KEY
}

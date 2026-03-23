const TANSO_API_KEY = process.env.TANSO_API_KEY || ''
const TANSO_BASE_URL = (process.env.TANSO_MCP_URL || 'https://api.tansohq.com/mcp').replace('/mcp', '')

// =============================================================================
// Types
// =============================================================================

export interface TansoPlan {
  id: string
  name: string
  description?: string
  status?: string
}

export interface TansoFeature {
  id: string
  key: string
  name: string
  type?: string
}

export interface TansoCustomer {
  id: string
  externalClientCustomerId: string
  email: string
  firstName?: string
}

export interface TansoEntitlement {
  featureKey: string
  allowed: boolean
  limit?: number
  usage?: number
}

export interface TansoSubscription {
  id: string
  customerId: string
  planId: string
  status: string
  cancelMode?: string
}

export interface TansoInvoice {
  id: string
  customerId: string
  amount: number
  status: string
  dueDate?: string
}

export interface TansoCheckoutSession {
  url: string
}

export interface TansoCreditPool {
  id: string
  balance: number
  featureKey: string
}

export interface TansoFeatureRule {
  planId: string
  featureId: string
  ruleType: string
  limit?: number
}

// =============================================================================
// REST API client — used for all runtime operations (fast, no MCP overhead)
// =============================================================================

async function apiGet<T = unknown>(path: string): Promise<T> {
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

async function apiPost<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T> {
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

async function apiDelete<T = unknown>(path: string): Promise<T> {
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

export async function tansoListPlans(): Promise<TansoPlan[]> {
  return apiGet<TansoPlan[]>('/api/v1/client/plans')
}

export async function tansoListFeatures(): Promise<TansoFeature[]> {
  return apiGet<TansoFeature[]>('/api/v1/client/features')
}

// =============================================================================
// Customers
// =============================================================================

export async function tansoGetCustomer(customerReferenceId: string): Promise<TansoCustomer> {
  return apiGet<TansoCustomer>(`/api/v1/client/customers/${encodeURIComponent(customerReferenceId)}`)
}

export async function tansoCreateCustomer(externalClientCustomerId: string, email: string, firstName?: string): Promise<TansoCustomer> {
  return apiPost<TansoCustomer>('/api/v1/client/customers', {
    externalClientCustomerId,
    email,
    ...(firstName ? { firstName } : {}),
  })
}

// =============================================================================
// Entitlements
// =============================================================================

export async function tansoCheckEntitlement(customerReferenceId: string, featureKey: string): Promise<TansoEntitlement> {
  return apiGet<TansoEntitlement>(`/api/v1/client/entitlements/${encodeURIComponent(customerReferenceId)}/${encodeURIComponent(featureKey)}`)
}

export async function tansoListCustomerEntitlements(customerReferenceId: string): Promise<TansoEntitlement[]> {
  return apiGet<TansoEntitlement[]>(`/api/v1/client/entitlements/${encodeURIComponent(customerReferenceId)}`)
}

// =============================================================================
// Subscriptions
// =============================================================================

export async function tansoCreateSubscription(customerReferenceId: string, planId: string, gracePeriod = 7): Promise<TansoSubscription> {
  return apiPost<TansoSubscription>('/api/v1/client/subscriptions', {
    customerReferenceId,
    planId,
    gracePeriod,
  })
}

export async function tansoCancelSubscription(subscriptionId: string, cancelMode: 'IMMEDIATELY' | 'END_OF_PERIOD' = 'IMMEDIATELY'): Promise<TansoSubscription> {
  return apiPost<TansoSubscription>(`/api/v1/client/subscriptions/cancellation/${encodeURIComponent(subscriptionId)}?cancelMode=${cancelMode}`)
}

export async function tansoCancelScheduledCancellation(subscriptionId: string) {
  return apiDelete(`/api/v1/client/subscriptions/cancellation/${encodeURIComponent(subscriptionId)}/scheduled`)
}

export async function tansoCancelScheduledPlanChanges(subscriptionId: string) {
  return apiDelete(`/api/v1/client/subscriptions/${encodeURIComponent(subscriptionId)}/plan-change/scheduled`)
}

export async function tansoChangeSubscriptionPlan(subscriptionId: string, changeToPlanId: string, changeType: 'UPGRADE' | 'DOWNGRADE'): Promise<TansoSubscription> {
  return apiPost<TansoSubscription>(`/api/v1/client/subscriptions/${encodeURIComponent(subscriptionId)}/plan-change`, {
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
}): Promise<TansoEntitlement> {
  return apiPost<TansoEntitlement>('/api/v1/client/entitlements', params as unknown as Record<string, unknown>)
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
}): Promise<void> {
  await apiPost('/api/v1/client/events', params as unknown as Record<string, unknown>)
}

// =============================================================================
// Billing & Invoices
// =============================================================================

export async function tansoListCustomerInvoices(customerReferenceId: string): Promise<TansoInvoice[]> {
  return apiGet<TansoInvoice[]>(`/api/v1/client/billing/invoices/${encodeURIComponent(customerReferenceId)}`)
}

export async function tansoMarkInvoicePaid(invoiceId: string): Promise<TansoInvoice> {
  return apiPost<TansoInvoice>(`/api/v1/client/billing/invoices/${encodeURIComponent(invoiceId)}/mark-paid`)
}

export async function tansoCreateCheckoutSession(invoiceId: string): Promise<TansoCheckoutSession> {
  return apiPost<TansoCheckoutSession>(`/api/v1/client/billing/invoices/${encodeURIComponent(invoiceId)}/stripe/checkout`)
}

// =============================================================================
// Credits
// =============================================================================

export async function tansoGetCreditPools(customerReferenceId: string): Promise<TansoCreditPool[]> {
  return apiGet<TansoCreditPool[]>(`/api/v1/client/credits/${encodeURIComponent(customerReferenceId)}/pools`)
}

// =============================================================================
// Admin — Plan Feature Rules
// =============================================================================

export async function tansoAdminGetFeatureRule(planId: string, featureId: string): Promise<TansoFeatureRule> {
  return apiGet<TansoFeatureRule>(`/api/v1/admin/plans/${encodeURIComponent(planId)}/features/${encodeURIComponent(featureId)}/rule`)
}

// =============================================================================

export function isTansoConfigured(): boolean {
  return !!TANSO_API_KEY
}

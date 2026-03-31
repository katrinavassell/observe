const BILLING_API_KEY =
  process.env.BILLING_API_KEY || process.env.TANSO_API_KEY || "";
const BILLING_BASE_URL = (
  process.env.TANSO_MCP_URL || "https://api.tansohq.com/mcp"
).replace("/mcp", "");

// =============================================================================
// Types
// =============================================================================

export interface BillingPlan {
  id: string;
  name: string;
  description?: string;
  status?: string;
}

export interface BillingFeature {
  id: string;
  key: string;
  name: string;
  type?: string;
}

export interface BillingCustomer {
  id: string;
  externalClientCustomerId: string;
  email: string;
  firstName?: string;
}

export interface BillingEntitlement {
  featureKey: string;
  allowed: boolean;
  limit?: number;
  usage?: number;
}

export interface BillingSubscription {
  id: string;
  customerId: string;
  planId: string;
  status: string;
  cancelMode?: string;
}

export interface BillingInvoice {
  id: string;
  customerId: string;
  amount: number;
  status: string;
  dueDate?: string;
}

export interface BillingCheckoutSession {
  url: string;
}

export interface BillingCreditPool {
  id: string;
  balance: number;
  featureKey: string;
}

export interface BillingFeatureRule {
  planId: string;
  featureId: string;
  ruleType: string;
  limit?: number;
}

// =============================================================================
// REST API client — used for all runtime operations (fast, no MCP overhead)
// =============================================================================

async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BILLING_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${BILLING_API_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Billing API error (${res.status}): ${text.substring(0, 200)}`,
    );
  }
  const data = await res.json();
  return data.data ?? data;
}

async function apiPost<T = unknown>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${BILLING_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BILLING_API_KEY}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Billing API error (${res.status}): ${text.substring(0, 200)}`,
    );
  }
  const data = await res.json();
  return data.data ?? data;
}

async function apiDelete<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BILLING_BASE_URL}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${BILLING_API_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Billing API error (${res.status}): ${text.substring(0, 200)}`,
    );
  }
  const text = await res.text();
  if (!text) return {};
  const data = JSON.parse(text);
  return data.data ?? data;
}

// =============================================================================
// Plans & Features (catalog)
// =============================================================================

export async function billingListPlans(): Promise<BillingPlan[]> {
  return apiGet<BillingPlan[]>("/api/v1/client/plans");
}

export async function billingListFeatures(): Promise<BillingFeature[]> {
  return apiGet<BillingFeature[]>("/api/v1/client/features");
}

// =============================================================================
// Customers
// =============================================================================

export async function billingGetCustomer(
  customerReferenceId: string,
): Promise<BillingCustomer> {
  return apiGet<BillingCustomer>(
    `/api/v1/client/customers/${encodeURIComponent(customerReferenceId)}`,
  );
}

export async function billingCreateCustomer(
  customerReferenceId: string,
  email: string,
  firstName?: string,
): Promise<BillingCustomer> {
  return apiPost<BillingCustomer>("/api/v1/client/customers", {
    customerReferenceId,
    email,
    ...(firstName ? { firstName } : {}),
  });
}

// =============================================================================
// Entitlements
// =============================================================================

export async function billingCheckEntitlement(
  customerReferenceId: string,
  featureKey: string,
): Promise<BillingEntitlement> {
  return apiGet<BillingEntitlement>(
    `/api/v1/client/entitlements/${encodeURIComponent(customerReferenceId)}/${encodeURIComponent(featureKey)}`,
  );
}

export async function billingListCustomerEntitlements(
  customerReferenceId: string,
): Promise<BillingEntitlement[]> {
  return apiGet<BillingEntitlement[]>(
    `/api/v1/client/entitlements/${encodeURIComponent(customerReferenceId)}`,
  );
}

// =============================================================================
// Subscriptions
// =============================================================================

export async function billingCreateSubscription(
  customerReferenceId: string,
  planId: string,
  gracePeriod = 7,
): Promise<BillingSubscription> {
  return apiPost<BillingSubscription>("/api/v1/client/subscriptions", {
    customerReferenceId,
    planId,
    gracePeriod,
  });
}

export async function billingCancelSubscription(
  subscriptionId: string,
  cancelMode: "IMMEDIATE" | "END_OF_PERIOD" = "IMMEDIATE",
): Promise<BillingSubscription> {
  return apiPost<BillingSubscription>(
    `/api/v1/client/subscriptions/cancellation/${encodeURIComponent(subscriptionId)}?cancelMode=${cancelMode}`,
  );
}

export async function billingCancelScheduledCancellation(
  subscriptionId: string,
) {
  return apiDelete(
    `/api/v1/client/subscriptions/cancellation/${encodeURIComponent(subscriptionId)}/scheduled`,
  );
}

export async function billingCancelScheduledPlanChanges(
  subscriptionId: string,
) {
  return apiDelete(
    `/api/v1/client/subscriptions/${encodeURIComponent(subscriptionId)}/plan-change/scheduled`,
  );
}

export async function billingChangeSubscriptionPlan(
  subscriptionId: string,
  changeToPlanId: string,
  changeType: "UPGRADE" | "DOWNGRADE",
): Promise<BillingSubscription> {
  return apiPost<BillingSubscription>(
    `/api/v1/client/subscriptions/${encodeURIComponent(subscriptionId)}/plan-change`,
    {
      changeToPlanId,
      changeType,
    },
  );
}

// Combined entitlement check + usage tracking (single call)
export async function billingCheckEntitlementAndTrack(params: {
  customerReferenceId: string;
  featureKey: string;
  track?: { eventName?: string; usageUnits?: number; costAmount?: number };
  context?: { idempotencyKey?: string; flowId?: string };
}): Promise<BillingEntitlement> {
  return apiPost<BillingEntitlement>(
    "/api/v1/client/entitlements",
    params as unknown as Record<string, unknown>,
  );
}

// Batch entitlement check
export async function billingCheckMultipleEntitlements(
  customerReferenceId: string,
  featureKeys: string[],
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  await Promise.all(
    featureKeys.map(async (key) => {
      try {
        const result = await billingCheckEntitlement(customerReferenceId, key);
        results[key] = result?.allowed !== false;
      } catch (err) {
        console.error(
          `Entitlement check failed for ${customerReferenceId}/${key}:`,
          err instanceof Error ? err.message : err,
        );
        results[key] = false; // fail closed — deny on error
      }
    }),
  );
  return results;
}

// =============================================================================
// Events
// =============================================================================

export async function billingIngestEvent(params: {
  eventIdempotencyKey: string;
  eventName: string;
  occurredAt: string;
  customerReferenceId: string;
  featureKey: string;
  usageUnits?: number;
}): Promise<void> {
  await apiPost(
    "/api/v1/client/events",
    params as unknown as Record<string, unknown>,
  );
}

// =============================================================================
// Billing & Invoices
// =============================================================================

export async function billingListCustomerInvoices(
  customerReferenceId: string,
): Promise<BillingInvoice[]> {
  return apiGet<BillingInvoice[]>(
    `/api/v1/client/billing/invoices/${encodeURIComponent(customerReferenceId)}`,
  );
}

export async function billingMarkInvoicePaid(
  invoiceId: string,
): Promise<BillingInvoice> {
  return apiPost<BillingInvoice>(
    `/api/v1/client/billing/invoices/${encodeURIComponent(invoiceId)}/mark-paid`,
  );
}

// Checkout URL is now returned directly in the subscription creation response

// =============================================================================
// Credits
// =============================================================================

export async function billingGetCreditPools(
  customerReferenceId: string,
): Promise<BillingCreditPool[]> {
  return apiGet<BillingCreditPool[]>(
    `/api/v1/client/credits/${encodeURIComponent(customerReferenceId)}/pools`,
  );
}

// =============================================================================
// Admin — Plan Feature Rules
// =============================================================================

export async function billingAdminGetFeatureRule(
  planId: string,
  featureId: string,
): Promise<BillingFeatureRule> {
  return apiGet<BillingFeatureRule>(
    `/api/v1/admin/plans/${encodeURIComponent(planId)}/features/${encodeURIComponent(featureId)}/rule`,
  );
}

// =============================================================================

export function isBillingConfigured(): boolean {
  return !!BILLING_API_KEY;
}

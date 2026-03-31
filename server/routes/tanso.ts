import { Router, Response } from "express";
import type { Pool } from "pg";
import crypto from "crypto";
import { type AuthRequest } from "./auth.js";
import { getUncachableStripeClient } from "../stripe-client.js";
import {
  billingListPlans,
  billingListFeatures,
  billingGetCustomer,
  billingCreateCustomer,
  billingCheckEntitlement,
  billingListCustomerEntitlements,
  billingIngestEvent,
  billingCreateSubscription,
  billingChangeSubscriptionPlan,
  billingCancelSubscription,
  billingCancelScheduledCancellation,
  billingCancelScheduledPlanChanges,
  billingListCustomerInvoices,
  billingMarkInvoicePaid,
  billingAdminGetFeatureRule,
  isBillingConfigured,
} from "../tanso-client.js";

// ─── Shared helpers ────────────────────────────────────────────────────────

function flattenEntitlements(raw: any): any[] {
  if (Array.isArray(raw)) {
    // Could be [{ subscriptionId, entitlements: [...] }] or already flat [{ featureKey, allowed }]
    if (raw.length > 0 && raw[0]?.entitlements) {
      return raw.flatMap((sub: any) => sub.entitlements || []);
    }
    return raw;
  }
  const items = raw?.items || raw?.entitlements || [];
  if (Array.isArray(items) && items.length > 0 && items[0]?.entitlements) {
    return items.flatMap((sub: any) => sub.entitlements || []);
  }
  return items;
}

async function autoSubscribeToFreePlan(
  customerReferenceId: string,
): Promise<void> {
  try {
    // Check if already subscribed
    const customer = await billingGetCustomer(customerReferenceId);
    if (customer?.subscriptions?.some((s: any) => s.isActive)) return;

    // Find the free plan
    const plans = await billingListPlans();
    const planItems = Array.isArray(plans)
      ? plans
      : (plans?.items ?? plans?.plans ?? []);
    const freePlan = planItems.find(
      (p: any) => (p.plan?.key ?? p.key) === "free",
    );
    const freePlanId = freePlan?.plan?.id ?? freePlan?.id;
    if (!freePlanId) {
      console.warn("No free plan found for auto-subscription");
      return;
    }

    const result = await billingCreateSubscription(
      customerReferenceId,
      freePlanId,
    );
    // Mark the $0 invoice as paid to activate the subscription
    let invoiceId = result?.invoice?.id;
    if (!invoiceId) {
      // Invoice may not be nested in the response -- fetch separately
      const invoices = await billingListCustomerInvoices(customerReferenceId);
      const items = Array.isArray(invoices)
        ? invoices
        : ((invoices as any)?.items ?? []);
      const unpaid = items.find((inv: any) => inv.status !== "PAID");
      invoiceId = unpaid?.id;
    }
    if (invoiceId) {
      await billingMarkInvoicePaid(invoiceId);
    }
    console.log("Auto-subscribed", customerReferenceId, "to free plan");
  } catch (err) {
    console.error(
      "Auto-subscribe to free plan failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

async function getOrCreateBillingCustomer(
  pool: Pool,
  visitorId: string,
  email?: string,
): Promise<string | null> {
  if (!isBillingConfigured()) return null;
  try {
    const existing = await pool.query(
      "SELECT tanso_customer_id FROM tanso_customers WHERE visitor_id = $1",
      [visitorId],
    );
    if (existing.rows[0]?.tanso_customer_id)
      return existing.rows[0].tanso_customer_id;

    try {
      const customer = await billingGetCustomer(visitorId);
      const customerId =
        customer?.id ||
        customer?.subscriptions?.[0]?.customer?.id ||
        customer?.externalClientCustomerId;
      if (customerId) {
        await pool.query(
          "INSERT INTO tanso_customers (visitor_id, tanso_customer_id, email) VALUES ($1, $2, $3) ON CONFLICT (visitor_id) DO UPDATE SET tanso_customer_id = $2",
          [visitorId, customerId, email || customer?.email || null],
        );
        // Auto-subscribe if no active subscription
        if (!customer?.subscriptions?.some((s: any) => s.isActive)) {
          await autoSubscribeToFreePlan(visitorId);
        }
        return customerId;
      }
    } catch (fetchErr) {
      console.warn(
        "Billing customer fetch failed for",
        visitorId,
        fetchErr instanceof Error ? fetchErr.message : fetchErr,
      );
    }

    if (!email) {
      console.error(
        "Billing customer creation skipped: no email provided for visitor",
        visitorId,
      );
      return null;
    }
    try {
      const created = await billingCreateCustomer(visitorId, email, undefined);
      const billingId = created?.id || created?.customer?.id || null;
      if (billingId) {
        await pool.query(
          "INSERT INTO tanso_customers (visitor_id, tanso_customer_id, email) VALUES ($1, $2, $3) ON CONFLICT (visitor_id) DO UPDATE SET tanso_customer_id = $2",
          [visitorId, billingId, email || null],
        );
        // New customer — auto-subscribe to free plan
        await autoSubscribeToFreePlan(visitorId);
      }
      return billingId;
    } catch (createErr: any) {
      // 409 = customer already exists in billing provider — retry fetch
      if (createErr?.message?.includes("409")) {
        const retryCustomer = await billingGetCustomer(visitorId);
        const retryId =
          retryCustomer?.id ||
          retryCustomer?.subscriptions?.[0]?.customer?.id ||
          retryCustomer?.externalClientCustomerId;
        if (retryId) {
          await pool.query(
            "INSERT INTO tanso_customers (visitor_id, tanso_customer_id, email) VALUES ($1, $2, $3) ON CONFLICT (visitor_id) DO UPDATE SET tanso_customer_id = $2, email = $3",
            [visitorId, retryId, email],
          );
          await autoSubscribeToFreePlan(visitorId);
          return retryId;
        }
      }
      throw createErr;
    }
  } catch (err) {
    console.error("Billing customer lookup/create error:", err);
    return null;
  }
}

async function verifySubscriptionOwnership(
  visitorId: string,
  subscriptionId: string,
): Promise<boolean> {
  try {
    const customer = await billingGetCustomer(visitorId);
    return (
      customer?.subscriptions?.some((s: any) => s.id === subscriptionId) ??
      false
    );
  } catch (err) {
    console.error(
      "Subscription ownership check failed:",
      visitorId,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

// Exported for use by data routes and other modules
export function createCheckBillingFeatureAccess(pool: Pool) {
  return async function checkBillingFeatureAccess(
    visitorId: string,
    featureKey: string,
    email?: string,
  ): Promise<{
    allowed: boolean;
    reason?: string;
    usage?: number;
    limit?: number;
    remaining?: number;
  }> {
    if (!isBillingConfigured()) return { allowed: true };
    try {
      const billingId = await getOrCreateBillingCustomer(
        pool,
        visitorId,
        email,
      );
      if (!billingId)
        return { allowed: false, reason: "Billing service unavailable" };
      const result = await billingCheckEntitlement(visitorId, featureKey);
      const usageData = result?.usage;
      return {
        allowed: result?.allowed !== false,
        reason: result?.reason,
        usage: usageData?.used ?? usageData?.currentUsage ?? 0,
        limit: usageData?.limit ?? usageData?.usageLimit ?? 0,
        remaining: usageData?.remaining ?? usageData?.remainingQuota ?? null,
      };
    } catch (err) {
      console.error("Billing entitlement check error:", err);
      // Fallback: check if feature exists in customer's plan (matches SaaSSubscriptionSite pattern)
      try {
        const customer = await billingGetCustomer(visitorId);
        const activeSub = customer?.subscriptions?.find((s: any) => s.isActive);
        if (activeSub?.plan?.id) {
          const plans = await billingListPlans();
          const planItems = Array.isArray(plans)
            ? plans
            : (plans?.items ?? plans?.plans ?? []);
          const plan = planItems.find(
            (p: any) => (p.plan?.id ?? p.id) === activeSub.plan.id,
          );
          const features = plan?.features || [];
          const hasFeature = features.some((f: any) => f.key === featureKey);
          return {
            allowed: hasFeature,
            reason: hasFeature ? undefined : "Feature not in plan (fallback)",
          };
        }
      } catch (fallbackErr) {
        console.error("Billing entitlement fallback also failed:", fallbackErr);
      }
      return { allowed: false, reason: "Entitlement service unavailable" };
    }
  };
}

export function createTrackBillingUsage(
  pool: Pool,
  getAdminVisitorId: () => Promise<string | null>,
) {
  return function trackBillingUsage(
    visitorId: string,
    featureKey: string,
    eventName: string,
  ) {
    if (!isBillingConfigured()) return;
    const occurredAt = new Date().toISOString();
    const idempotencyKey = `${visitorId}-${featureKey}-${Date.now()}`;

    // 1. Forward to billing API
    billingIngestEvent({
      eventIdempotencyKey: idempotencyKey,
      eventName,
      occurredAt,
      customerReferenceId: visitorId,
      featureKey,
    }).catch((err: unknown) => {
      console.error("Billing usage tracking error:", err);
    });

    // 2. Also record as an observe_event under the admin account (dogfooding)
    getAdminVisitorId()
      .then((adminId) => {
        if (!adminId) return;
        pool
          .query(
            `INSERT INTO observe_events (
          user_id, customer_id, feature_key, event_name, timestamp,
          cost_amount, cost_unit, revenue_amount, usage_units,
          model, model_provider, source, granularity, is_inferred, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, 0, 'usd', 0, 1, NULL, NULL, 'internal', 'event', false, $6)
        ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
            [
              adminId,
              visitorId,
              featureKey,
              eventName,
              occurredAt,
              idempotencyKey,
            ],
          )
          .catch((err) =>
            console.error("Admin observe_event insert error:", err),
          );
      })
      .catch((err) => console.error("Admin observe tracking error:", err));
  };
}

// ─── Route factory ─────────────────────────────────────────────────────────

export function createBillingRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    checkBillingFeatureAccess: ReturnType<
      typeof createCheckBillingFeatureAccess
    >;
  },
) {
  const router = Router();

  // Billing Invoices
  router.get(
    "/billing/invoices",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!isBillingConfigured())
          return res.json({ invoices: [], configured: false });
        const visitorId = req.visitorId!;
        await getOrCreateBillingCustomer(pool, visitorId, req.accountEmail);
        const invoices = await billingListCustomerInvoices(visitorId);
        const items = Array.isArray(invoices)
          ? invoices
          : (invoices?.items ?? []);
        res.json({ invoices: items, configured: true });
      } catch (err) {
        console.error("Billing invoices error:", err);
        res.status(503).json({
          invoices: [],
          configured: true,
          error: "Billing service temporarily unavailable",
        });
      }
    },
  );

  // Billing Status & Plans
  router.get(
    "/billing/status",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      if (!isBillingConfigured())
        return res.json({
          plans: [],
          entitlements: [],
          customer: null,
          configured: false,
        });

      const visitorId = req.visitorId!;
      let plansResult: any[] = [];
      let entitlements: any[] = [];
      let customer: any = null;
      let healthy = true;

      try {
        const plans = await billingListPlans();
        plansResult = Array.isArray(plans)
          ? plans
          : plans?.items || plans?.plans || [];
      } catch (err) {
        console.error(
          "Billing status: plans fetch failed:",
          err instanceof Error ? err.message : err,
        );
        healthy = false;
      }

      // In Stripe-driven mode, customers are created via Stripe webhook — don't force-create here
      // Only attempt customer/entitlement lookups if user has an account (is logged in)
      if (req.accountEmail) {
        try {
          const ent = await billingListCustomerEntitlements(visitorId);
          entitlements = flattenEntitlements(ent);
        } catch (err) {
          // Customer may not exist in billing provider yet (will be created when Stripe subscription syncs)
          if (!(err instanceof Error && err.message.includes("404"))) {
            console.error(
              "Billing status: entitlements fetch failed:",
              err instanceof Error ? err.message : err,
            );
          }
        }

        try {
          customer = await billingGetCustomer(visitorId);
          // Normalize scheduledChanges on subscriptions (matches SaaSSubscriptionSite pattern)
          if (customer?.subscriptions) {
            for (const sub of customer.subscriptions) {
              // Billing provider may return scheduledChange (singular) or scheduledChanges (array) or metadata.SubscriptionScheduledChanges
              if (
                !Array.isArray(sub.scheduledChanges) ||
                sub.scheduledChanges.length === 0
              ) {
                if (sub.scheduledChange) {
                  sub.scheduledChanges = [
                    {
                      ...sub.scheduledChange,
                      toPlanId:
                        sub.scheduledChange.toPlanId ||
                        sub.scheduledChange.toPlan?.id,
                    },
                  ];
                } else if (sub.metadata?.SubscriptionScheduledChanges) {
                  sub.scheduledChanges =
                    sub.metadata.SubscriptionScheduledChanges.flat();
                }
              }
            }
          }
        } catch (err) {
          if (!(err instanceof Error && err.message.includes("404"))) {
            console.error(
              "Billing status: customer fetch failed:",
              err instanceof Error ? err.message : err,
            );
          }
        }
      } // end if (req.accountEmail)

      // Fetch feature rules for each plan-feature combo (limits, pricing model, etc.)
      const featureRules: Record<string, Record<string, any>> = {};
      try {
        const rulePromises: Promise<void>[] = [];
        for (const planData of plansResult) {
          const plan = planData.plan || planData;
          const features = planData.features || plan.features || [];
          if (!plan.id) continue;
          featureRules[plan.id] = {};
          for (const feature of features) {
            if (!feature.id) continue;
            rulePromises.push(
              billingAdminGetFeatureRule(plan.id, feature.id)
                .then((rule: any) => {
                  featureRules[plan.id][feature.key || feature.id] = rule;
                })
                .catch((err: unknown) => {
                  if (!(err instanceof Error && err.message.includes("404"))) {
                    console.warn(
                      `Feature rule fetch failed for plan=${plan.id} feature=${feature.id}:`,
                      err instanceof Error ? err.message : err,
                    );
                  }
                }),
            );
          }
        }
        await Promise.all(rulePromises);
      } catch (err) {
        console.error(
          "Billing status: feature rules fetch failed:",
          err instanceof Error ? err.message : err,
        );
      }

      res.json({
        plans: plansResult,
        entitlements,
        customer,
        featureRules,
        configured: true,
        healthy,
      });
    },
  );

  router.get(
    "/billing/plans",
    ensureVisitor,
    async (_req: AuthRequest, res: Response) => {
      try {
        if (!isBillingConfigured())
          return res.json({ plans: [], configured: false });
        const plans = await billingListPlans();
        res.json({
          plans: Array.isArray(plans)
            ? plans
            : plans?.items || plans?.plans || [],
          configured: true,
        });
      } catch (err) {
        console.error("Billing list plans error:", err);
        res.status(503).json({
          plans: [],
          configured: true,
          error: "Billing service temporarily unavailable",
        });
      }
    },
  );

  router.get(
    "/billing/features",
    ensureVisitor,
    async (_req: AuthRequest, res: Response) => {
      try {
        if (!isBillingConfigured())
          return res.json({ features: [], configured: false });
        const features = await billingListFeatures();
        res.json({
          features: Array.isArray(features)
            ? features
            : features?.items || features?.features || [],
          configured: true,
        });
      } catch (err) {
        console.error("Billing list features error:", err);
        res.status(503).json({
          features: [],
          configured: true,
          error: "Billing service temporarily unavailable",
        });
      }
    },
  );

  router.get(
    "/billing/entitlements",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!isBillingConfigured())
          return res.json({ entitlements: [], configured: false });
        const visitorId = req.visitorId!;
        await getOrCreateBillingCustomer(pool, visitorId, req.accountEmail);
        const entitlements = await billingListCustomerEntitlements(visitorId);
        res.json({
          entitlements: flattenEntitlements(entitlements),
          configured: true,
        });
      } catch (err) {
        console.error("Billing entitlements error:", err);
        res.status(503).json({
          entitlements: [],
          configured: true,
          error: "Billing service temporarily unavailable",
        });
      }
    },
  );

  router.get(
    "/billing/subscription",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!isBillingConfigured())
          return res.json({ customer: null, configured: false });
        const visitorId = req.visitorId!;
        await getOrCreateBillingCustomer(pool, visitorId, req.accountEmail);
        const customer = await billingGetCustomer(visitorId);
        res.json({ customer, configured: true });
      } catch (err) {
        console.error("Billing subscription error:", err);
        res.status(503).json({
          customer: null,
          configured: true,
          error: "Billing service temporarily unavailable",
        });
      }
    },
  );

  // Subscribe / upgrade / downgrade — matches SaaSSubscriptionSite Checkout.tsx pattern
  router.post(
    "/billing/subscribe",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!isBillingConfigured())
          return res.status(503).json({ error: "Billing not configured" });
        if (!req.accountEmail)
          return res.status(401).json({ error: "Please sign in to subscribe" });
        const visitorId = req.visitorId!;
        const { planId } = req.body;
        if (!planId)
          return res.status(400).json({ error: "planId is required" });
        await getOrCreateBillingCustomer(pool, visitorId, req.accountEmail);

        // Get current subscription state
        let activeSub: any = null;
        try {
          const customer = await billingGetCustomer(visitorId);
          activeSub = customer?.subscriptions?.find((s: any) => s.isActive);
        } catch (err) {
          if (!(err instanceof Error && err.message.includes("404"))) {
            throw err;
          }
        }

        // Same plan — no-op
        if (activeSub?.plan?.id === planId) {
          return res.json({ success: true, subscription: activeSub });
        }

        // ── PLAN CHANGE (upgrade or downgrade) ──
        if (activeSub) {
          const currentPrice = Number(activeSub.plan?.priceAmount ?? 0);
          const plans = await billingListPlans();
          const planItems = Array.isArray(plans)
            ? plans
            : (plans?.items ?? plans?.plans ?? []);
          const targetPlan = planItems.find(
            (p: any) => (p.plan?.id ?? p.id) === planId,
          );
          const targetPrice = Number(
            targetPlan?.plan?.priceAmount ?? targetPlan?.priceAmount ?? 0,
          );

          if (targetPrice > currentPrice) {
            // UPGRADE — Billing provider handles plan change, Stripe handles proration via auto-charge
            await billingChangeSubscriptionPlan(
              activeSub.id,
              planId,
              "UPGRADE",
            );
            const updated = await billingGetCustomer(visitorId);
            const newSub = updated?.subscriptions?.find((s: any) => s.isActive);
            return res.json({
              success: true,
              subscription: newSub,
              changeType: "upgrade",
            });
          } else {
            // DOWNGRADE — scheduled for end of billing period
            await billingChangeSubscriptionPlan(
              activeSub.id,
              planId,
              "DOWNGRADE",
            );
            const updated = await billingGetCustomer(visitorId);
            const newSub = updated?.subscriptions?.find((s: any) => s.isActive);
            return res.json({
              success: true,
              subscription: newSub,
              changeType: "downgrade",
            });
          }
        }

        // ── NEW SUBSCRIPTION ──
        const result = await billingCreateSubscription(visitorId, planId);
        const subscription = result?.subscription ?? result;
        const checkoutUrl = result?.checkoutUrl;

        // Paid plan — billing provider returns checkoutUrl for Stripe Checkout
        if (checkoutUrl) {
          return res.json({ success: true, subscription, checkoutUrl });
        }

        // Free plan — no payment needed
        res.json({ success: true, subscription });
      } catch (err) {
        console.error("Billing subscribe error:", err);
        res.status(500).json({ error: "Failed to create subscription" });
      }
    },
  );

  // Stripe Customer Portal — lets users manage payment methods, invoices, etc.
  router.post(
    "/billing/portal",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const stripe = await getUncachableStripeClient();
        const email = req.accountEmail;
        if (!email)
          return res
            .status(400)
            .json({ error: "Please sign in to manage billing" });

        const customers = await stripe.customers.list({ email, limit: 1 });
        if (customers.data.length === 0) {
          return res.status(404).json({
            error: "No Stripe customer found. Subscribe to a paid plan first.",
          });
        }

        const session = await stripe.billingPortal.sessions.create({
          customer: customers.data[0].id,
          return_url: `${req.headers.origin || req.headers.referer || "http://localhost:5173"}/plans`,
        });

        res.json({ url: session.url });
      } catch (err) {
        console.error("Stripe portal error:", err);
        res.status(500).json({ error: "Failed to create portal session" });
      }
    },
  );

  // Cancel subscription (supports IMMEDIATE or END_OF_PERIOD)
  router.post(
    "/billing/cancel",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!isBillingConfigured())
          return res.status(503).json({ error: "Billing not configured" });
        const { subscriptionId, cancelMode = "IMMEDIATE" } = req.body;
        if (!subscriptionId)
          return res.status(400).json({ error: "subscriptionId is required" });
        if (cancelMode !== "IMMEDIATE" && cancelMode !== "END_OF_PERIOD") {
          return res
            .status(400)
            .json({ error: "cancelMode must be IMMEDIATE or END_OF_PERIOD" });
        }

        // Verify ownership
        if (
          !(await verifySubscriptionOwnership(req.visitorId!, subscriptionId))
        ) {
          return res.status(403).json({ error: "Subscription not found" });
        }

        // Cancel any scheduled plan changes first to avoid conflicting states
        try {
          await billingCancelScheduledPlanChanges(subscriptionId);
        } catch (err) {
          if (!(err instanceof Error && err.message.includes("404"))) {
            console.warn(
              "Failed to cancel scheduled plan changes:",
              err instanceof Error ? err.message : err,
            );
          }
        }

        const result = await billingCancelSubscription(
          subscriptionId,
          cancelMode,
        );
        res.json({ success: true, subscription: result });
      } catch (err) {
        console.error("Billing cancel error:", err);
        res.status(500).json({ error: "Failed to cancel subscription" });
      }
    },
  );

  // Reactivate — cancel a scheduled cancellation (keep subscription active)
  router.post(
    "/billing/reactivate",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!isBillingConfigured())
          return res.status(503).json({ error: "Billing not configured" });
        const { subscriptionId } = req.body;
        if (!subscriptionId)
          return res.status(400).json({ error: "subscriptionId is required" });

        if (
          !(await verifySubscriptionOwnership(req.visitorId!, subscriptionId))
        ) {
          return res.status(403).json({ error: "Subscription not found" });
        }

        await billingCancelScheduledCancellation(subscriptionId);
        res.json({ success: true });
      } catch (err) {
        console.error("Billing reactivate error:", err);
        res.status(500).json({ error: "Failed to reactivate subscription" });
      }
    },
  );

  // Cancel a pending downgrade
  router.post(
    "/billing/cancel-scheduled-changes",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!isBillingConfigured())
          return res.status(503).json({ error: "Billing not configured" });
        const { subscriptionId } = req.body;
        if (!subscriptionId)
          return res.status(400).json({ error: "subscriptionId is required" });

        if (
          !(await verifySubscriptionOwnership(req.visitorId!, subscriptionId))
        ) {
          return res.status(403).json({ error: "Subscription not found" });
        }

        await billingCancelScheduledPlanChanges(subscriptionId);
        res.json({ success: true });
      } catch (err) {
        console.error("Billing cancel scheduled changes error:", err);
        res.status(500).json({ error: "Failed to cancel scheduled changes" });
      }
    },
  );

  router.get(
    "/billing/check/:featureKey",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { featureKey } = req.params;
        const result = await deps.checkBillingFeatureAccess(
          visitorId,
          featureKey,
          req.accountEmail,
        );
        res.json(result);
      } catch (err) {
        console.error("Billing check error:", err);
        res
          .status(503)
          .json({
            allowed: false,
            reason: "Feature check temporarily unavailable. Please retry.",
          });
      }
    },
  );

  return router;
}

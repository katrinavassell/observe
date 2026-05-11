import { request } from "./base";

/**
 * Request shape for capturing a Tanso Platform implementation lead from
 * inside the Observe dashboard. Sent when a user clicks "Talk to us about
 * implementing this →" on a MarginRecommendation card.
 */
export interface TansoLeadInput {
  email: string;
  customer_name?: string | null;
  action_type?: string | null;
  action_payload?: Record<string, unknown> | null;
  recovered_dollars?: number | null;
  recommendation_id?: number | null;
  note?: string | null;
  scheduled_for?: string | null;
  source?: string;
}

export interface TansoLead {
  id: string;
  email: string;
  customer_name: string | null;
  action_type: string | null;
  recovered_dollars: number | null;
  source: string;
  scheduled_for: string | null;
  created_at: string;
}

export async function captureTansoLead(
  input: TansoLeadInput,
): Promise<{ lead: TansoLead }> {
  return request("/v1/contact/tanso-implementation", {
    method: "POST",
    body: JSON.stringify({
      source: "observe_recommendation_cta",
      ...input,
    }),
  });
}

import { request } from "./base";

export interface Account {
  id: number;
  name: string;
  domain: string | null;
  source_system: string;
  segment: string | null;
  industry: string | null;
  employee_count: number | null;
  plan_tier: string | null;
  arr: number | null;
  mrr: number | null;
}

export interface AccountDetail extends Account {
  website: string | null;
  email_domain: string | null;
  created_at: string | null;
  subscriptions: Array<{
    id: number;
    plan_tier: string;
    status: string;
    amount: number;
    billing_interval: string | null;
    start_date: string | null;
    discount_percent: number | null;
  }>;
  invoices: Array<{
    id: number;
    amount: number | null;
    net_amount: number | null;
    status: string;
    date: string | null;
  }>;
  usage: Array<{
    metric_key: string;
    metric_value: number;
    aggregation_type: string;
  }>;
  matches: Array<{
    id: number;
    matched_account_name: string;
    matched_source_system: string;
    score: number;
    confidence: string;
    is_confirmed: boolean;
    is_rejected: boolean;
  }>;
}

export interface AccountsResponse {
  accounts: Account[];
  total: number;
  has_more: boolean;
}

export async function getAccountById(id: number): Promise<AccountDetail> {
  return request(`/accounts/${id}`);
}

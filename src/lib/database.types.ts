export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      plans: {
        Row: {
          id: string
          user_id: string
          plan_id: string
          name: string
          price_amount: number
          interval_months: number
          billing_model: string
          api_calls_limit: number | null
          tokens_limit: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          plan_id: string
          name: string
          price_amount?: number
          interval_months?: number
          billing_model?: string
          api_calls_limit?: number | null
          tokens_limit?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          plan_id?: string
          name?: string
          price_amount?: number
          interval_months?: number
          billing_model?: string
          api_calls_limit?: number | null
          tokens_limit?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      customers: {
        Row: {
          id: string
          user_id: string
          customer_id: string
          name: string
          email: string | null
          segment: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          customer_id: string
          name: string
          email?: string | null
          segment?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          customer_id?: string
          name?: string
          email?: string | null
          segment?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      subscriptions: {
        Row: {
          id: string
          user_id: string
          subscription_id: string
          customer_id: string
          plan_id: string
          is_active: boolean
          current_period_start: string | null
          current_period_end: string | null
          cancelled_at: string | null
          previous_mrr: number | null
          mrr_override: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          subscription_id: string
          customer_id: string
          plan_id: string
          is_active?: boolean
          current_period_start?: string | null
          current_period_end?: string | null
          cancelled_at?: string | null
          previous_mrr?: number | null
          mrr_override?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          subscription_id?: string
          customer_id?: string
          plan_id?: string
          is_active?: boolean
          current_period_start?: string | null
          current_period_end?: string | null
          cancelled_at?: string | null
          previous_mrr?: number | null
          mrr_override?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      usage_records: {
        Row: {
          id: string
          user_id: string
          customer_id: string
          metric_key: string
          metric_value: number
          metric_limit: number | null
          period_start: string
          period_end: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          customer_id: string
          metric_key: string
          metric_value: number
          metric_limit?: number | null
          period_start: string
          period_end: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          customer_id?: string
          metric_key?: string
          metric_value?: number
          metric_limit?: number | null
          period_start?: string
          period_end?: string
          created_at?: string
        }
      }
      cost_records: {
        Row: {
          id: string
          user_id: string
          customer_id: string | null
          cost_type: string
          amount: number
          period_start: string
          period_end: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          customer_id?: string | null
          cost_type: string
          amount: number
          period_start: string
          period_end: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          customer_id?: string | null
          cost_type?: string
          amount?: number
          period_start?: string
          period_end?: string
          created_at?: string
        }
      }
      user_data_status: {
        Row: {
          id: string
          user_id: string
          data_mode: string
          has_revenue: boolean
          has_costs: boolean
          has_usage: boolean
          revenue_customer_count: number
          costs_record_count: number
          usage_record_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          data_mode?: string
          has_revenue?: boolean
          has_costs?: boolean
          has_usage?: boolean
          revenue_customer_count?: number
          costs_record_count?: number
          usage_record_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          data_mode?: string
          has_revenue?: boolean
          has_costs?: boolean
          has_usage?: boolean
          revenue_customer_count?: number
          costs_record_count?: number
          usage_record_count?: number
          created_at?: string
          updated_at?: string
        }
      }
    }
    Functions: {
      clear_user_data: {
        Args: Record<string, never>
        Returns: void
      }
    }
  }
}

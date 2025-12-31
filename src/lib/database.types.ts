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
          metadata: Json | null
          product_id: string | null
          usage_type: string | null
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
          metadata?: Json | null
          product_id?: string | null
          usage_type?: string | null
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
          metadata?: Json | null
          product_id?: string | null
          usage_type?: string | null
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
          metadata: Json | null
          country: string | null
          city: string | null
          tax_exempt: boolean | null
          balance: number | null
          delinquent: boolean | null
          total_spend: number | null
          subscription_count: number | null
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
          metadata?: Json | null
          country?: string | null
          city?: string | null
          tax_exempt?: boolean | null
          balance?: number | null
          delinquent?: boolean | null
          total_spend?: number | null
          subscription_count?: number | null
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
          metadata?: Json | null
          country?: string | null
          city?: string | null
          tax_exempt?: boolean | null
          balance?: number | null
          delinquent?: boolean | null
          total_spend?: number | null
          subscription_count?: number | null
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
          status: string | null
          current_period_start: string | null
          current_period_end: string | null
          cancelled_at: string | null
          ended_at: string | null
          trial_end: string | null
          previous_mrr: number | null
          mrr_override: number | null
          metadata: Json | null
          discount_percent: number | null
          discount_amount: number | null
          cancel_at_period_end: boolean | null
          cancellation_reason: string | null
          billing_interval: string | null
          currency: string | null
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
          status?: string | null
          current_period_start?: string | null
          current_period_end?: string | null
          cancelled_at?: string | null
          ended_at?: string | null
          trial_end?: string | null
          previous_mrr?: number | null
          mrr_override?: number | null
          metadata?: Json | null
          discount_percent?: number | null
          discount_amount?: number | null
          cancel_at_period_end?: boolean | null
          cancellation_reason?: string | null
          billing_interval?: string | null
          currency?: string | null
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
          status?: string | null
          current_period_start?: string | null
          current_period_end?: string | null
          cancelled_at?: string | null
          ended_at?: string | null
          trial_end?: string | null
          previous_mrr?: number | null
          mrr_override?: number | null
          metadata?: Json | null
          discount_percent?: number | null
          discount_amount?: number | null
          cancel_at_period_end?: boolean | null
          cancellation_reason?: string | null
          billing_interval?: string | null
          currency?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      invoices: {
        Row: {
          id: string
          user_id: string
          invoice_id: string
          customer_id: string
          subscription_id: string | null
          number: string | null
          status: string
          amount_due: number
          amount_paid: number
          amount_remaining: number
          subtotal: number
          tax: number | null
          total: number
          currency: string
          billing_reason: string | null
          attempt_count: number | null
          due_date: string | null
          paid_at: string | null
          metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          invoice_id: string
          customer_id: string
          subscription_id?: string | null
          number?: string | null
          status: string
          amount_due?: number
          amount_paid?: number
          amount_remaining?: number
          subtotal?: number
          tax?: number | null
          total?: number
          currency?: string
          billing_reason?: string | null
          attempt_count?: number | null
          due_date?: string | null
          paid_at?: string | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          invoice_id?: string
          customer_id?: string
          subscription_id?: string | null
          number?: string | null
          status?: string
          amount_due?: number
          amount_paid?: number
          amount_remaining?: number
          subtotal?: number
          tax?: number | null
          total?: number
          currency?: string
          billing_reason?: string | null
          attempt_count?: number | null
          due_date?: string | null
          paid_at?: string | null
          metadata?: Json | null
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

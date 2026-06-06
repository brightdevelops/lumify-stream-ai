export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      credit_ledger: {
        Row: {
          balance_after: number
          created_at: string
          delta: number
          id: string
          note: string | null
          performed_by: string | null
          reason: string
          user_id: string
        }
        Insert: {
          balance_after: number
          created_at?: string
          delta: number
          id?: string
          note?: string | null
          performed_by?: string | null
          reason: string
          user_id: string
        }
        Update: {
          balance_after?: number
          created_at?: string
          delta?: number
          id?: string
          note?: string | null
          performed_by?: string | null
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      credits: {
        Row: {
          balance: number
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      page_visits: {
        Row: {
          created_at: string
          id: string
          ip: string | null
          path: string
          referrer: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip?: string | null
          path: string
          referrer?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string | null
          path?: string
          referrer?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          banned: boolean
          created_at: string
          credits: number
          email: string
          full_name: string | null
          id: string
          is_admin: boolean
          last_seen: string | null
          obs_token: string | null
          stream_token: string
        }
        Insert: {
          banned?: boolean
          created_at?: string
          credits?: number
          email: string
          full_name?: string | null
          id: string
          is_admin?: boolean
          last_seen?: string | null
          obs_token?: string | null
          stream_token?: string
        }
        Update: {
          banned?: boolean
          created_at?: string
          credits?: number
          email?: string
          full_name?: string | null
          id?: string
          is_admin?: boolean
          last_seen?: string | null
          obs_token?: string | null
          stream_token?: string
        }
        Relationships: []
      }
      site_visits: {
        Row: {
          created_at: string
          id: string
          session_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          session_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          session_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      stream_sessions: {
        Row: {
          created_at: string
          credits_used: number
          ended_at: string | null
          id: string
          last_heartbeat: string
          started_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_used?: number
          ended_at?: string | null
          id?: string
          last_heartbeat?: string
          started_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits_used?: number
          ended_at?: string | null
          id?: string
          last_heartbeat?: string
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number | null
          amount_ngn: number | null
          created_at: string
          credits: number
          description: string | null
          id: string
          package_id: string | null
          reference: string | null
          type: Database["public"]["Enums"]["transaction_type"] | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          amount_ngn?: number | null
          created_at?: string
          credits?: number
          description?: string | null
          id?: string
          package_id?: string | null
          reference?: string | null
          type?: Database["public"]["Enums"]["transaction_type"] | null
          user_id: string
        }
        Update: {
          amount?: number | null
          amount_ngn?: number | null
          created_at?: string
          credits?: number
          description?: string | null
          id?: string
          package_id?: string | null
          reference?: string | null
          type?: Database["public"]["Enums"]["transaction_type"] | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_adjust_credits: {
        Args: { delta: number; note: string; target_user_id: string }
        Returns: number
      }
      admin_ban_user: { Args: { target_user_id: string }; Returns: undefined }
      admin_delete_user: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      admin_get_active_streams: {
        Args: never
        Returns: {
          credits_remaining: number
          credits_used: number
          duration_seconds: number
          full_name: string
          last_heartbeat: string
          session_id: string
          started_at: string
          user_email: string
          user_id: string
        }[]
      }
      admin_get_credit_stats: {
        Args: never
        Returns: {
          active_month: number
          active_streams: number
          active_today: number
          active_users_total: number
          active_week: number
          credits_sold_all_time: number
          credits_sold_month: number
          credits_sold_today: number
          credits_sold_week: number
          revenue_all_time: number
          revenue_month: number
          revenue_today: number
          revenue_week: number
          total_credits_held: number
          total_credits_used: number
          total_users: number
        }[]
      }
      admin_get_finance_stats: { Args: never; Returns: Json }
      admin_get_ledger: {
        Args: { filter_user_id?: string; row_limit?: number }
        Returns: {
          admin_email: string
          balance_after: number
          created_at: string
          delta: number
          id: string
          note: string
          performed_by: string
          reason: string
          user_email: string
          user_id: string
        }[]
      }
      admin_get_metrics: { Args: never; Returns: Json }
      admin_get_visit_stats: {
        Args: never
        Returns: {
          total_visits: number
          unique_visitors_logged_in: number
          visits_last_7_days: number
          visits_today: number
        }[]
      }
      admin_list_recent_visits: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          id: string
          ip: string
          path: string
          referrer: string
          user_agent: string
          user_email: string
          user_id: string
          visit_count: number
        }[]
      }
      admin_list_transactions: {
        Args: { p_limit?: number; p_type?: string }
        Returns: {
          amount: number
          created_at: string
          credits: number
          description: string
          id: string
          type: string
          user_email: string
          user_id: string
        }[]
      }
      admin_list_users: {
        Args: never
        Returns: {
          banned: boolean
          created_at: string
          credits: number
          email: string
          has_streamed: boolean
          id: string
          is_admin: boolean
          last_sign_in_at: string
        }[]
      }
      admin_list_users_full: {
        Args: never
        Returns: {
          balance: number
          created_at: string
          email: string
          full_name: string
          is_admin: boolean
          is_streaming: boolean
          last_seen: string
          total_credits_purchased: number
          total_credits_used: number
          total_spent: number
          user_id: string
        }[]
      }
      admin_list_users_with_credits: {
        Args: never
        Returns: {
          balance: number
          created_at: string
          email: string
          full_name: string
          is_admin: boolean
          total_credits_used: number
          total_spent: number
          user_id: string
        }[]
      }
      admin_registration_analytics: {
        Args: { p_days?: number }
        Returns: {
          count: number
          day: string
          users: Json
        }[]
      }
      admin_set_admin: {
        Args: { make_admin: boolean; target_user_id: string }
        Returns: undefined
      }
      admin_top_pages: {
        Args: { p_limit?: number }
        Returns: {
          path: string
          unique_visitors: number
          visits: number
        }[]
      }
      admin_unban_user: { Args: { target_user_id: string }; Returns: undefined }
      admin_user_transactions: {
        Args: { p_user: string }
        Returns: {
          amount: number
          created_at: string
          credits: number
          description: string
          id: string
          type: string
        }[]
      }
      admin_visitor_overview: {
        Args: never
        Returns: {
          anonymous_visitors: number
          registered_visitors: number
          returning_visitors: number
          unique_month: number
          unique_today: number
          unique_week: number
          visits_month: number
          visits_today: number
          visits_week: number
        }[]
      }
      can_start_stream: {
        Args: never
        Returns: {
          can_stream: boolean
          current_balance: number
        }[]
      }
      complete_purchase: {
        Args: {
          p_amount_ngn: number
          p_credits: number
          p_package_id: string
          p_reference: string
          target_user_id: string
        }
        Returns: undefined
      }
      deduct_credits: {
        Args: {
          p_amount: number
          p_credits: number
          p_description?: string
          p_log_transaction?: boolean
        }
        Returns: number
      }
      deduct_stream_credits: {
        Args: { seconds_elapsed: number }
        Returns: {
          exhausted: boolean
          new_balance: number
        }[]
      }
      get_my_ledger: {
        Args: { row_limit?: number }
        Returns: {
          balance_after: number
          created_at: string
          delta: number
          id: string
          note: string
          reason: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      inventor_visit_stats: { Args: never; Returns: Json }
      log_usage_transaction: {
        Args: { p_amount: number; p_credits: number; p_description?: string }
        Returns: undefined
      }
      purchase_credits: {
        Args: { p_amount: number; p_credits: number; p_description?: string }
        Returns: number
      }
      purchase_credits_for_user: {
        Args: {
          p_amount: number
          p_credits: number
          p_description?: string
          p_user_id: string
        }
        Returns: number
      }
      record_login: { Args: never; Returns: undefined }
      regenerate_stream_token: { Args: never; Returns: string }
      resolve_stream_token: { Args: { p_token: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user"
      transaction_type: "purchase" | "usage"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      transaction_type: ["purchase", "usage"],
    },
  },
} as const

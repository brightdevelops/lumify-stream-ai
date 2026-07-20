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
      admin_integrity_alerts: {
        Row: {
          actual_balance: number
          computed_balance: number
          detected_at: string
          drift: number
          id: string
          note: string | null
          resolved_at: string | null
          user_email: string | null
          user_id: string
        }
        Insert: {
          actual_balance: number
          computed_balance: number
          detected_at?: string
          drift: number
          id?: string
          note?: string | null
          resolved_at?: string | null
          user_email?: string | null
          user_id: string
        }
        Update: {
          actual_balance?: number
          computed_balance?: number
          detected_at?: string
          drift?: number
          id?: string
          note?: string | null
          resolved_at?: string | null
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      announcements: {
        Row: {
          body: string
          button_link: string
          button_text: string
          created_at: string
          ends_at: string | null
          frequency: string
          id: string
          image_url: string
          is_active: boolean
          singleton_key: string
          starts_at: string | null
          tag_text: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          button_link?: string
          button_text?: string
          created_at?: string
          ends_at?: string | null
          frequency?: string
          id?: string
          image_url?: string
          is_active?: boolean
          singleton_key?: string
          starts_at?: string | null
          tag_text?: string
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          button_link?: string
          button_text?: string
          created_at?: string
          ends_at?: string | null
          frequency?: string
          id?: string
          image_url?: string
          is_active?: boolean
          singleton_key?: string
          starts_at?: string | null
          tag_text?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
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
      crypto_invoices: {
        Row: {
          amount_ngn: number
          created_at: string
          credits: number
          id: string
          invoice_url: string | null
          order_id: string
          pack_id: string
          paid_at: string | null
          price_usd: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_ngn: number
          created_at?: string
          credits: number
          id?: string
          invoice_url?: string | null
          order_id: string
          pack_id: string
          paid_at?: string | null
          price_usd: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_ngn?: number
          created_at?: string
          credits?: number
          id?: string
          invoice_url?: string | null
          order_id?: string
          pack_id?: string
          paid_at?: string | null
          price_usd?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
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
      payment_issues: {
        Row: {
          admin_note: string | null
          created_at: string
          id: string
          message: string
          method: string
          order_reference: string | null
          pack_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          id?: string
          message: string
          method: string
          order_reference?: string | null
          pack_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          id?: string
          message?: string
          method?: string
          order_reference?: string | null
          pack_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
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
          is_vpn: boolean | null
          last_country: string | null
          last_ip: string | null
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
          is_vpn?: boolean | null
          last_country?: string | null
          last_ip?: string | null
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
          is_vpn?: boolean | null
          last_country?: string | null
          last_ip?: string | null
          last_seen?: string | null
          obs_token?: string | null
          stream_token?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: boolean
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: boolean
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: boolean
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
      stream_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          image_name: string | null
          image_path: string | null
          mode: string | null
          prompt: string | null
          realism: number | null
          session_id: string | null
          style: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          image_name?: string | null
          image_path?: string | null
          mode?: string | null
          prompt?: string | null
          realism?: number | null
          session_id?: string | null
          style?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          image_name?: string | null
          image_path?: string | null
          mode?: string | null
          prompt?: string | null
          realism?: number | null
          session_id?: string | null
          style?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stream_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "stream_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      stream_recordings: {
        Row: {
          chunk_index: number
          created_at: string
          duration_seconds: number | null
          id: string
          mime_type: string | null
          session_id: string | null
          size_bytes: number | null
          storage_path: string
          user_id: string
        }
        Insert: {
          chunk_index?: number
          created_at?: string
          duration_seconds?: number | null
          id?: string
          mime_type?: string | null
          session_id?: string | null
          size_bytes?: number | null
          storage_path: string
          user_id: string
        }
        Update: {
          chunk_index?: number
          created_at?: string
          duration_seconds?: number | null
          id?: string
          mime_type?: string | null
          session_id?: string | null
          size_bytes?: number | null
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stream_recordings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "stream_sessions"
            referencedColumns: ["id"]
          },
        ]
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
      support_autoreply_rules: {
        Row: {
          created_at: string
          id: string
          response: string
          sort_order: number
          triggers: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          response: string
          sort_order?: number
          triggers: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          response?: string
          sort_order?: number
          triggers?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      support_conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          last_message_preview: string | null
          subject: string | null
          type: string
          unread_for_admin: number
          unread_for_user: number
          updated_at: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          subject?: string | null
          type: string
          unread_for_admin?: number
          unread_for_user?: number
          updated_at?: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          subject?: string | null
          type?: string
          unread_for_admin?: number
          unread_for_user?: number
          updated_at?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          is_auto_reply: boolean
          message: string
          read: boolean
          sender: string
          subject: string | null
          type: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          is_auto_reply?: boolean
          message: string
          read?: boolean
          sender: string
          subject?: string | null
          type: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          is_auto_reply?: boolean
          message?: string
          read?: boolean
          sender?: string
          subject?: string | null
          type?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number | null
          amount_ngn: number | null
          category: string
          created_at: string
          credits: number
          description: string | null
          id: string
          package_id: string | null
          reference: string | null
          session_id: string | null
          type: Database["public"]["Enums"]["transaction_type"] | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          amount_ngn?: number | null
          category?: string
          created_at?: string
          credits?: number
          description?: string | null
          id?: string
          package_id?: string | null
          reference?: string | null
          session_id?: string | null
          type?: Database["public"]["Enums"]["transaction_type"] | null
          user_id: string
        }
        Update: {
          amount?: number | null
          amount_ngn?: number | null
          category?: string
          created_at?: string
          credits?: number
          description?: string | null
          id?: string
          package_id?: string | null
          reference?: string | null
          session_id?: string | null
          type?: Database["public"]["Enums"]["transaction_type"] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "stream_sessions"
            referencedColumns: ["id"]
          },
        ]
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
      admin_close_support_conversation: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      admin_delete_user: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      admin_dry_run_overcharge_refunds: {
        Args: never
        Returns: {
          allowed_credits: number
          charged_credits: number
          over_credits: number
          tx_created_at: string
          tx_id: string
          user_email: string
          user_id: string
        }[]
      }
      admin_execute_overcharge_refunds: {
        Args: never
        Returns: {
          refunded_tx_count: number
          total_credits_refunded: number
        }[]
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
      admin_get_session_detail: {
        Args: { p_session_id: string }
        Returns: Json
      }
      admin_get_visit_stats: {
        Args: never
        Returns: {
          total_visits: number
          unique_visitors_logged_in: number
          visits_last_7_days: number
          visits_today: number
        }[]
      }
      admin_list_crypto_invoices: {
        Args: { p_limit?: number; p_status?: string }
        Returns: {
          amount_ngn: number
          created_at: string
          credits: number
          full_name: string
          id: string
          invoice_url: string
          order_id: string
          pack_id: string
          paid_at: string
          price_usd: number
          status: string
          user_email: string
          user_id: string
        }[]
      }
      admin_list_payment_issues: {
        Args: { p_limit?: number; p_status?: string }
        Returns: {
          admin_note: string
          created_at: string
          full_name: string
          id: string
          message: string
          method: string
          order_reference: string
          pack_id: string
          resolved_at: string
          status: string
          user_email: string
          user_id: string
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
      admin_list_stream_recordings: {
        Args: { p_limit?: number }
        Returns: {
          chunk_count: number
          ended_at: string
          is_vpn: boolean
          last_country: string
          last_recording_at: string
          session_id: string
          started_at: string
          total_bytes: number
          total_duration_seconds: number
          user_email: string
          user_id: string
        }[]
      }
      admin_list_support_conversations: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          credit_balance: number
          full_name: string
          id: string
          last_message_at: string
          last_message_preview: string
          subject: string
          type: string
          unread_for_admin: number
          user_email: string
          user_id: string
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
        Args: { p_limit?: number; p_search?: string }
        Returns: {
          banned: boolean
          created_at: string
          credits: number
          email: string
          has_streamed: boolean
          id: string
          is_admin: boolean
          is_vpn: boolean
          last_country: string
          last_ip: string
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
      admin_mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
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
      admin_update_payment_issue: {
        Args: { p_id: string; p_note?: string; p_status: string }
        Returns: undefined
      }
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
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
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
      is_maintenance_mode: { Args: never; Returns: boolean }
      log_usage_transaction:
        | {
            Args: {
              p_amount: number
              p_credits: number
              p_description?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_amount: number
              p_credits: number
              p_description?: string
              p_session_id?: string
            }
            Returns: undefined
          }
      mark_my_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
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
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_login: { Args: never; Returns: undefined }
      regenerate_stream_token: { Args: never; Returns: string }
      resolve_stream_token: { Args: { p_token: string }; Returns: string }
      run_credit_integrity_check: {
        Args: never
        Returns: {
          actual_balance: number
          computed_balance: number
          drift: number
          user_email: string
          user_id: string
        }[]
      }
      set_site_setting: {
        Args: { p_key: string; p_value: boolean }
        Returns: boolean
      }
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

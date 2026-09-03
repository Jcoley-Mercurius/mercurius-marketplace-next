export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      contact_submissions: {
        Row: {
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          message: string
          phone: string | null
          subject: string
        }
        Insert: {
          created_at?: string
          email: string
          first_name: string
          id?: string
          last_name: string
          message: string
          phone?: string | null
          subject: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          message?: string
          phone?: string | null
          subject?: string
        }
        Relationships: []
      }
      contractor_gallery: {
        Row: {
          caption: string | null
          contractor_id: string
          created_at: string
          id: string
          image_url: string
          sort_order: number
        }
        Insert: {
          caption?: string | null
          contractor_id: string
          created_at?: string
          id?: string
          image_url: string
          sort_order?: number
        }
        Update: {
          caption?: string | null
          contractor_id?: string
          created_at?: string
          id?: string
          image_url?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "contractor_gallery_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_service_zips: {
        Row: {
          contractor_id: string
          created_at: string
          id: string
          zip_code: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          id?: string
          zip_code: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          id?: string
          zip_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_service_zips_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      contractors: {
        Row: {
          badges: string[] | null
          bio: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean | null
          jobs_completed: number | null
          location: string | null
          logo_url: string | null
          marketing_enabled: boolean
          name: string
          our_promise: string | null
          payouts_paused: boolean
          payouts_paused_at: string | null
          payouts_paused_reason: string | null
          phone: string | null
          rating: number | null
          services: string[]
          special_offer: string | null
          tagline: string | null
          updated_at: string
          user_id: string | null
          verified_specialty: string | null
          video_url: string | null
          website: string | null
          years_experience: number | null
        }
        Insert: {
          badges?: string[] | null
          bio?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean | null
          jobs_completed?: number | null
          location?: string | null
          logo_url?: string | null
          marketing_enabled?: boolean
          name: string
          our_promise?: string | null
          payouts_paused?: boolean
          payouts_paused_at?: string | null
          payouts_paused_reason?: string | null
          phone?: string | null
          rating?: number | null
          services?: string[]
          special_offer?: string | null
          tagline?: string | null
          updated_at?: string
          user_id?: string | null
          verified_specialty?: string | null
          video_url?: string | null
          website?: string | null
          years_experience?: number | null
        }
        Update: {
          badges?: string[] | null
          bio?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean | null
          jobs_completed?: number | null
          location?: string | null
          logo_url?: string | null
          marketing_enabled?: boolean
          name?: string
          our_promise?: string | null
          payouts_paused?: boolean
          payouts_paused_at?: string | null
          payouts_paused_reason?: string | null
          phone?: string | null
          rating?: number | null
          services?: string[]
          special_offer?: string | null
          tagline?: string | null
          updated_at?: string
          user_id?: string | null
          verified_specialty?: string | null
          video_url?: string | null
          website?: string | null
          years_experience?: number | null
        }
        Relationships: []
      }
      coverage_areas: {
        Row: {
          city: string
          created_at: string
          has_waitlist: boolean
          id: string
          is_active: boolean
          state: string
          updated_at: string
          zip_code: string
        }
        Insert: {
          city: string
          created_at?: string
          has_waitlist?: boolean
          id?: string
          is_active?: boolean
          state?: string
          updated_at?: string
          zip_code: string
        }
        Update: {
          city?: string
          created_at?: string
          has_waitlist?: boolean
          id?: string
          is_active?: boolean
          state?: string
          updated_at?: string
          zip_code?: string
        }
        Relationships: []
      }
      disputes: {
        Row: {
          created_at: string
          homeowner_id: string
          id: string
          job_id: string
          raised_at: string
          reason: string | null
          resolution_notes: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["dispute_status"]
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          created_at?: string
          homeowner_id: string
          id?: string
          job_id: string
          raised_at?: string
          reason?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          created_at?: string
          homeowner_id?: string
          id?: string
          job_id?: string
          raised_at?: string
          reason?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "disputes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      featured_providers: {
        Row: {
          contractor_id: string
          created_at: string
          end_date: string | null
          headline: string | null
          id: string
          is_active: boolean
          start_date: string
          tier: string
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          end_date?: string | null
          headline?: string | null
          id?: string
          is_active?: boolean
          start_date?: string
          tier?: string
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          end_date?: string | null
          headline?: string | null
          id?: string
          is_active?: boolean
          start_date?: string
          tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "featured_providers_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      home_profiles: {
        Row: {
          bathrooms: number | null
          bedrooms: number | null
          created_at: string
          has_deck_patio: boolean | null
          has_fence: boolean | null
          has_irrigation: boolean | null
          has_pool: boolean | null
          has_trees: boolean | null
          has_yard: boolean | null
          home_age_range: string
          id: string
          is_complete: boolean | null
          ownership_duration: string
          ownership_type: string
          property_type: string
          square_footage: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bathrooms?: number | null
          bedrooms?: number | null
          created_at?: string
          has_deck_patio?: boolean | null
          has_fence?: boolean | null
          has_irrigation?: boolean | null
          has_pool?: boolean | null
          has_trees?: boolean | null
          has_yard?: boolean | null
          home_age_range?: string
          id?: string
          is_complete?: boolean | null
          ownership_duration?: string
          ownership_type?: string
          property_type?: string
          square_footage?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bathrooms?: number | null
          bedrooms?: number | null
          created_at?: string
          has_deck_patio?: boolean | null
          has_fence?: boolean | null
          has_irrigation?: boolean | null
          has_pool?: boolean | null
          has_trees?: boolean | null
          has_yard?: boolean | null
          home_age_range?: string
          id?: string
          is_complete?: boolean | null
          ownership_duration?: string
          ownership_type?: string
          property_type?: string
          square_footage?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      internal_worker_tokens: {
        Row: {
          created_at: string
          name: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          name: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          name?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount: number
          base_amount: number | null
          contractor_id: string | null
          created_at: string
          customer_id: string
          due_date: string | null
          id: string
          invoice_number: string
          is_deposit: boolean
          notes: string | null
          paid_at: string | null
          paid_by_customer_at: string | null
          platform_fee: number
          promotion_id: string | null
          release_eligible_at: string | null
          released_at: string | null
          service_request_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          stripe_payment_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          updated_at: string
          vendor_payout: number
        }
        Insert: {
          amount: number
          base_amount?: number | null
          contractor_id?: string | null
          created_at?: string
          customer_id: string
          due_date?: string | null
          id?: string
          invoice_number: string
          is_deposit?: boolean
          notes?: string | null
          paid_at?: string | null
          paid_by_customer_at?: string | null
          platform_fee?: number
          promotion_id?: string | null
          release_eligible_at?: string | null
          released_at?: string | null
          service_request_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          stripe_payment_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          updated_at?: string
          vendor_payout?: number
        }
        Update: {
          amount?: number
          base_amount?: number | null
          contractor_id?: string | null
          created_at?: string
          customer_id?: string
          due_date?: string | null
          id?: string
          invoice_number?: string
          is_deposit?: boolean
          notes?: string | null
          paid_at?: string | null
          paid_by_customer_at?: string | null
          platform_fee?: number
          promotion_id?: string | null
          release_eligible_at?: string | null
          released_at?: string | null
          service_request_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          stripe_payment_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          updated_at?: string
          vendor_payout?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "package_promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      job_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: Database["public"]["Enums"]["job_event_type"]
          id: string
          job_id: string
          metadata: Json | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: Database["public"]["Enums"]["job_event_type"]
          id?: string
          job_id: string
          metadata?: Json | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["job_event_type"]
          id?: string
          job_id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      job_match_attempts: {
        Row: {
          accepted_at: string | null
          attempt_number: number
          base_price: number | null
          contractor_id: string
          created_at: string
          declined_at: string | null
          effective_price: number | null
          expires_at: string | null
          frequency: string | null
          id: string
          offer_path: string | null
          offered_at: string
          outcome: string
          package_id: string | null
          package_tier_id: string | null
          promotion_id: string | null
          rank_order: number | null
          reason: string | null
          responded_at: string | null
          response_actor_id: string | null
          score: number | null
          score_breakdown: Json
          service_request_id: string
          updated_at: string
          withdrawn_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          attempt_number?: number
          base_price?: number | null
          contractor_id: string
          created_at?: string
          declined_at?: string | null
          effective_price?: number | null
          expires_at?: string | null
          frequency?: string | null
          id?: string
          offer_path?: string | null
          offered_at?: string
          outcome?: string
          package_id?: string | null
          package_tier_id?: string | null
          promotion_id?: string | null
          rank_order?: number | null
          reason?: string | null
          responded_at?: string | null
          response_actor_id?: string | null
          score?: number | null
          score_breakdown?: Json
          service_request_id: string
          updated_at?: string
          withdrawn_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          attempt_number?: number
          base_price?: number | null
          contractor_id?: string
          created_at?: string
          declined_at?: string | null
          effective_price?: number | null
          expires_at?: string | null
          frequency?: string | null
          id?: string
          offer_path?: string | null
          offered_at?: string
          outcome?: string
          package_id?: string | null
          package_tier_id?: string | null
          promotion_id?: string | null
          rank_order?: number | null
          reason?: string | null
          responded_at?: string | null
          response_actor_id?: string | null
          score?: number | null
          score_breakdown?: Json
          service_request_id?: string
          updated_at?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_match_attempts_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_attempts_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "vendor_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_attempts_package_tier_id_fkey"
            columns: ["package_tier_id"]
            isOneToOne: false
            referencedRelation: "package_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_attempts_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "package_promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_attempts_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      job_photos: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          job_visit_id: string | null
          photo_type: string
          photo_url: string
          service_request_id: string
          uploaded_by: string
          uploader_role: string
          visit_date: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          job_visit_id?: string | null
          photo_type?: string
          photo_url: string
          service_request_id: string
          uploaded_by: string
          uploader_role: string
          visit_date?: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          job_visit_id?: string | null
          photo_type?: string
          photo_url?: string
          service_request_id?: string
          uploaded_by?: string
          uploader_role?: string
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_photos_job_visit_id_fkey"
            columns: ["job_visit_id"]
            isOneToOne: false
            referencedRelation: "job_visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_photos_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      job_status_rejections: {
        Row: {
          actor_id: string | null
          context: Json | null
          created_at: string
          from_status: string | null
          id: string
          job_id: string | null
          reason: string
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          context?: Json | null
          created_at?: string
          from_status?: string | null
          id?: string
          job_id?: string | null
          reason: string
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          context?: Json | null
          created_at?: string
          from_status?: string | null
          id?: string
          job_id?: string | null
          reason?: string
          to_status?: string | null
        }
        Relationships: []
      }
      job_visits: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          scheduled_date: string
          service_request_id: string
          status: string
          updated_at: string
          vendor_notes: string | null
          visit_number: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          scheduled_date: string
          service_request_id: string
          status?: string
          updated_at?: string
          vendor_notes?: string | null
          visit_number: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          scheduled_date?: string
          service_request_id?: string
          status?: string
          updated_at?: string
          vendor_notes?: string | null
          visit_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_visits_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      lifecycle_worker_runs: {
        Row: {
          actor_id: string | null
          completed_at: string
          id: string
          summary: Json
        }
        Insert: {
          actor_id?: string | null
          completed_at?: string
          id: string
          summary: Json
        }
        Update: {
          actor_id?: string | null
          completed_at?: string
          id?: string
          summary?: Json
        }
        Relationships: []
      }
      loyalty_accounts: {
        Row: {
          created_at: string
          current_tier: Database["public"]["Enums"]["loyalty_tier"]
          id: string
          lifetime_points: number
          points_balance: number
          tier_updated_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_tier?: Database["public"]["Enums"]["loyalty_tier"]
          id?: string
          lifetime_points?: number
          points_balance?: number
          tier_updated_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_tier?: Database["public"]["Enums"]["loyalty_tier"]
          id?: string
          lifetime_points?: number
          points_balance?: number
          tier_updated_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      loyalty_redemptions: {
        Row: {
          created_at: string
          fulfilled_at: string | null
          id: string
          points_cost: number
          reward_id: string
          status: Database["public"]["Enums"]["redemption_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          fulfilled_at?: string | null
          id?: string
          points_cost: number
          reward_id: string
          status?: Database["public"]["Enums"]["redemption_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          fulfilled_at?: string | null
          id?: string
          points_cost?: number
          reward_id?: string
          status?: Database["public"]["Enums"]["redemption_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "loyalty_rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_rewards: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          min_tier: Database["public"]["Enums"]["loyalty_tier"]
          name: string
          points_cost: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          min_tier?: Database["public"]["Enums"]["loyalty_tier"]
          name: string
          points_cost: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          min_tier?: Database["public"]["Enums"]["loyalty_tier"]
          name?: string
          points_cost?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      loyalty_transactions: {
        Row: {
          created_at: string
          delta: number
          id: string
          metadata: Json | null
          reason: string
          source_id: string | null
          source_type: Database["public"]["Enums"]["loyalty_source_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          delta: number
          id?: string
          metadata?: Json | null
          reason: string
          source_id?: string | null
          source_type: Database["public"]["Enums"]["loyalty_source_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          delta?: number
          id?: string
          metadata?: Json | null
          reason?: string
          source_id?: string | null
          source_type?: Database["public"]["Enums"]["loyalty_source_type"]
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
          sender_role: string
          service_request_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
          sender_role: string
          service_request_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
          sender_role?: string
          service_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          related_contractor_id: string | null
          related_request_id: string | null
          severity: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          related_contractor_id?: string | null
          related_request_id?: string | null
          severity?: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          related_contractor_id?: string | null
          related_request_id?: string | null
          severity?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      package_addons: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_offered: boolean
          name: string | null
          package_id: string
          price: number
          sort_order: number
          template_addon_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_offered?: boolean
          name?: string | null
          package_id: string
          price?: number
          sort_order?: number
          template_addon_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_offered?: boolean
          name?: string | null
          package_id?: string
          price?: number
          sort_order?: number
          template_addon_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_addons_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "vendor_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_addons_template_addon_id_fkey"
            columns: ["template_addon_id"]
            isOneToOne: false
            referencedRelation: "pricing_template_addons"
            referencedColumns: ["id"]
          },
        ]
      }
      package_promotions: {
        Row: {
          created_at: string
          ends_at: string
          fixed_price: number | null
          id: string
          is_enabled: boolean
          label: string | null
          package_id: string
          percent_off: number | null
          promotion_type: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          fixed_price?: number | null
          id?: string
          is_enabled?: boolean
          label?: string | null
          package_id: string
          percent_off?: number | null
          promotion_type: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          fixed_price?: number | null
          id?: string
          is_enabled?: boolean
          label?: string | null
          package_id?: string
          percent_off?: number | null
          promotion_type?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_promotions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "vendor_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_qualifying_questions: {
        Row: {
          created_at: string
          id: string
          input_type: string
          is_required: boolean
          options: Json | null
          package_id: string
          question_key: string
          question_label: string
          sort_order: number
          unit: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          input_type?: string
          is_required?: boolean
          options?: Json | null
          package_id: string
          question_key: string
          question_label: string
          sort_order?: number
          unit?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          input_type?: string
          is_required?: boolean
          options?: Json | null
          package_id?: string
          question_key?: string
          question_label?: string
          sort_order?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "package_qualifying_questions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "vendor_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_tiers: {
        Row: {
          created_at: string
          frequency: string
          id: string
          includes: string[]
          name: string
          package_id: string
          price: number
          rule_max: number | null
          rule_min: number | null
          rule_question_key: string | null
          sort_order: number
          template_tier_id: string | null
        }
        Insert: {
          created_at?: string
          frequency?: string
          id?: string
          includes?: string[]
          name: string
          package_id: string
          price: number
          rule_max?: number | null
          rule_min?: number | null
          rule_question_key?: string | null
          sort_order?: number
          template_tier_id?: string | null
        }
        Update: {
          created_at?: string
          frequency?: string
          id?: string
          includes?: string[]
          name?: string
          package_id?: string
          price?: number
          rule_max?: number | null
          rule_min?: number | null
          rule_question_key?: string | null
          sort_order?: number
          template_tier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "package_tiers_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "vendor_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_tiers_template_tier_id_fkey"
            columns: ["template_tier_id"]
            isOneToOne: false
            referencedRelation: "pricing_template_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_template_addons: {
        Row: {
          addon_key: string
          created_at: string
          default_price: number
          description: string | null
          id: string
          label: string
          price_max: number
          price_min: number
          sort_order: number
          template_id: string
        }
        Insert: {
          addon_key: string
          created_at?: string
          default_price?: number
          description?: string | null
          id?: string
          label: string
          price_max?: number
          price_min?: number
          sort_order?: number
          template_id: string
        }
        Update: {
          addon_key?: string
          created_at?: string
          default_price?: number
          description?: string | null
          id?: string
          label?: string
          price_max?: number
          price_min?: number
          sort_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_template_addons_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "pricing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_template_questions: {
        Row: {
          created_at: string
          id: string
          input_type: string
          max_value: number | null
          min_value: number | null
          options: Json | null
          question_key: string
          question_label: string
          required: boolean
          sort_order: number
          template_id: string
          unit: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          input_type: string
          max_value?: number | null
          min_value?: number | null
          options?: Json | null
          question_key: string
          question_label: string
          required?: boolean
          sort_order?: number
          template_id: string
          unit?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          input_type?: string
          max_value?: number | null
          min_value?: number | null
          options?: Json | null
          question_key?: string
          question_label?: string
          required?: boolean
          sort_order?: number
          template_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_template_questions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "pricing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_template_tiers: {
        Row: {
          created_at: string
          description: string | null
          id: string
          includes: string[]
          max_price: number
          min_price: number
          name: string
          rule_json: Json
          sort_order: number
          suggested_price: number | null
          template_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          includes?: string[]
          max_price?: number
          min_price?: number
          name: string
          rule_json?: Json
          sort_order?: number
          suggested_price?: number | null
          template_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          includes?: string[]
          max_price?: number
          min_price?: number
          name?: string
          rule_json?: Json
          sort_order?: number
          suggested_price?: number | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_template_tiers_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "pricing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_templates: {
        Row: {
          created_at: string
          description: string | null
          guardrail_json: Json
          id: string
          is_active: boolean
          name: string
          service_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          guardrail_json?: Json
          id?: string
          is_active?: boolean
          name: string
          service_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          guardrail_json?: Json
          id?: string
          is_active?: boolean
          name?: string
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_templates_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          city: string | null
          created_at: string
          full_name: string
          id: string
          phone: string | null
          referral_code: string | null
          state: string | null
          stripe_customer_id: string | null
          updated_at: string
          user_id: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          city?: string | null
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          referral_code?: string | null
          state?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
          user_id: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          city?: string | null
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          referral_code?: string | null
          state?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
          user_id?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      quality_feedback: {
        Row: {
          communication: number
          contractor_id: string
          created_at: string
          customer_id: string
          id: string
          internal_notes: string | null
          punctuality: number
          service_request_id: string
          workmanship: number
          would_recommend: boolean
        }
        Insert: {
          communication: number
          contractor_id: string
          created_at?: string
          customer_id: string
          id?: string
          internal_notes?: string | null
          punctuality: number
          service_request_id: string
          workmanship: number
          would_recommend?: boolean
        }
        Update: {
          communication?: number
          contractor_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          internal_notes?: string | null
          punctuality?: number
          service_request_id?: string
          workmanship?: number
          would_recommend?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "quality_feedback_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_feedback_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: true
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          first_service_at: string | null
          id: string
          referral_code: string
          referred_email: string | null
          referred_user_id: string | null
          referrer_user_id: string
          service_points_awarded: boolean
          signed_up_at: string | null
          signup_points_awarded: boolean
        }
        Insert: {
          created_at?: string
          first_service_at?: string | null
          id?: string
          referral_code: string
          referred_email?: string | null
          referred_user_id?: string | null
          referrer_user_id: string
          service_points_awarded?: boolean
          signed_up_at?: string | null
          signup_points_awarded?: boolean
        }
        Update: {
          created_at?: string
          first_service_at?: string | null
          id?: string
          referral_code?: string
          referred_email?: string | null
          referred_user_id?: string | null
          referrer_user_id?: string
          service_points_awarded?: boolean
          signed_up_at?: string | null
          signup_points_awarded?: boolean
        }
        Relationships: []
      }
      reviews: {
        Row: {
          comment: string | null
          contractor_id: string
          created_at: string
          customer_id: string
          google_prompt_clicked: boolean
          google_prompt_shown: boolean
          id: string
          rating: number
          service_request_id: string
          vendor_acknowledged_at: string | null
          visibility: Database["public"]["Enums"]["review_visibility"]
        }
        Insert: {
          comment?: string | null
          contractor_id: string
          created_at?: string
          customer_id: string
          google_prompt_clicked?: boolean
          google_prompt_shown?: boolean
          id?: string
          rating: number
          service_request_id: string
          vendor_acknowledged_at?: string | null
          visibility?: Database["public"]["Enums"]["review_visibility"]
        }
        Update: {
          comment?: string | null
          contractor_id?: string
          created_at?: string
          customer_id?: string
          google_prompt_clicked?: boolean
          google_prompt_shown?: boolean
          id?: string
          rating?: number
          service_request_id?: string
          vendor_acknowledged_at?: string | null
          visibility?: Database["public"]["Enums"]["review_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "reviews_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: true
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      service_categories: {
        Row: {
          created_at: string
          description: string
          icon: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          icon?: string
          id: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          icon?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      service_requests: {
        Row: {
          address: string
          assigned_at: string | null
          base_amount: number | null
          city: string
          confirmation_deadline_at: string | null
          confirmation_due_at: string | null
          confirmation_sent_at: string | null
          contractor_id: string | null
          created_at: string
          customer_id: string
          declined_contractor_ids: string[]
          description: string | null
          dispute_reason: string | null
          dispute_resolution: string | null
          dispute_resolved_at: string | null
          disputed: boolean
          disputed_at: string | null
          frequency: string
          homeowner_confirmed_at: string | null
          id: string
          last_match_expired_at: string | null
          match_attempt_count: number
          match_expires_at: string | null
          matching_status: string
          needs_admin_review: boolean
          notes: string | null
          package_answers: Json | null
          package_id: string | null
          package_question_answers: Json
          package_tier_id: string | null
          payment_captured_at: string | null
          payment_status: Database["public"]["Enums"]["job_payment_status"]
          photo_proof_urls: string[]
          platform_fee: number | null
          preferred_contractor_id: string | null
          preferred_date: string | null
          preferred_time: string | null
          pricing_inputs: Json | null
          pricing_mode: string
          promotion_id: string | null
          quote_amount: number | null
          quote_approved_at: string | null
          quote_declined_at: string | null
          quote_only: boolean
          resolved_price: number | null
          review_request_due_at: string | null
          review_requested_at: string | null
          service_catalog_id: string | null
          service_type: string
          state: string
          status: Database["public"]["Enums"]["request_status"]
          stripe_subscription_id: string | null
          stripe_subscription_status: string | null
          timezone: string
          total_amount: number | null
          updated_at: string
          vendor_completed_at: string | null
          vendor_reminder_sent_at: string | null
          zip_code: string | null
        }
        Insert: {
          address: string
          assigned_at?: string | null
          base_amount?: number | null
          city?: string
          confirmation_deadline_at?: string | null
          confirmation_due_at?: string | null
          confirmation_sent_at?: string | null
          contractor_id?: string | null
          created_at?: string
          customer_id: string
          declined_contractor_ids?: string[]
          description?: string | null
          dispute_reason?: string | null
          dispute_resolution?: string | null
          dispute_resolved_at?: string | null
          disputed?: boolean
          disputed_at?: string | null
          frequency?: string
          homeowner_confirmed_at?: string | null
          id?: string
          last_match_expired_at?: string | null
          match_attempt_count?: number
          match_expires_at?: string | null
          matching_status?: string
          needs_admin_review?: boolean
          notes?: string | null
          package_answers?: Json | null
          package_id?: string | null
          package_question_answers?: Json
          package_tier_id?: string | null
          payment_captured_at?: string | null
          payment_status?: Database["public"]["Enums"]["job_payment_status"]
          photo_proof_urls?: string[]
          platform_fee?: number | null
          preferred_contractor_id?: string | null
          preferred_date?: string | null
          preferred_time?: string | null
          pricing_inputs?: Json | null
          pricing_mode?: string
          promotion_id?: string | null
          quote_amount?: number | null
          quote_approved_at?: string | null
          quote_declined_at?: string | null
          quote_only?: boolean
          resolved_price?: number | null
          review_request_due_at?: string | null
          review_requested_at?: string | null
          service_catalog_id?: string | null
          service_type: string
          state?: string
          status?: Database["public"]["Enums"]["request_status"]
          stripe_subscription_id?: string | null
          stripe_subscription_status?: string | null
          timezone?: string
          total_amount?: number | null
          updated_at?: string
          vendor_completed_at?: string | null
          vendor_reminder_sent_at?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string
          assigned_at?: string | null
          base_amount?: number | null
          city?: string
          confirmation_deadline_at?: string | null
          confirmation_due_at?: string | null
          confirmation_sent_at?: string | null
          contractor_id?: string | null
          created_at?: string
          customer_id?: string
          declined_contractor_ids?: string[]
          description?: string | null
          dispute_reason?: string | null
          dispute_resolution?: string | null
          dispute_resolved_at?: string | null
          disputed?: boolean
          disputed_at?: string | null
          frequency?: string
          homeowner_confirmed_at?: string | null
          id?: string
          last_match_expired_at?: string | null
          match_attempt_count?: number
          match_expires_at?: string | null
          matching_status?: string
          needs_admin_review?: boolean
          notes?: string | null
          package_answers?: Json | null
          package_id?: string | null
          package_question_answers?: Json
          package_tier_id?: string | null
          payment_captured_at?: string | null
          payment_status?: Database["public"]["Enums"]["job_payment_status"]
          photo_proof_urls?: string[]
          platform_fee?: number | null
          preferred_contractor_id?: string | null
          preferred_date?: string | null
          preferred_time?: string | null
          pricing_inputs?: Json | null
          pricing_mode?: string
          promotion_id?: string | null
          quote_amount?: number | null
          quote_approved_at?: string | null
          quote_declined_at?: string | null
          quote_only?: boolean
          resolved_price?: number | null
          review_request_due_at?: string | null
          review_requested_at?: string | null
          service_catalog_id?: string | null
          service_type?: string
          state?: string
          status?: Database["public"]["Enums"]["request_status"]
          stripe_subscription_id?: string | null
          stripe_subscription_status?: string | null
          timezone?: string
          total_amount?: number | null
          updated_at?: string
          vendor_completed_at?: string | null
          vendor_reminder_sent_at?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_requests_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "vendor_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_package_tier_id_fkey"
            columns: ["package_tier_id"]
            isOneToOne: false
            referencedRelation: "package_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_preferred_contractor_id_fkey"
            columns: ["preferred_contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "package_promotions"
            referencedColumns: ["id"]
          },
        ]
      }
      services_catalog: {
        Row: {
          available_frequencies: string[]
          category_id: string
          created_at: string
          default_deposit_amount: number | null
          default_frequency: string
          descriptor: string
          icon: string
          id: string
          is_active: boolean
          is_popular: boolean
          monthly_price: number
          name: string
          one_time_price: number
          pricing_mode: string
          sort_order: number
          tags: string[]
          updated_at: string
          weekly_price: number | null
        }
        Insert: {
          available_frequencies?: string[]
          category_id: string
          created_at?: string
          default_deposit_amount?: number | null
          default_frequency?: string
          descriptor?: string
          icon?: string
          id: string
          is_active?: boolean
          is_popular?: boolean
          monthly_price?: number
          name: string
          one_time_price?: number
          pricing_mode?: string
          sort_order?: number
          tags?: string[]
          updated_at?: string
          weekly_price?: number | null
        }
        Update: {
          available_frequencies?: string[]
          category_id?: string
          created_at?: string
          default_deposit_amount?: number | null
          default_frequency?: string
          descriptor?: string
          icon?: string
          id?: string
          is_active?: boolean
          is_popular?: boolean
          monthly_price?: number
          name?: string
          one_time_price?: number
          pricing_mode?: string
          sort_order?: number
          tags?: string[]
          updated_at?: string
          weekly_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "services_catalog_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_picks: {
        Row: {
          bonus_description: string | null
          contractor_id: string
          created_at: string
          custom_highlight: string | null
          id: string
          is_active: boolean
          pick_type: string
          service_id: string
          updated_at: string
        }
        Insert: {
          bonus_description?: string | null
          contractor_id: string
          created_at?: string
          custom_highlight?: string | null
          id?: string
          is_active?: boolean
          pick_type: string
          service_id: string
          updated_at?: string
        }
        Update: {
          bonus_description?: string | null
          contractor_id?: string
          created_at?: string
          custom_highlight?: string | null
          id?: string
          is_active?: boolean
          pick_type?: string
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "smart_picks_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          processed_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          processed_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          processed_at?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          created_at: string
          description: string
          id: string
          issue_type: string
          job_id: string | null
          status: string
          subject: string
          ticket_number: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          issue_type: string
          job_id?: string | null
          status?: string
          subject: string
          ticket_number: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          issue_type?: string
          job_id?: string | null
          status?: string
          subject?: string
          ticket_number?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendor_applications: {
        Row: {
          activated_at: string | null
          additional_notes: string | null
          address: string | null
          availability: string | null
          business_description: string | null
          business_name: string
          contractor_id: string | null
          created_at: string
          credentials: string[]
          document_urls: string[]
          email: string
          first_name: string
          id: string
          insurance_policy_number: string | null
          invite_error: string | null
          invite_expires_at: string | null
          invite_status: string
          invited_at: string | null
          invited_user_id: string | null
          last_name: string
          license_number: string | null
          other_certification: string | null
          phone: string
          preferred_contact: string | null
          primary_category: string | null
          service_areas: string | null
          services: string[]
          status: string
          team_size: string | null
          updated_at: string
          website: string | null
          years_experience: number
        }
        Insert: {
          activated_at?: string | null
          additional_notes?: string | null
          address?: string | null
          availability?: string | null
          business_description?: string | null
          business_name: string
          contractor_id?: string | null
          created_at?: string
          credentials?: string[]
          document_urls?: string[]
          email: string
          first_name: string
          id?: string
          insurance_policy_number?: string | null
          invite_error?: string | null
          invite_expires_at?: string | null
          invite_status?: string
          invited_at?: string | null
          invited_user_id?: string | null
          last_name: string
          license_number?: string | null
          other_certification?: string | null
          phone: string
          preferred_contact?: string | null
          primary_category?: string | null
          service_areas?: string | null
          services?: string[]
          status?: string
          team_size?: string | null
          updated_at?: string
          website?: string | null
          years_experience?: number
        }
        Update: {
          activated_at?: string | null
          additional_notes?: string | null
          address?: string | null
          availability?: string | null
          business_description?: string | null
          business_name?: string
          contractor_id?: string | null
          created_at?: string
          credentials?: string[]
          document_urls?: string[]
          email?: string
          first_name?: string
          id?: string
          insurance_policy_number?: string | null
          invite_error?: string | null
          invite_expires_at?: string | null
          invite_status?: string
          invited_at?: string | null
          invited_user_id?: string | null
          last_name?: string
          license_number?: string | null
          other_certification?: string | null
          phone?: string
          preferred_contact?: string | null
          primary_category?: string | null
          service_areas?: string | null
          services?: string[]
          status?: string
          team_size?: string | null
          updated_at?: string
          website?: string | null
          years_experience?: number
        }
        Relationships: [
          {
            foreignKeyName: "vendor_applications_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_packages: {
        Row: {
          contractor_id: string
          created_at: string
          default_frequency: string
          deposit_amount: number | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          needs_review: boolean
          pricing_mode: string
          service_id: string
          sort_order: number
          template_id: string | null
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          default_frequency?: string
          deposit_amount?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          needs_review?: boolean
          pricing_mode?: string
          service_id: string
          sort_order?: number
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          default_frequency?: string
          deposit_amount?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          needs_review?: boolean
          pricing_mode?: string
          service_id?: string
          sort_order?: number
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_packages_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_packages_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_packages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "pricing_templates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_assign_contractor: {
        Args: { _contractor_id: string; _job_id: string }
        Returns: undefined
      }
      admin_get_contractor_linked_email: {
        Args: { _contractor_id: string }
        Returns: string
      }
      admin_link_contractor_to_user: {
        Args: { _contractor_id: string; _email: string }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      admin_list_contractor_contacts: {
        Args: never
        Returns: {
          email: string
          id: string
          phone: string
        }[]
      }
      admin_resolve_dispute: {
        Args: {
          _dispute_id: string
          _notes: string
          _status: Database["public"]["Enums"]["dispute_status"]
        }
        Returns: undefined
      }
      admin_send_quote: {
        Args: { _amount: number; _job_id: string; _reason?: string }
        Returns: undefined
      }
      admin_unlink_contractor: {
        Args: { _contractor_id: string }
        Returns: undefined
      }
      award_points: {
        Args: {
          _delta: number
          _metadata?: Json
          _reason: string
          _source_id?: string
          _source_type: Database["public"]["Enums"]["loyalty_source_type"]
          _user_id: string
        }
        Returns: undefined
      }
      create_job_offer: {
        Args: {
          _contractor_id: string
          _force?: boolean
          _package_id?: string
          _package_tier_id?: string
          _request_id: string
        }
        Returns: string
      }
      custom_package_price_needs_review: {
        Args: { _package_id: string }
        Returns: boolean
      }
      expire_stale_matches: { Args: never; Returns: number }
      find_eligible_packages: {
        Args: {
          _frequency?: string
          _preferred_contractor_id?: string
          _request_id?: string
          _service_id?: string
          _zip_code?: string
        }
        Returns: {
          base_price: number
          contractor_id: string
          contractor_name: string
          effective_price: number
          fixed_score: number
          frequency: string
          freshness_score: number
          median_fixed_price: number
          package_id: string
          package_tier_id: string
          path: string
          preferred: boolean
          price_band_score: number
          profile_score: number
          promotion_id: string
          rank_order: number
          response_score: number
          score_breakdown: Json
          total_score: number
          verification_score: number
        }[]
      }
      find_public_eligible_providers: {
        Args: { _frequency: string; _service_id: string; _zip_code: string }
        Returns: {
          area_hint: string
          badges: string[]
          base_price: number
          contractor_id: string
          contractor_name: string
          effective_price: number
          frequency: string
          logo_url: string
          package_id: string
          package_tier_id: string
          path: string
          promotion_id: string
          rank_order: number
        }[]
      }
      get_completed_job_counts: {
        Args: { _contractor_ids: string[] }
        Returns: {
          completed_jobs: number
          contractor_id: string
        }[]
      }
      get_contractor_contact: {
        Args: { _contractor_id: string }
        Returns: {
          email: string
          phone: string
        }[]
      }
      get_vendor_earnings_metrics: {
        Args: { _contractor_id: string }
        Returns: {
          current_month_earned: number
          current_month_invoice_count: number
          lifetime_earned: number
          missing_payout_count: number
          released_invoice_count: number
          untracked_release_count: number
        }[]
      }
      get_vendor_operational_metrics: {
        Args: { _contractor_id: string }
        Returns: {
          accepted_opportunities: number
          decided_opportunities: number
          median_response_minutes: number
          response_sample_size: number
          win_rate: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      homeowner_confirm_job: { Args: { _job_id: string }; Returns: undefined }
      homeowner_raise_dispute: {
        Args: { _job_id: string; _reason: string }
        Returns: string
      }
      homeowner_respond_to_quote: {
        Args: { _approve: boolean; _job_id: string }
        Returns: undefined
      }
      job_transition_actor_allowed: {
        Args: {
          _actor: string
          _to: Database["public"]["Enums"]["request_status"]
        }
        Returns: boolean
      }
      job_transition_allowed: {
        Args: {
          _from: Database["public"]["Enums"]["request_status"]
          _to: Database["public"]["Enums"]["request_status"]
        }
        Returns: boolean
      }
      log_job_event: {
        Args: {
          _actor?: string
          _job_id: string
          _meta?: Json
          _type: Database["public"]["Enums"]["job_event_type"]
        }
        Returns: undefined
      }
      log_status_rejection: {
        Args: {
          _ctx?: Json
          _from: string
          _job_id: string
          _reason: string
          _to: string
        }
        Returns: undefined
      }
      notify_user: {
        Args: {
          _body: string
          _contractor_id?: string
          _link: string
          _request_id?: string
          _severity: string
          _title: string
          _type: string
          _user_id: string
        }
        Returns: undefined
      }
      offer_next_for_request: { Args: { _request_id: string }; Returns: string }
      pricing_server_now: { Args: never; Returns: string }
      release_job_match: {
        Args: {
          _contractor_id: string
          _job_id: string
          _outcome: string
          _reason: string
        }
        Returns: undefined
      }
      resolve_package_tier_price: {
        Args: { p_package_id: string; p_tier_id: string }
        Returns: {
          base_price: number
          effective_price: number
          promotion_id: string
          promotion_label: string
        }[]
      }
      run_lifecycle_batch: {
        Args: { _actor_id?: string; _run_id: string }
        Returns: Json
      }
      start_request_matching: { Args: { _request_id: string }; Returns: string }
      submit_job_review: {
        Args: { _comment: string; _job_id: string; _rating: number }
        Returns: {
          review_id: string
          visibility: Database["public"]["Enums"]["review_visibility"]
        }[]
      }
      tier_for_points: {
        Args: { _pts: number }
        Returns: Database["public"]["Enums"]["loyalty_tier"]
      }
      track_google_prompt: {
        Args: { _clicked: boolean; _review_id: string }
        Returns: undefined
      }
      transition_job_status: {
        Args: {
          _job_id: string
          _metadata?: Json
          _reason?: string
          _to_status: Database["public"]["Enums"]["request_status"]
        }
        Returns: Database["public"]["Enums"]["request_status"]
      }
      vendor_accept_job: { Args: { _job_id: string }; Returns: undefined }
      vendor_complete_job: {
        Args: { _job_id: string; _photo_urls: string[] }
        Returns: undefined
      }
      vendor_decline_job: {
        Args: { _job_id: string; _reason?: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "moderator"
        | "user"
        | "homeowner"
        | "vendor"
        | "business"
      dispute_status: "open" | "vendor_contacted" | "resolved" | "escalated"
      invoice_status:
        | "draft"
        | "sent"
        | "paid"
        | "overdue"
        | "cancelled"
        | "refunded"
        | "pending"
        | "pending_release"
        | "released"
        | "disputed"
      job_event_type:
        | "job_completed_by_vendor"
        | "confirmation_sent"
        | "confirmation_received"
        | "dispute_opened"
        | "dispute_resolved"
        | "review_requested"
        | "review_submitted"
        | "vendor_reminder_sent"
        | "auto_completed_by_timer"
        | "flagged_for_admin_review"
        | "match_offered"
        | "match_declined"
        | "match_expired"
        | "match_reassigned"
        | "status_changed"
      job_payment_status: "pending" | "captured" | "released" | "refunded"
      loyalty_source_type:
        | "review"
        | "job"
        | "bundle"
        | "referral"
        | "redemption"
        | "profile"
        | "adjustment"
      loyalty_tier: "bronze" | "silver" | "gold" | "platinum"
      redemption_status: "pending" | "fulfilled" | "cancelled"
      request_status:
        | "pending"
        | "matched"
        | "quoted"
        | "scheduled"
        | "in_progress"
        | "pending_review"
        | "completed"
        | "cancelled"
        | "vendor_completed"
        | "homeowner_confirmed"
        | "disputed"
        | "resolved"
        | "review_requested"
        | "reviewed"
        | "closed"
      review_visibility: "internal_only" | "eligible_for_google"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "admin",
        "moderator",
        "user",
        "homeowner",
        "vendor",
        "business",
      ],
      dispute_status: ["open", "vendor_contacted", "resolved", "escalated"],
      invoice_status: [
        "draft",
        "sent",
        "paid",
        "overdue",
        "cancelled",
        "refunded",
        "pending",
        "pending_release",
        "released",
        "disputed",
      ],
      job_event_type: [
        "job_completed_by_vendor",
        "confirmation_sent",
        "confirmation_received",
        "dispute_opened",
        "dispute_resolved",
        "review_requested",
        "review_submitted",
        "vendor_reminder_sent",
        "auto_completed_by_timer",
        "flagged_for_admin_review",
        "match_offered",
        "match_declined",
        "match_expired",
        "match_reassigned",
        "status_changed",
      ],
      job_payment_status: ["pending", "captured", "released", "refunded"],
      loyalty_source_type: [
        "review",
        "job",
        "bundle",
        "referral",
        "redemption",
        "profile",
        "adjustment",
      ],
      loyalty_tier: ["bronze", "silver", "gold", "platinum"],
      redemption_status: ["pending", "fulfilled", "cancelled"],
      request_status: [
        "pending",
        "matched",
        "quoted",
        "scheduled",
        "in_progress",
        "pending_review",
        "completed",
        "cancelled",
        "vendor_completed",
        "homeowner_confirmed",
        "disputed",
        "resolved",
        "review_requested",
        "reviewed",
        "closed",
      ],
      review_visibility: ["internal_only", "eligible_for_google"],
    },
  },
} as const


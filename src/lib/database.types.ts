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
      album_items: {
        Row: {
          added_by_id: string
          album_id: string
          caption: string
          created_at: string
          id: string
          media_type: string
          order: number
          url: string
        }
        Insert: {
          added_by_id: string
          album_id: string
          caption?: string
          created_at?: string
          id?: string
          media_type: string
          order?: number
          url: string
        }
        Update: {
          added_by_id?: string
          album_id?: string
          caption?: string
          created_at?: string
          id?: string
          media_type?: string
          order?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "album_items_added_by_id_fkey"
            columns: ["added_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "album_items_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
        ]
      }
      albums: {
        Row: {
          cover_item_id: string | null
          created_at: string
          created_by_id: string
          description: string
          group_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          cover_item_id?: string | null
          created_at?: string
          created_by_id: string
          description?: string
          group_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          cover_item_id?: string | null
          created_at?: string
          created_by_id?: string
          description?: string
          group_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "albums_cover_item_fk"
            columns: ["cover_item_id"]
            isOneToOne: false
            referencedRelation: "album_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "albums_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "albums_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      availabilities: {
        Row: {
          created_at: string
          event_kind: Database["public"]["Enums"]["availability_event_kind"]
          id: string
          lineup_slot: string
          match_id: string | null
          match_types: string
          practice_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_kind: Database["public"]["Enums"]["availability_event_kind"]
          id?: string
          lineup_slot?: string
          match_id?: string | null
          match_types?: string
          practice_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_kind?: Database["public"]["Enums"]["availability_event_kind"]
          id?: string
          lineup_slot?: string
          match_id?: string | null
          match_types?: string
          practice_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availabilities_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "team_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availabilities_practice_id_fkey"
            columns: ["practice_id"]
            isOneToOne: false
            referencedRelation: "team_practices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availabilities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_players: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          status: Database["public"]["Enums"]["booking_player_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["booking_player_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["booking_player_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_players_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          active_net_url: string
          court_id: string
          created_at: string
          end_time: string
          id: string
          organizer_id: string
          start_time: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          active_net_url?: string
          court_id: string
          created_at?: string
          end_time: string
          id?: string
          organizer_id: string
          start_time: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          active_net_url?: string
          court_id?: string
          created_at?: string
          end_time?: string
          id?: string
          organizer_id?: string
          start_time?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "venue_courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          expense_id: string | null
          id: string
          media_type: string
          media_url: string
          sender_id: string
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          expense_id?: string | null
          id?: string
          media_type?: string
          media_url?: string
          sender_id: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          expense_id?: string | null
          id?: string
          media_type?: string
          media_url?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_participants: {
        Row: {
          chat_id: string
          cleared_at: string | null
          hidden_at: string | null
          id: string
          joined_at: string
          last_read_at: string
          muted: boolean
          pinned_at: string | null
          user_id: string
        }
        Insert: {
          chat_id: string
          cleared_at?: string | null
          hidden_at?: string | null
          id?: string
          joined_at?: string
          last_read_at?: string
          muted?: boolean
          pinned_at?: string | null
          user_id: string
        }
        Update: {
          chat_id?: string
          cleared_at?: string | null
          hidden_at?: string | null
          id?: string
          joined_at?: string
          last_read_at?: string
          muted?: boolean
          pinned_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_participants_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          created_at: string
          creator_id: string
          friend_group_id: string | null
          id: string
          manual_player_names: string
          name: string
          post_id: string | null
          session_end_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          friend_group_id?: string | null
          id?: string
          manual_player_names?: string
          name?: string
          post_id?: string | null
          session_end_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          friend_group_id?: string | null
          id?: string
          manual_player_names?: string
          name?: string
          post_id?: string | null
          session_end_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_friend_group_id_fkey"
            columns: ["friend_group_id"]
            isOneToOne: true
            referencedRelation: "friend_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          parent_comment_id: string | null
          post_id: string
          updated_at: string | null
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          post_id: string
          updated_at?: string | null
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          post_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      court_availability_reports: {
        Row: {
          court_id: string
          has_empty: boolean
          id: string
          post_id: string | null
          reported_at: string
          user_id: string
        }
        Insert: {
          court_id: string
          has_empty: boolean
          id?: string
          post_id?: string | null
          reported_at?: string
          user_id: string
        }
        Update: {
          court_id?: string
          has_empty?: boolean
          id?: string
          post_id?: string | null
          reported_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_availability_reports_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_availability_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      court_review_photos: {
        Row: {
          created_at: string
          id: string
          order: number
          review_id: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          order?: number
          review_id: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          order?: number
          review_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_review_photos_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "court_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      court_reviews: {
        Row: {
          content: string
          court_id: string
          created_at: string
          id: string
          stars: number
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          court_id: string
          created_at?: string
          id?: string
          stars: number
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          court_id?: string
          created_at?: string
          id?: string
          stars?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      courts: {
        Row: {
          added_by_id: string
          created_at: string
          id: string
          latitude: number
          location: unknown
          longitude: number
          name: string
          notes: string
        }
        Insert: {
          added_by_id: string
          created_at?: string
          id?: string
          latitude: number
          location?: unknown
          longitude: number
          name: string
          notes?: string
        }
        Update: {
          added_by_id?: string
          created_at?: string
          id?: string
          latitude?: number
          location?: unknown
          longitude?: number
          name?: string
          notes?: string
        }
        Relationships: [
          {
            foreignKeyName: "courts_added_by_id_fkey"
            columns: ["added_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      device_tokens: {
        Row: {
          created_at: string
          id: string
          platform: Database["public"]["Enums"]["device_platform"]
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform: Database["public"]["Enums"]["device_platform"]
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platform?: Database["public"]["Enums"]["device_platform"]
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_message_reads: {
        Row: {
          cleared_at: string | null
          hidden_at: string | null
          id: string
          last_read_at: string
          muted: boolean
          other_id: string
          pinned_at: string | null
          user_id: string
        }
        Insert: {
          cleared_at?: string | null
          hidden_at?: string | null
          id?: string
          last_read_at?: string
          muted?: boolean
          other_id: string
          pinned_at?: string | null
          user_id: string
        }
        Update: {
          cleared_at?: string | null
          hidden_at?: string | null
          id?: string
          last_read_at?: string
          muted?: boolean
          other_id?: string
          pinned_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_message_reads_other_id_fkey"
            columns: ["other_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_message_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      edge_function_dispatch_log: {
        Row: {
          body: Json
          created_at: string
          fn_name: string
          id: string
          request_id: number | null
        }
        Insert: {
          body: Json
          created_at?: string
          fn_name: string
          id?: string
          request_id?: number | null
        }
        Update: {
          body?: Json
          created_at?: string
          fn_name?: string
          id?: string
          request_id?: number | null
        }
        Relationships: []
      }
      event_matches: {
        Row: {
          bracket_slot: string
          confirmed_by: string | null
          court_assign: string
          created_at: string
          disputed_at: string | null
          event_id: string
          id: string
          player1_id: string | null
          player2_id: string | null
          player3_id: string | null
          player4_id: string | null
          proposed_by: string | null
          reported_by: string | null
          round: number | null
          scheduled_at: string | null
          score: string
          status: Database["public"]["Enums"]["event_match_status"]
          winner_side: number | null
        }
        Insert: {
          bracket_slot?: string
          confirmed_by?: string | null
          court_assign?: string
          created_at?: string
          disputed_at?: string | null
          event_id: string
          id?: string
          player1_id?: string | null
          player2_id?: string | null
          player3_id?: string | null
          player4_id?: string | null
          proposed_by?: string | null
          reported_by?: string | null
          round?: number | null
          scheduled_at?: string | null
          score?: string
          status?: Database["public"]["Enums"]["event_match_status"]
          winner_side?: number | null
        }
        Update: {
          bracket_slot?: string
          confirmed_by?: string | null
          court_assign?: string
          created_at?: string
          disputed_at?: string | null
          event_id?: string
          id?: string
          player1_id?: string | null
          player2_id?: string | null
          player3_id?: string | null
          player4_id?: string | null
          proposed_by?: string | null
          reported_by?: string | null
          round?: number | null
          scheduled_at?: string | null
          score?: string
          status?: Database["public"]["Enums"]["event_match_status"]
          winner_side?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_matches_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_matches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_matches_player1_id_fkey"
            columns: ["player1_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_matches_player2_id_fkey"
            columns: ["player2_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_matches_player3_id_fkey"
            columns: ["player3_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_matches_player4_id_fkey"
            columns: ["player4_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_matches_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_matches_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_participants: {
        Row: {
          checked_in_at: string | null
          event_id: string
          id: string
          ladder_rank: number | null
          losses: number
          points: number
          registered_at: string
          sets_lost: number
          sets_won: number
          status: Database["public"]["Enums"]["event_participant_status"]
          user_id: string
          wins: number
        }
        Insert: {
          checked_in_at?: string | null
          event_id: string
          id?: string
          ladder_rank?: number | null
          losses?: number
          points?: number
          registered_at?: string
          sets_lost?: number
          sets_won?: number
          status?: Database["public"]["Enums"]["event_participant_status"]
          user_id: string
          wins?: number
        }
        Update: {
          checked_in_at?: string | null
          event_id?: string
          id?: string
          ladder_rank?: number | null
          losses?: number
          points?: number
          registered_at?: string
          sets_lost?: number
          sets_won?: number
          status?: Database["public"]["Enums"]["event_participant_status"]
          user_id?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          config: Json
          cover_image_url: string
          created_at: string
          description: string
          end_date: string
          event_lat: number | null
          event_lng: number | null
          event_location: unknown
          event_type: string
          host_group_id: string | null
          id: string
          is_public_signup: boolean
          max_participants: number | null
          ntrp_max: number | null
          ntrp_min: number | null
          owner_id: string
          radius_mi: number | null
          season_id: string | null
          signup_deadline: string | null
          start_date: string
          status: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at: string
          venue_address: string
          venue_name: string
          visibility: Database["public"]["Enums"]["event_visibility"]
        }
        Insert: {
          config?: Json
          cover_image_url?: string
          created_at?: string
          description?: string
          end_date: string
          event_lat?: number | null
          event_lng?: number | null
          event_location?: unknown
          event_type: string
          host_group_id?: string | null
          id?: string
          is_public_signup?: boolean
          max_participants?: number | null
          ntrp_max?: number | null
          ntrp_min?: number | null
          owner_id: string
          radius_mi?: number | null
          season_id?: string | null
          signup_deadline?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at?: string
          venue_address?: string
          venue_name?: string
          visibility?: Database["public"]["Enums"]["event_visibility"]
        }
        Update: {
          config?: Json
          cover_image_url?: string
          created_at?: string
          description?: string
          end_date?: string
          event_lat?: number | null
          event_lng?: number | null
          event_location?: unknown
          event_type?: string
          host_group_id?: string | null
          id?: string
          is_public_signup?: boolean
          max_participants?: number | null
          ntrp_max?: number | null
          ntrp_min?: number | null
          owner_id?: string
          radius_mi?: number | null
          season_id?: string | null
          signup_deadline?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["event_status"]
          title?: string
          updated_at?: string
          venue_address?: string
          venue_name?: string
          visibility?: Database["public"]["Enums"]["event_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "events_host_group_id_fkey"
            columns: ["host_group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_shares: {
        Row: {
          amount_cents: number
          expense_id: string
          guest_name: string | null
          id: string
          settled_at: string | null
          user_id: string | null
        }
        Insert: {
          amount_cents: number
          expense_id: string
          guest_name?: string | null
          id?: string
          settled_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          expense_id?: string
          guest_name?: string | null
          id?: string
          settled_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_shares_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_cents: number
          chat_id: string
          created_at: string
          description: string
          id: string
          payer_id: string
        }
        Insert: {
          amount_cents: number
          chat_id: string
          created_at?: string
          description?: string
          id?: string
          payer_id: string
        }
        Update: {
          amount_cents?: number
          chat_id?: string
          created_at?: string
          description?: string
          id?: string
          payer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_pin_overrides: {
        Row: {
          court_id: string
          latitude: number
          longitude: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          court_id: string
          latitude: number
          longitude: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          court_id?: string
          latitude?: number
          longitude?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facility_pin_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friend_group_members: {
        Row: {
          created_at: string
          friend_group_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          friend_group_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          friend_group_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_group_members_friend_group_id_fkey"
            columns: ["friend_group_id"]
            isOneToOne: false
            referencedRelation: "friend_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friend_group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friend_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_groups_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          addressee_id: string
          created_at: string
          id: string
          requester_id: string
          status: Database["public"]["Enums"]["friendship_status"]
          updated_at: string
        }
        Insert: {
          addressee_id: string
          created_at?: string
          id?: string
          requester_id: string
          status?: Database["public"]["Enums"]["friendship_status"]
          updated_at?: string
        }
        Update: {
          addressee_id?: string
          created_at?: string
          id?: string
          requester_id?: string
          status?: Database["public"]["Enums"]["friendship_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_files: {
        Row: {
          created_at: string
          description: string
          filename: string
          group_id: string
          id: string
          mime_type: string
          size_bytes: number
          uploaded_by_id: string
          url: string
        }
        Insert: {
          created_at?: string
          description?: string
          filename: string
          group_id: string
          id?: string
          mime_type?: string
          size_bytes?: number
          uploaded_by_id: string
          url: string
        }
        Update: {
          created_at?: string
          description?: string
          filename?: string
          group_id?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          uploaded_by_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_files_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_files_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_invites: {
        Row: {
          accepted_at: string | null
          accepted_by_id: string | null
          created_at: string
          email: string
          expires_at: string
          group_id: string
          id: string
          invited_by_id: string
          member_type: string
          roles: Database["public"]["Enums"]["group_member_role"][]
          status: Database["public"]["Enums"]["group_invite_status"]
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_id?: string | null
          created_at?: string
          email: string
          expires_at: string
          group_id: string
          id?: string
          invited_by_id: string
          member_type?: string
          roles?: Database["public"]["Enums"]["group_member_role"][]
          status?: Database["public"]["Enums"]["group_invite_status"]
          token: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          group_id?: string
          id?: string
          invited_by_id?: string
          member_type?: string
          roles?: Database["public"]["Enums"]["group_member_role"][]
          status?: Database["public"]["Enums"]["group_invite_status"]
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_invites_accepted_by_id_fkey"
            columns: ["accepted_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invites_invited_by_id_fkey"
            columns: ["invited_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          archived_at: string | null
          cleared_at: string | null
          created_at: string
          group_id: string
          hidden_at: string | null
          id: string
          last_read_at: string
          member_type: string
          muted: boolean
          pinned_at: string | null
          roles: Database["public"]["Enums"]["group_member_role"][]
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          cleared_at?: string | null
          created_at?: string
          group_id: string
          hidden_at?: string | null
          id?: string
          last_read_at?: string
          member_type?: string
          muted?: boolean
          pinned_at?: string | null
          roles?: Database["public"]["Enums"]["group_member_role"][]
          user_id: string
        }
        Update: {
          archived_at?: string | null
          cleared_at?: string | null
          created_at?: string
          group_id?: string
          hidden_at?: string | null
          id?: string
          last_read_at?: string
          member_type?: string
          muted?: boolean
          pinned_at?: string | null
          roles?: Database["public"]["Enums"]["group_member_role"][]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_messages: {
        Row: {
          content: string
          created_at: string
          group_id: string
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
          media_type: string
          media_url: string
          notify_email: boolean
          pinned_at: string | null
          poll_id: string | null
          sender_id: string
          shared_post_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          group_id: string
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          media_type?: string
          media_url?: string
          notify_email?: boolean
          pinned_at?: string | null
          poll_id?: string | null
          sender_id: string
          shared_post_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          group_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          media_type?: string
          media_url?: string
          notify_email?: boolean
          pinned_at?: string | null
          poll_id?: string | null
          sender_id?: string
          shared_post_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_messages_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: true
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_messages_shared_post_id_fkey"
            columns: ["shared_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          cover_image_url: string
          cover_offset_y: number
          cover_scale: number
          created_at: string
          id: string
          image_url: string
          member_types: Json
          name: string
          owner_id: string
          reminder_prefs: Json
          updated_at: string
        }
        Insert: {
          cover_image_url?: string
          cover_offset_y?: number
          cover_scale?: number
          created_at?: string
          id?: string
          image_url?: string
          member_types?: Json
          name: string
          owner_id: string
          reminder_prefs?: Json
          updated_at?: string
        }
        Update: {
          cover_image_url?: string
          cover_offset_y?: number
          cover_scale?: number
          created_at?: string
          id?: string
          image_url?: string
          member_types?: Json
          name?: string
          owner_id?: string
          reminder_prefs?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hidden_posts: {
        Row: {
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hidden_posts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hidden_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      highlights: {
        Row: {
          caption: string
          created_at: string
          id: string
          media_type: string
          media_url: string
          user_id: string
        }
        Insert: {
          caption?: string
          created_at?: string
          id?: string
          media_type?: string
          media_url: string
          user_id: string
        }
        Update: {
          caption?: string
          created_at?: string
          id?: string
          media_type?: string
          media_url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "highlights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          target_id: string
          target_type: Database["public"]["Enums"]["reaction_target"]
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          target_id: string
          target_type: Database["public"]["Enums"]["reaction_target"]
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          target_id?: string
          target_type?: Database["public"]["Enums"]["reaction_target"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          media_type: string
          media_url: string
          receiver_id: string
          sender_id: string
          shared_post_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          media_type?: string
          media_url?: string
          receiver_id: string
          sender_id: string
          shared_post_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          media_type?: string
          media_url?: string
          receiver_id?: string
          sender_id?: string
          shared_post_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_shared_post_id_fkey"
            columns: ["shared_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string
          comment_id: string | null
          created_at: string
          emoji: string
          event_id: string | null
          id: string
          match_id: string | null
          message_id: string | null
          post_id: string | null
          read: boolean
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          actor_id: string
          comment_id?: string | null
          created_at?: string
          emoji?: string
          event_id?: string | null
          id?: string
          match_id?: string | null
          message_id?: string | null
          post_id?: string | null
          read?: boolean
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          actor_id?: string
          comment_id?: string | null
          created_at?: string
          emoji?: string
          event_id?: string | null
          id?: string
          match_id?: string | null
          message_id?: string | null
          post_id?: string | null
          read?: boolean
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "event_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          created_at: string
          id: string
          order: number
          post_id: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          order?: number
          post_id: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          order?: number
          post_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "photos_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      play_requests: {
        Row: {
          created_at: string
          id: string
          note: string
          post_id: string
          status: Database["public"]["Enums"]["play_request_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string
          post_id: string
          status?: Database["public"]["Enums"]["play_request_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string
          post_id?: string
          status?: Database["public"]["Enums"]["play_request_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "play_requests_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "play_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_options: {
        Row: {
          created_at: string
          id: string
          order: number
          poll_id: string
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          order?: number
          poll_id: string
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          order?: number
          poll_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          created_at: string
          id: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          option_id?: string
          poll_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          created_at: string
          created_by_id: string
          id: string
          is_closed: boolean
          is_multi: boolean
          question: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_id: string
          id?: string
          is_closed?: boolean
          is_multi?: boolean
          question: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_id?: string
          id?: string
          is_closed?: boolean
          is_multi?: boolean
          question?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "polls_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_targets: {
        Row: {
          created_at: string
          friend_group_id: string | null
          group_id: string | null
          id: string
          post_id: string
          target_kind: Database["public"]["Enums"]["post_target_kind"]
        }
        Insert: {
          created_at?: string
          friend_group_id?: string | null
          group_id?: string | null
          id?: string
          post_id: string
          target_kind: Database["public"]["Enums"]["post_target_kind"]
        }
        Update: {
          created_at?: string
          friend_group_id?: string | null
          group_id?: string | null
          id?: string
          post_id?: string
          target_kind?: Database["public"]["Enums"]["post_target_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "post_targets_friend_group_id_fkey"
            columns: ["friend_group_id"]
            isOneToOne: false
            referencedRelation: "friend_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_targets_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_targets_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string
          broadcast_lat: number | null
          broadcast_lng: number | null
          broadcast_location: unknown
          broadcast_radius_mi: number
          comments_disabled: boolean
          content: string
          court_booked: boolean
          court_facility_id: string | null
          court_location: string
          created_at: string
          event_id: string | null
          game_type: string
          id: string
          is_broadcast: boolean
          is_complete: boolean
          manual_players: string
          media_type: string
          media_url: string
          pinned_at: string | null
          play_date: string
          play_duration: number
          play_time: string
          play_timezone: string
          players_confirmed: number
          players_needed: number
          post_type: Database["public"]["Enums"]["post_type"]
          skill_max: number | null
          skill_min: number | null
          team_group_id: string
        }
        Insert: {
          author_id: string
          broadcast_lat?: number | null
          broadcast_lng?: number | null
          broadcast_location?: unknown
          broadcast_radius_mi?: number
          comments_disabled?: boolean
          content?: string
          court_booked?: boolean
          court_facility_id?: string | null
          court_location?: string
          created_at?: string
          event_id?: string | null
          game_type?: string
          id?: string
          is_broadcast?: boolean
          is_complete?: boolean
          manual_players?: string
          media_type?: string
          media_url?: string
          pinned_at?: string | null
          play_date?: string
          play_duration?: number
          play_time?: string
          play_timezone?: string
          players_confirmed?: number
          players_needed?: number
          post_type?: Database["public"]["Enums"]["post_type"]
          skill_max?: number | null
          skill_min?: number | null
          team_group_id?: string
        }
        Update: {
          author_id?: string
          broadcast_lat?: number | null
          broadcast_lng?: number | null
          broadcast_location?: unknown
          broadcast_radius_mi?: number
          comments_disabled?: boolean
          content?: string
          court_booked?: boolean
          court_facility_id?: string | null
          court_location?: string
          created_at?: string
          event_id?: string | null
          game_type?: string
          id?: string
          is_broadcast?: boolean
          is_complete?: boolean
          manual_players?: string
          media_type?: string
          media_url?: string
          pinned_at?: string | null
          play_date?: string
          play_duration?: number
          play_time?: string
          play_timezone?: string
          players_confirmed?: number
          players_needed?: number
          post_type?: Database["public"]["Enums"]["post_type"]
          skill_max?: number | null
          skill_min?: number | null
          team_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_series: {
        Row: {
          created_at: string
          group_id: string
          id: string
          location: string
          name: string
          notes: string
          practice_time: string
          season_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          location: string
          name: string
          notes?: string
          practice_time?: string
          season_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          location?: string
          name?: string
          notes?: string
          practice_time?: string
          season_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_series_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_series_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age_range: string
          bio: string
          cashapp_handle: string | null
          cover_image_url: string
          cover_offset_y: number
          cover_scale: number
          created_at: string
          custom_tags: string
          email: string | null
          favorite_surface: string
          gender: string
          handle: string | null
          id: string
          is_private: boolean
          last_active: string
          latitude: number | null
          location: unknown
          longitude: number | null
          name: string
          ntrp_rating: number | null
          onboarding_complete: boolean
          paypal_handle: string | null
          phone: string | null
          profile_image_url: string
          rating_system: string
          skill_level: string
          updated_at: string
          utr_rating: number | null
          venmo_handle: string | null
          zelle_handle: string | null
        }
        Insert: {
          age_range?: string
          bio?: string
          cashapp_handle?: string | null
          cover_image_url?: string
          cover_offset_y?: number
          cover_scale?: number
          created_at?: string
          custom_tags?: string
          email?: string | null
          favorite_surface?: string
          gender?: string
          handle?: string | null
          id: string
          is_private?: boolean
          last_active?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          name?: string
          ntrp_rating?: number | null
          onboarding_complete?: boolean
          paypal_handle?: string | null
          phone?: string | null
          profile_image_url?: string
          rating_system?: string
          skill_level?: string
          updated_at?: string
          utr_rating?: number | null
          venmo_handle?: string | null
          zelle_handle?: string | null
        }
        Update: {
          age_range?: string
          bio?: string
          cashapp_handle?: string | null
          cover_image_url?: string
          cover_offset_y?: number
          cover_scale?: number
          created_at?: string
          custom_tags?: string
          email?: string | null
          favorite_surface?: string
          gender?: string
          handle?: string | null
          id?: string
          is_private?: boolean
          last_active?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          name?: string
          ntrp_rating?: number | null
          onboarding_complete?: boolean
          paypal_handle?: string | null
          phone?: string | null
          profile_image_url?: string
          rating_system?: string
          skill_level?: string
          updated_at?: string
          utr_rating?: number | null
          venmo_handle?: string | null
          zelle_handle?: string | null
        }
        Relationships: []
      }
      reminder_sent: {
        Row: {
          hours_before: number
          id: string
          kind: string
          ref_id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          hours_before: number
          id?: string
          kind: string
          ref_id: string
          sent_at?: string
          user_id: string
        }
        Update: {
          hours_before?: number
          id?: string
          kind?: string
          ref_id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_sent_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          end_date: string | null
          group_id: string
          id: string
          is_active: boolean
          name: string
          start_date: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          group_id: string
          id?: string
          is_active?: boolean
          name: string
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          group_id?: string
          id?: string
          is_active?: boolean
          name?: string
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      team_listings: {
        Row: {
          city: string
          created_at: string
          created_by_id: string
          description: string
          expires_at: string | null
          format: Database["public"]["Enums"]["team_listing_format"]
          group_id: string
          id: string
          ntrp_max: number | null
          ntrp_min: number | null
          status: Database["public"]["Enums"]["team_listing_status"]
          title: string
          updated_at: string
        }
        Insert: {
          city?: string
          created_at?: string
          created_by_id: string
          description?: string
          expires_at?: string | null
          format?: Database["public"]["Enums"]["team_listing_format"]
          group_id: string
          id?: string
          ntrp_max?: number | null
          ntrp_min?: number | null
          status?: Database["public"]["Enums"]["team_listing_status"]
          title: string
          updated_at?: string
        }
        Update: {
          city?: string
          created_at?: string
          created_by_id?: string
          description?: string
          expires_at?: string | null
          format?: Database["public"]["Enums"]["team_listing_format"]
          group_id?: string
          id?: string
          ntrp_max?: number | null
          ntrp_min?: number | null
          status?: Database["public"]["Enums"]["team_listing_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_listings_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_listings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      team_matches: {
        Row: {
          created_at: string
          group_id: string
          home_away: string
          id: string
          location: string
          match_date: string
          match_time: string
          notes: string
          opponent: string
          season_id: string | null
          shirt_color: string
          timezone: string
        }
        Insert: {
          created_at?: string
          group_id: string
          home_away?: string
          id?: string
          location: string
          match_date: string
          match_time?: string
          notes?: string
          opponent?: string
          season_id?: string | null
          shirt_color?: string
          timezone?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          home_away?: string
          id?: string
          location?: string
          match_date?: string
          match_time?: string
          notes?: string
          opponent?: string
          season_id?: string | null
          shirt_color?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_matches_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_matches_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      team_practices: {
        Row: {
          created_at: string
          id: string
          practice_date: string
          series_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          practice_date: string
          series_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          practice_date?: string
          series_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_practices_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "practice_series"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_courts: {
        Row: {
          active_net_id: string
          court_number: number
          created_at: string
          id: string
          is_lighted: boolean
          surface: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          active_net_id?: string
          court_number: number
          created_at?: string
          id?: string
          is_lighted?: boolean
          surface?: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          active_net_id?: string
          court_number?: number
          created_at?: string
          id?: string
          is_lighted?: boolean
          surface?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_courts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          active_net_id: string
          address: string
          amenities: Json
          created_at: string
          id: string
          image_url: string
          latitude: number
          location: unknown
          longitude: number
          name: string
          neighborhood: string
          updated_at: string
        }
        Insert: {
          active_net_id?: string
          address: string
          amenities?: Json
          created_at?: string
          id?: string
          image_url?: string
          latitude: number
          location?: unknown
          longitude: number
          name: string
          neighborhood?: string
          updated_at?: string
        }
        Update: {
          active_net_id?: string
          address?: string
          amenities?: Json
          created_at?: string
          id?: string
          image_url?: string
          latitude?: number
          location?: unknown
          longitude?: number
          name?: string
          neighborhood?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_group_invite: { Args: { p_token: string }; Returns: Json }
      advance_event_match_to_next_round: {
        Args: { p_match_id: string }
        Returns: undefined
      }
      can_admin_group: { Args: { g: string }; Returns: boolean }
      can_run_group: { Args: { g: string }; Returns: boolean }
      can_see_event: {
        Args: { e: Database["public"]["Tables"]["events"]["Row"] }
        Returns: boolean
      }
      can_see_post: {
        Args: { p: Database["public"]["Tables"]["posts"]["Row"] }
        Returns: boolean
      }
      cleanup_user_for_test: { Args: { uid: string }; Returns: undefined }
      count_user_friends: { Args: { user_id: string }; Returns: number }
      email_exists: { Args: { p_email: string }; Returns: boolean }
      generate_round_robin_schedule: {
        Args: { p_event_id: string; p_schedule: Json }
        Returns: Json
      }
      get_invite_by_token: { Args: { p_token: string }; Returns: Json }
      invite_to_event: {
        Args: { p_event_id: string; p_user_ids: string[] }
        Returns: Json
      }
      invoke_edge_function: {
        Args: { body: Json; fn_name: string }
        Returns: number
      }
      is_blocked: { Args: { a: string; b: string }; Returns: boolean }
      is_chat_participant: { Args: { c: string }; Returns: boolean }
      is_friend: { Args: { other_user: string }; Returns: boolean }
      is_group_member: { Args: { g: string }; Returns: boolean }
      post_event_rotation_round: {
        Args: {
          p_bye?: string
          p_event_id: string
          p_pairs: Json
          p_round: number
        }
        Returns: Json
      }
      propose_ladder_challenge: {
        Args: {
          p_court_assign?: string
          p_event_id: string
          p_opponent_id: string
          p_scheduled_at?: string
        }
        Returns: string
      }
      recompute_event_standings_for: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      recount_post_players_confirmed: {
        Args: { p_post_id: string }
        Returns: undefined
      }
      report_court_availability: {
        Args: { p_court_id: string; p_has_empty: boolean; p_post_id?: string }
        Returns: Json
      }
      seed_event_bracket: {
        Args: { p_event_id: string; p_pairs: Json }
        Returns: Json
      }
      seed_ladder_lineup: { Args: { p_event_id: string }; Returns: Json }
      transfer_group_ownership: {
        Args: { p_group_id: string; p_new_owner_id: string }
        Returns: undefined
      }
    }
    Enums: {
      availability_event_kind: "match" | "practice"
      booking_player_status: "invited" | "accepted" | "declined"
      booking_status: "pending" | "confirmed" | "cancelled"
      device_platform: "ios" | "android"
      event_match_status:
        | "proposed"
        | "declined"
        | "scheduled"
        | "in_progress"
        | "completed"
        | "cancelled"
      event_participant_status: "registered" | "waitlist" | "withdrawn"
      event_status: "open" | "closed" | "active" | "completed" | "cancelled"
      event_visibility: "public" | "group"
      friendship_status: "pending" | "accepted" | "rejected"
      group_invite_status: "pending" | "accepted" | "cancelled" | "expired"
      group_member_role: "manager" | "captain"
      group_role: "owner" | "manager" | "captain" | "member"
      message_kind: "chat" | "announcement"
      notification_type:
        | "comment"
        | "like"
        | "join_request"
        | "request_approved"
        | "request_rejected"
        | "message_reaction"
        | "event_invite"
        | "friend_request"
        | "group_invite_accepted"
        | "reply"
        | "event_signup"
        | "event_match_report"
        | "event_match_confirmed"
        | "event_match_disputed"
        | "event_ladder_challenge"
        | "event_challenge_accepted"
        | "event_challenge_declined"
      play_request_status:
        | "pending"
        | "approved"
        | "rejected"
        | "withdrawn"
        | "removed"
      post_target_kind: "group" | "friend_group"
      post_type: "regular" | "find_players" | "propose_team" | "event"
      reaction_target: "dm" | "group" | "chat"
      team_listing_format: "singles" | "doubles" | "mixed_doubles" | "any"
      team_listing_status: "open" | "filled" | "closed"
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
      availability_event_kind: ["match", "practice"],
      booking_player_status: ["invited", "accepted", "declined"],
      booking_status: ["pending", "confirmed", "cancelled"],
      device_platform: ["ios", "android"],
      event_match_status: [
        "proposed",
        "declined",
        "scheduled",
        "in_progress",
        "completed",
        "cancelled",
      ],
      event_participant_status: ["registered", "waitlist", "withdrawn"],
      event_status: ["open", "closed", "active", "completed", "cancelled"],
      event_visibility: ["public", "group"],
      friendship_status: ["pending", "accepted", "rejected"],
      group_invite_status: ["pending", "accepted", "cancelled", "expired"],
      group_member_role: ["manager", "captain"],
      group_role: ["owner", "manager", "captain", "member"],
      message_kind: ["chat", "announcement"],
      notification_type: [
        "comment",
        "like",
        "join_request",
        "request_approved",
        "request_rejected",
        "message_reaction",
        "event_invite",
        "friend_request",
        "group_invite_accepted",
        "reply",
        "event_signup",
        "event_match_report",
        "event_match_confirmed",
        "event_match_disputed",
        "event_ladder_challenge",
        "event_challenge_accepted",
        "event_challenge_declined",
      ],
      play_request_status: [
        "pending",
        "approved",
        "rejected",
        "withdrawn",
        "removed",
      ],
      post_target_kind: ["group", "friend_group"],
      post_type: ["regular", "find_players", "propose_team", "event"],
      reaction_target: ["dm", "group", "chat"],
      team_listing_format: ["singles", "doubles", "mixed_doubles", "any"],
      team_listing_status: ["open", "filled", "closed"],
    },
  },
} as const

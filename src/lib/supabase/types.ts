/**
 * Hand-written Postgres row types matching supabase/migrations/001_initial.sql
 * exactly (snake_case, as Postgres returns them). lib/supabase/server.ts and
 * service.ts map these into the camelCase domain types in src/types/index.ts
 * at the query boundary, so the rest of the app never sees snake_case.
 */

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          url: string;
          industry: string | null;
          size: string | null;
          stage: string | null;
          location: string | null;
          description: string | null;
          pain_point: string | null;
          tech_signals: string[];
          hiring_signals: string[];
          recent_news: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["companies"]["Row"]> & {
          name: string;
          url: string;
        };
        Update: Partial<Database["public"]["Tables"]["companies"]["Row"]>;
      };
      contacts: {
        Row: {
          id: string;
          user_id: string;
          company_id: string;
          name: string;
          title: string | null;
          email: string | null;
          linkedin_url: string | null;
          email_verified: boolean;
          found_via: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["contacts"]["Row"]> & {
          company_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["contacts"]["Row"]>;
      };
      drafts: {
        Row: {
          id: string;
          user_id: string;
          company_id: string;
          contact_id: string | null;
          subject: string;
          body: string;
          project_matched: string | null;
          match_reasoning: string | null;
          demo_url: string | null;
          confidence_score: number | null;
          confidence_reason: string | null;
          needs_demo_customisation: boolean;
          customisation_notes: string | null;
          status: string;
          approved_at: string | null;
          sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["drafts"]["Row"]> & {
          company_id: string;
          subject: string;
          body: string;
        };
        Update: Partial<Database["public"]["Tables"]["drafts"]["Row"]>;
      };
      replies: {
        Row: {
          id: string;
          user_id: string;
          draft_id: string;
          received_at: string | null;
          body: string;
          sentiment: string | null;
          suggested_response: string | null;
          status: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["replies"]["Row"]> & {
          draft_id: string;
          body: string;
        };
        Update: Partial<Database["public"]["Tables"]["replies"]["Row"]>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

type ExtraFunctions = {
  patch_team_onboarding: { Args: { p_group: string; p_change: Json }; Returns: Json };
  manage_team_join_link: { Args: { p_group: string; p_action: string }; Returns: Json };
  view_team_join_link: { Args: { p_token: string }; Returns: Json };
  request_team_join: { Args: { p_token: string }; Returns: Json };
  review_team_join_request: { Args: { p_group: string; p_request: string; p_decision: string; p_player: string | null }; Returns: Json };
  list_team_onboarding_invitations: { Args: Record<string, never>; Returns: Json };
  save_team_onboarding: { Args: { p_group: string; p_config: Json; p_players: Json }; Returns: Json };
  read_team_onboarding: { Args: { p_group: string }; Returns: Json };
  view_team_onboarding_invitation: { Args: { p_token: string }; Returns: Json };
  accept_team_onboarding_invitation: { Args: { p_token: string }; Returns: Json };
  renew_team_onboarding_invitation: { Args: { p_group: string; p_player: string }; Returns: Json };
  revoke_team_onboarding_invitation: { Args: { p_group: string; p_player: string }; Returns: Json };
};
type PlayerRow = import("zod").infer<typeof import("./contracts").storedPlayerSchema>;
type DeliveryRow = { id: string; player_id: string; batch_id: string; channel: string; status: string; provider_id: string | null; created_at: string };
type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
type OnboardingDatabase = Omit<Database, "public"> & { public: Omit<Database["public"], "Functions" | "Tables"> & { Tables: Database["public"]["Tables"] & { team_onboarding_players: Table<PlayerRow>; team_onboarding_deliveries: Table<DeliveryRow> }; Functions: Database["public"]["Functions"] & ExtraFunctions } };
export function onboardingDb(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<OnboardingDatabase>;
}

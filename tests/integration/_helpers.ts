import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

export const integrationEnvReady =
  SUPABASE_URL.length > 0 && ANON_KEY.length > 0 && SECRET_KEY.length > 0;

export function adminClient(): SupabaseClient<Database> {
  if (!integrationEnvReady) {
    throw new Error("Integration env not configured");
  }
  return createClient<Database>(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(): SupabaseClient<Database> {
  if (!integrationEnvReady) {
    throw new Error("Integration env not configured");
  }
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient<Database>;
}

const PASSWORD = "TestPass-123!";

/**
 * Create a test user via the admin API, then sign in with the publishable
 * key to get a real JWT-bound client. Returns both the id and a ready-to-use
 * client scoped to that user.
 */
export async function makeTestUser(label: string): Promise<TestUser> {
  const admin = adminClient();
  // Unique email per run so reruns don't collide on leftover rows.
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@tennisfriend.test`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: label },
  });
  if (createErr || !created.user) {
    throw new Error(`createUser failed for ${label}: ${createErr?.message}`);
  }

  const userClient = anonClient();
  const { error: signInErr } = await userClient.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInErr) {
    throw new Error(`signIn failed for ${label}: ${signInErr.message}`);
  }

  return { id: created.user.id, email, password: PASSWORD, client: userClient };
}

/** Tear down by deleting auth.users (cascades to profiles + downstream). */
export async function deleteTestUsers(users: TestUser[]): Promise<void> {
  const admin = adminClient();
  await Promise.all(
    users.map(async (u) => {
      try {
        await admin.auth.admin.deleteUser(u.id);
      } catch {
        // best-effort
      }
    })
  );
}

/** Becomes friends bidirectionally — A sends, B accepts. */
export async function befriend(a: TestUser, b: TestUser): Promise<void> {
  const { data, error } = await a.client
    .from("friendships")
    .insert({ requester_id: a.id, addressee_id: b.id, status: "pending" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`befriend insert: ${error?.message}`);
  const { error: upErr } = await b.client
    .from("friendships")
    .update({ status: "accepted" })
    .eq("id", data.id);
  if (upErr) throw new Error(`befriend accept: ${upErr.message}`);
}

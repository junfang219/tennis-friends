import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cleanupUserStorage } from "@/lib/account/cleanup-user-storage";
import { errorMessage } from "@/lib/errorMessage";

// POST /api/account/delete
//
// Triggered by Settings → Danger zone → Delete account (after the user
// types DELETE in the confirm modal). Wipes the account in three passes:
//
//   1. delete_my_account() RPC — hard-deletes every RESTRICT-FK row the
//      user owns (groups, events, polls, chats, expenses, bookings,
//      albums, …) so the auth.users delete can cascade through cleanly.
//   2. cleanupUserStorage — drops every object under `{userId}/` from
//      avatars, posts, albums, files, court-reviews.
//   3. auth.admin.deleteUser — removes the auth.users row, which
//      cascades to profiles and the ~30 CASCADE child tables (posts,
//      comments, likes, messages, friendships, RSVPs, device_tokens,
//      notifications, …).
//
// Ordering matters: the RPC needs auth.uid() resolved against the
// caller's session, so it must run before we lose that session (the
// admin client doesn't carry it). Storage + admin.deleteUser then use
// the elevated key. If any step fails, we bail with 500 and let the
// caller surface the message — the modal stays open and the button
// re-enables for retry.
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;

  const { error: rpcError } = await supabase.rpc("delete_my_account");
  if (rpcError) {
    return NextResponse.json(
      { error: `Failed to clear account data: ${rpcError.message}` },
      { status: 500 },
    );
  }

  const admin = createSupabaseAdminClient();

  const storageResults = await cleanupUserStorage(admin, userId);
  const storageFailure = storageResults.find((r) => r.error);
  if (storageFailure) {
    return NextResponse.json(
      {
        error: `Failed to clear ${storageFailure.bucket} uploads: ${storageFailure.error}`,
      },
      { status: 500 },
    );
  }

  const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
  if (deleteUserError) {
    return NextResponse.json(
      { error: `Failed to delete account: ${errorMessage(deleteUserError, "unknown")}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

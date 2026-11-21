import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { onboardingDb } from "@/lib/onboarding/db";
import { sharedTeamInvitationSchema, teamLinkTokenSchema } from "@/lib/onboarding/shared";

type Context = { params: Promise<{ token: string }> };
async function respond(token: string, requestJoin: boolean) {
  if (!teamLinkTokenSchema.safeParse(token).success) return NextResponse.json({ error: "Invitation unavailable" }, { status: 404 });
  const db = await createSupabaseServerClient();
  if (requestJoin) {
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return NextResponse.json({ error: "Sign in to request to join" }, { status: 401 });
  }
  const { data, error } = await onboardingDb(db).rpc(requestJoin ? "request_team_join" : "view_team_join_link", { p_token: token });
  const parsed = sharedTeamInvitationSchema.safeParse(data);
  return error || !parsed.success
    ? NextResponse.json({ error: "This team link is no longer available. Ask your captain for the current link." }, { status: 404 })
    : NextResponse.json(parsed.data, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
export async function GET(_request: Request, ctx: Context) { return respond((await ctx.params).token, false); }
export async function POST(_request: Request, ctx: Context) { return respond((await ctx.params).token, true); }

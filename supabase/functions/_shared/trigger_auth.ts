// Shared auth gate for edge functions invoked by database triggers
// (via public.invoke_edge_function). The trigger attaches an
// X-Trigger-Secret header whose value comes from Supabase Vault. The
// function compares it against the TRIGGER_SECRET env var. If the
// env var is unset, the function refuses all calls (rather than
// "accept anything"); operator must set the env var to match the
// Vault entry before triggers can fire.
//
// Why a shared secret on top of verify_jwt? The Supabase project's
// anon key ships in every JS bundle. With verify_jwt=true alone, any
// third party can POST to the function with that anon key — letting
// them spam pushes via push-fanout or relay email via
// group-invite-email. The shared secret moves the trust boundary
// from "anyone with the anon key" to "anyone with the trigger
// secret" — and the secret only lives in the Vault + the function's
// env vars, never in client bundles.

export function requireTriggerSecret(req: Request): Response | null {
  const expected = Deno.env.get("TRIGGER_SECRET");
  if (!expected) {
    console.error(
      "[trigger_auth] TRIGGER_SECRET env var not set — refusing all calls. " +
      "Set it to match vault.edge_function_trigger_secret."
    );
    return new Response("Trigger secret not configured", { status: 503 });
  }
  const presented = req.headers.get("x-trigger-secret") ?? "";
  if (presented !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

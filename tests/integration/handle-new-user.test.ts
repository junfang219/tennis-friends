import { afterEach, describe, expect, it } from "vitest";
import { adminClient, integrationEnvReady } from "./_helpers";

// Verifies the handle_new_user trigger that runs on auth.users insert.
// The trigger seeds public.profiles from auth metadata so OAuth signups
// land in the app with their name and Google/Apple avatar already populated
// — without this, the personal page shows initials even when the Navbar
// shows the OAuth photo (the two read from different sources).

describe.skipIf(!integrationEnvReady)("handle_new_user trigger", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    const admin = adminClient();
    await Promise.all(
      createdIds.splice(0).map((id) => admin.auth.admin.deleteUser(id))
    );
  });

  async function createUserWithMetadata(metadata: Record<string, string>) {
    const admin = adminClient();
    const email = `hnu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@tennisfriend.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "TestPass-123!",
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    createdIds.push(data.user.id);
    const { data: profile, error: pErr } = await admin
      .from("profiles")
      .select("name, profile_image_url")
      .eq("id", data.user.id)
      .single();
    if (pErr || !profile) throw new Error(`profile fetch failed: ${pErr?.message}`);
    return profile;
  }

  it("copies avatar_url from raw_user_meta_data into profile_image_url", async () => {
    const avatar = "https://lh3.googleusercontent.com/a/test-avatar=s96-c";
    const profile = await createUserWithMetadata({
      name: "Avatar User",
      avatar_url: avatar,
    });
    expect(profile.profile_image_url).toBe(avatar);
  });

  it("falls back to 'picture' when avatar_url is absent (OIDC providers)", async () => {
    const picture = "https://example.com/oidc-picture.jpg";
    const profile = await createUserWithMetadata({
      name: "Picture User",
      picture,
    });
    expect(profile.profile_image_url).toBe(picture);
  });

  it("leaves profile_image_url empty for password-only signups", async () => {
    const profile = await createUserWithMetadata({ name: "Password User" });
    expect(profile.profile_image_url).toBe("");
  });

  it("prefers avatar_url over picture when both are present", async () => {
    const avatar = "https://example.com/avatar.jpg";
    const picture = "https://example.com/picture.jpg";
    const profile = await createUserWithMetadata({
      name: "Both Avatars User",
      avatar_url: avatar,
      picture,
    });
    expect(profile.profile_image_url).toBe(avatar);
  });
});

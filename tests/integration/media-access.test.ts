import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, anonClient, deleteTestUsers, integrationEnvReady, makeTestUser, type TestUser } from "./_helpers";
import { managedMediaUrl } from "@/lib/supabase/storage";

describe.skipIf(!integrationEnvReady)("moderated private media", () => {
  const users: TestUser[] = [];
  let key: string;
  beforeAll(async () => {
    for (const name of ["media-author", "media-recipient", "media-outsider"]) users.push(await makeTestUser(name));
    key = users[0].id + "/media-test.png";
  });
  afterAll(async () => {
    if (key) await adminClient().storage.from("posts").remove([key]);
    await deleteTestUsers(users);
  });

  it("holds new media for approval and grants access only to the message participants", async () => {
    const [author, recipient, outsider] = users;
    const admin = adminClient();
    const object = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const upload = await author.client.storage.from("posts").upload(key, object);
    expect(upload.error).toBeNull();

    const url = managedMediaUrl("posts", key);
    const message = await author.client.from("messages").insert({
      sender_id: author.id, receiver_id: recipient.id, content: "A test photo", media_url: url, media_type: "image",
    });
    expect(message.error).toBeNull();
    expect((await author.client.storage.from("posts").createSignedUrl(key, 15)).error).toBeNull();
    expect((await recipient.client.storage.from("posts").createSignedUrl(key, 15)).error).not.toBeNull();
    expect((await outsider.client.rpc("pending_media_uploads")).error).not.toBeNull();

    const pending = await admin.rpc("pending_media_uploads");
    expect(pending.error).toBeNull();
    const pendingObject = pending.data?.find(item => item.object_key === key);
    expect(pendingObject).toBeDefined();
    const approval = await admin.rpc("decide_media_upload", { p_id: pendingObject!.object_id, p_approved: true });
    expect(approval.error).toBeNull();
    expect(approval.data).toBe(true);

    expect((await recipient.client.storage.from("posts").createSignedUrl(key, 15)).error).toBeNull();
    expect((await outsider.client.storage.from("posts").createSignedUrl(key, 15)).error).not.toBeNull();
    expect((await anonClient().storage.from("posts").createSignedUrl(key, 15)).error).not.toBeNull();

    const spoof = await outsider.client.from("messages").insert({
      sender_id: outsider.id, receiver_id: recipient.id, content: "An unauthorized reference", media_url: url, media_type: "image",
    });
    expect(spoof.error?.code).toBe("22023");
    expect((await author.client.storage.from("posts").upload(key, object, { upsert: true })).error).not.toBeNull();

    expect((await author.client.storage.from("posts").remove([key])).error).toBeNull();
    expect((await author.client.storage.from("posts").upload(key, object)).error).toBeNull();
    expect((await recipient.client.storage.from("posts").createSignedUrl(key, 15)).error).not.toBeNull();
  });
});

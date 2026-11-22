import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, deleteTestUsers, integrationEnvReady, makeTestUser, type TestUser } from "./_helpers";

describe.skipIf(!integrationEnvReady)("content report history", () => {
  const users: TestUser[] = [];
  beforeAll(async () => {
    for (const name of ["moderation-author", "moderation-reporter", "moderation-staff"]) {
      users.push(await makeTestUser(name));
    }
  });
  afterAll(() => deleteTestUsers(users));

  it("deduplicates unchanged evidence and reopens reporting when text past the excerpt changes", async () => {
    const [author, reporter, moderator] = users;
    const admin = adminClient();
    const excerpt = "x".repeat(4000);
    const original = excerpt + " original";
    const edited = excerpt + " changed";
    const post = await admin.from("posts")
      .insert({ author_id: author.id, content: original, post_type: "regular", visibility: "private" })
      .select("id").single();
    expect(post.error).toBeNull();
    const target = post.data!.id;

    const record = async (content: string) => {
      const response = await admin.rpc("record_content_report", {
        p_reporter_id: reporter.id,
        p_author_id: author.id,
        p_target_type: "post",
        p_target_id: target,
        p_reason: "spam",
        p_details: "",
        p_evidence_text: content,
        p_evidence_media: [],
      });
      expect(response.error).toBeNull();
      return response.data;
    };
    expect(await record(original)).toBe("created");
    expect(await record(original)).toBe("duplicate");

    const first = await admin.from("content_reports").select("id").eq("target_id", target).single();
    expect(first.error).toBeNull();
    const decision = await admin.rpc("review_content_report", {
      p_report_id: first.data!.id,
      p_reviewer_id: moderator.id,
      p_decision: "dismissed",
    });
    expect(decision.error).toBeNull();
    expect(decision.data).toBe(true);
    expect(await record(original)).toBe("duplicate");

    const update = await admin.from("posts").update({ content: edited }).eq("id", target);
    expect(update.error).toBeNull();
    expect(await record(edited)).toBe("created");
    expect(await record(edited)).toBe("duplicate");
    const history = await admin.from("content_reports")
      .select("decision, evidence_text, evidence_fingerprint").eq("target_id", target);
    expect(history.error).toBeNull();
    expect(history.data?.map(row => row.decision)).toEqual(expect.arrayContaining(["dismissed", null]));
    expect(history.data?.map(row => row.evidence_text)).toEqual([excerpt, excerpt]);
    expect(new Set(history.data?.map(row => row.evidence_fingerprint)).size).toBe(2);
  });
});

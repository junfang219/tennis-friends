import { describe, expect, it } from "vitest";
import { filterInvitableFriends } from "./clubInvitePicker";

const f = (id: string) => ({ user: { id } });

describe("filterInvitableFriends", () => {
  it("excludes current members and pending invitees", () => {
    const friends = [f("a"), f("b"), f("c"), f("d")];
    const result = filterInvitableFriends(friends, ["a"], ["c"]);
    expect(result.map((x) => x.user.id)).toEqual(["b", "d"]);
  });

  it("returns everyone when there are no members or pending invites", () => {
    const friends = [f("a"), f("b")];
    expect(filterInvitableFriends(friends, [], [])).toEqual(friends);
  });

  it("returns empty when all friends are members or invited", () => {
    const friends = [f("a"), f("b")];
    expect(filterInvitableFriends(friends, ["a"], ["b"])).toEqual([]);
  });

  it("handles a friend who is both a member and pending (dedup safety)", () => {
    const friends = [f("a"), f("b")];
    expect(filterInvitableFriends(friends, ["a"], ["a"]).map((x) => x.user.id)).toEqual(["b"]);
  });

  it("preserves extra fields on the friend entries", () => {
    const friends = [{ user: { id: "a" }, label: "Alice" }];
    expect(filterInvitableFriends(friends, [], [])[0].label).toBe("Alice");
  });
});

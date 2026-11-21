import { describe, expect, it } from "vitest";
import { filterNonmemberFriends } from "./friendGroupMemberPicker";

const f = (id: string) => ({ user: { id } });

describe("filterNonmemberFriends", () => {
  it("excludes current members", () => {
    const friends = [f("a"), f("b"), f("c"), f("d")];
    expect(filterNonmemberFriends(friends, ["a", "c"]).map(({ user }) => user.id)).toEqual(["b", "d"]);
  });

  it("returns an empty list when all friends are members", () => {
    expect(filterNonmemberFriends([f("a"), f("b")], ["a", "b"])).toEqual([]);
  });

  it("preserves extra fields on the friend entries", () => {
    const friends = [{ user: { id: "a" }, label: "Alice" }];
    expect(filterNonmemberFriends(friends, [])[0].label).toBe("Alice");
  });
});

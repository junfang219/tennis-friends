import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import { renderChatMessage } from "./renderChatMessage";

describe("renderChatMessage", () => {
  it("returns plain text untouched when no link markers are present", () => {
    const out = renderChatMessage("hello world");
    expect(out).toEqual(["hello world"]);
  });

  it("replaces [label](/path) with a Next Link element", () => {
    const out = renderChatMessage("at [Lower Woodland](/courts?selected=tf-20) today");
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("at ");
    expect(out[2]).toBe(" today");
    const link = out[1];
    expect(isValidElement(link)).toBe(true);
    // Cast through unknown so we can introspect the element props without
    // pulling in @types/react helpers.
    const props = (link as { props: { href: string; children: string } }).props;
    expect(props.href).toBe("/courts?selected=tf-20");
    expect(props.children).toBe("Lower Woodland");
  });

  it("leaves [label](https://external) as plain text — no `a` href is emitted", () => {
    // Safety: the renderer must refuse non-internal hrefs so a future
    // user-content code path can't slip an external URL through.
    const out = renderChatMessage("see [click](https://evil.example) please");
    expect(out).toEqual(["see [click](https://evil.example) please"]);
  });

  it("returns an empty array for empty content", () => {
    expect(renderChatMessage("")).toEqual([]);
  });

  it("renders the trigger's Game confirmed message with a clickable court", () => {
    const msg = [
      "🎾 Game confirmed!",
      "📅 Jul 15 at 6:00 PM (90 min)",
      "📍 [Lower Woodland Playfield Tennis Courts](/courts?selected=tf-20)",
      "Players: Alice, Bob",
      "",
      "See you on court!",
    ].join("\n");
    const out = renderChatMessage(msg);
    const link = out.find((n) => isValidElement(n));
    expect(link).toBeDefined();
    const props = (link as { props: { href: string; children: string } }).props;
    expect(props.href).toBe("/courts?selected=tf-20");
    expect(props.children).toBe("Lower Woodland Playfield Tennis Courts");
  });
});

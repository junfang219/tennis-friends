import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NextResponse } from "next/server";
import { parseJson, parseSearch } from "./validate";

const userSchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(18),
});

function makeReq(body: string): Request {
  return new Request("https://example.com/api/x", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseJson", () => {
  it("returns the parsed value when valid", async () => {
    const req = makeReq(JSON.stringify({ email: "a@b.com", age: 30 }));
    const result = await parseJson(req, userSchema);
    expect(result).not.toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) {
      expect(result.email).toBe("a@b.com");
      expect(result.age).toBe(30);
    }
  });

  it("returns a 400 NextResponse on invalid email", async () => {
    const req = makeReq(JSON.stringify({ email: "not-an-email", age: 30 }));
    const result = await parseJson(req, userSchema);
    expect(result).toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(400);
    }
  });

  it("returns a 400 NextResponse on non-JSON body", async () => {
    const req = makeReq("not json at all");
    const result = await parseJson(req, userSchema);
    expect(result).toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(400);
    }
  });

  it("returns a 400 NextResponse on missing required fields", async () => {
    const req = makeReq(JSON.stringify({ email: "a@b.com" }));
    const result = await parseJson(req, userSchema);
    expect(result).toBeInstanceOf(NextResponse);
  });
});

describe("parseSearch", () => {
  it("parses URL search params per schema", () => {
    const url = new URL("https://example.com/?radius=10");
    const schema = z.object({ radius: z.string().regex(/^\d+$/) });
    const result = parseSearch(url, schema);
    expect(result).not.toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) {
      expect(result.radius).toBe("10");
    }
  });

  it("rejects invalid params with 400", () => {
    const url = new URL("https://example.com/?radius=ten");
    const schema = z.object({ radius: z.string().regex(/^\d+$/) });
    const result = parseSearch(url, schema);
    expect(result).toBeInstanceOf(NextResponse);
  });
});

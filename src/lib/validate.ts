import { NextResponse } from "next/server";
import { z, type ZodSchema, ZodError } from "zod";

/**
 * Validate a Request body against a Zod schema and return either the parsed
 * value or a NextResponse with a 400. Use at the boundary of every route
 * handler that accepts JSON.
 *
 *   const parsed = await parseJson(req, bodySchema);
 *   if (parsed instanceof NextResponse) return parsed;
 *   // parsed is typed
 */
export async function parseJson<T extends ZodSchema>(
  req: Request,
  schema: T
): Promise<z.infer<T> | NextResponse> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: formatZodIssues(result.error) },
      { status: 400 }
    );
  }
  return result.data;
}

/** Validate a URL's search params against a Zod schema. */
export function parseSearch<T extends ZodSchema>(
  url: URL,
  schema: T
): z.infer<T> | NextResponse {
  const obj: Record<string, string> = {};
  for (const [k, v] of url.searchParams) obj[k] = v;
  const result = schema.safeParse(obj);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid query params", issues: formatZodIssues(result.error) },
      { status: 400 }
    );
  }
  return result.data;
}

function formatZodIssues(err: ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
}

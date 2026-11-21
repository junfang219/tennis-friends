import { z } from "zod";

export const teamCalendarRequestSchema = z.object({
  guestToken: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).optional(),
});
const responseSchema = z.object({
  path: z.string().regex(/^\/calendar\/teams\/[a-f0-9-]+\/[A-Za-z0-9_-]{43}\/matches\.ics$/),
  baseUrl: z.string().url().refine((value) => new URL(value).protocol === "https:").optional(),
});

export async function createTeamCalendarLink(teamId: string, guestToken?: string): Promise<string> {
  const id = z.uuid().parse(teamId);
  const response = await fetch(`/api/calendar/teams/${id}`, {
    method: "POST", credentials: "same-origin", headers: {"Content-Type":"application/json"},
    body: JSON.stringify(teamCalendarRequestSchema.parse({guestToken})),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Sign in to subscribe to this team’s matches.");
    if (response.status === 403) throw new Error("This team calendar is available to team members and invited match guests.");
    throw new Error("The team calendar is unavailable. Please try again.");
  }
  const result = responseSchema.parse(await response.json());
  return new URL(result.path, result.baseUrl ?? window.location.origin).href;
}

/** Opens Google's subscription setup for the same feed used by Apple Calendar.
 * The UI also provides Google's documented From URL flow as a fallback. */
export function buildGoogleTeamCalendarUrl(feedUrl: string): string {
  const feed = z.string().url().refine((value) => new URL(value).protocol === "https:").parse(feedUrl);
  const url = new URL("https://calendar.google.com/calendar/render");
  // Google accepts external feeds through its webcal subscription form.
  url.searchParams.set("cid", feed.replace(/^https:/, "webcal:"));
  return url.href;
}

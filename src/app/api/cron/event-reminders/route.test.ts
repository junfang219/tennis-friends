import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("retries failed match and practice RSVP pushes without looking up email addresses", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T18:15:00Z"));
  vi.stubEnv("CRON_SECRET", "test-cron");
  vi.stubEnv("EDGE_FUNCTION_TRIGGER_SECRET", "test-trigger");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-admin");

  const group = { id: "team", name: "Tennis Club", reminder_prefs: {} };
  const availabilities = [{ user_id: "responded" }];
  const rows: Record<string, unknown[]> = {
    "/rest/v1/team_matches": [{
      id: "match",
      group_id: group.id,
      match_date: "2026-11-21",
      match_time: "18:00",
      location: "Home court",
      opponent: "Visitors",
      timezone: "UTC",
      group,
      availabilities,
    }],
    "/rest/v1/team_practices": [{
      id: "practice",
      practice_date: "2026-11-21",
      timezone: "UTC",
      series: { group, name: "Weekly practice", location: "Home court", practice_time: "18:00" },
      availabilities,
    }],
    "/rest/v1/group_members": [
      { user_id: "waiting" }, { user_id: "responded" }, { user_id: null },
    ],
    "/rest/v1/reminder_sent": [],
  };
  const unexpectedRequests: string[] = [];
  const pushes: unknown[] = [];
  const recorded: unknown[] = [];
  let pushUnavailable = true;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname in rows) {
      return Response.json(rows[url.pathname]);
    }
    if (request.method === "POST" && url.pathname === "/functions/v1/push-fanout") {
      if (pushUnavailable) throw new TypeError("Test network failure");
      pushes.push(await request.json());
      return Response.json({});
    }
    if (request.method === "POST" && url.pathname === "/rest/v1/reminder_sent") {
      recorded.push(await request.json());
      return new Response(null, { status: 201 });
    }
    unexpectedRequests.push(url.pathname);
    return new Response(null, { status: 400 });
  });

  const request = new Request("https://app.example.test/api/cron/event-reminders", {
    headers: { authorization: "Bearer test-cron" },
  });
  const failed = await GET(request);
  expect(await failed.json()).toMatchObject({
    dispatched: 0,
    errors: ["push-fanout 0: Test network failure", "push-fanout 0: Test network failure"],
  });
  expect(recorded).toEqual([]);

  pushUnavailable = false;
  vi.setSystemTime(new Date("2026-11-20T18:30:00Z"));
  const response = await GET(request);
  expect(await response.json()).toMatchObject({ dispatched: 2, errors: [] });
  expect(pushes).toEqual(["match", "practice"].map((kind) => expect.objectContaining({
    user_ids: ["waiting"],
    data: { kind, refId: kind, teamId: group.id },
  })));
  expect(recorded).toEqual(["match", "practice"].map((kind) => [
    { kind, ref_id: kind, user_id: "waiting", hours_before: 24 },
  ]));
  expect(unexpectedRequests).toEqual([]);
});

// k6 load test — feed endpoint.
//
// Run:
//   k6 run -e SUPABASE_URL=... -e PUBLISHABLE_KEY=... -e JWT=... tests/loadtest/feed.js
//
// Target: p95 < 500ms at 100 RPS sustained for 60s.
//
// JWT comes from a real signed-in user (use the integration test helper's
// signInWithPassword output, or grab one from your browser session).

import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    feed: {
      executor: "constant-arrival-rate",
      rate: 100,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    "http_req_failed": ["rate<0.01"],
    "http_req_duration": ["p(95)<500"],
  },
};

const SUPABASE_URL = __ENV.SUPABASE_URL;
const PUBLISHABLE_KEY = __ENV.PUBLISHABLE_KEY;
const JWT = __ENV.JWT;

if (!SUPABASE_URL || !PUBLISHABLE_KEY || !JWT) {
  throw new Error("Set SUPABASE_URL, PUBLISHABLE_KEY, JWT envs");
}

export default function () {
  const params = {
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${JWT}`,
    },
  };
  const res = http.get(
    `${SUPABASE_URL}/rest/v1/posts?select=id,content,created_at,author:profiles!posts_author_id_fkey(name)&order=created_at.desc&limit=50`,
    params
  );
  check(res, {
    "status is 200": (r) => r.status === 200,
    "returns rows": (r) => Array.isArray(r.json()) && r.json().length > 0,
  });
  sleep(1);
}

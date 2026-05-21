// k6 load test — Supabase Realtime concurrent subscribers.
//
// Run:
//   k6 run -e SUPABASE_URL=wss://... -e PUBLISHABLE_KEY=... -e JWT=... \
//          tests/loadtest/realtime-chat.js
//
// Target: 1,000 concurrent Realtime subscriptions on the messages table,
// sustained for 5 minutes, with sub-500ms median event delivery.

import ws from "k6/ws";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    realtime: {
      executor: "constant-vus",
      vus: 1000,
      duration: "5m",
    },
  },
  thresholds: {
    "ws_connecting": ["p(95)<2000"],
  },
};

const WSS_URL = (__ENV.SUPABASE_URL ?? "").replace(/^https:/, "wss:");
const PUBLISHABLE_KEY = __ENV.PUBLISHABLE_KEY;
const JWT = __ENV.JWT;

if (!WSS_URL || !PUBLISHABLE_KEY || !JWT) {
  throw new Error("Set SUPABASE_URL (https://...), PUBLISHABLE_KEY, JWT envs");
}

export default function () {
  const url = `${WSS_URL}/realtime/v1/websocket?apikey=${PUBLISHABLE_KEY}&vsn=1.0.0`;
  const res = ws.connect(url, null, function (socket) {
    socket.on("open", () => {
      // Phoenix-style join. Subscribe to the messages table — RLS will
      // scope what each connection actually receives.
      socket.send(
        JSON.stringify({
          topic: `realtime:public:messages`,
          event: "phx_join",
          payload: {
            config: {
              postgres_changes: [{ event: "*", schema: "public", table: "messages" }],
            },
            access_token: JWT,
          },
          ref: "1",
        })
      );
    });
    socket.on("message", (data) => {
      check(data, {
        "got phx_reply or postgres_changes": (d) =>
          d.includes("phx_reply") || d.includes("postgres_changes"),
      });
    });
    socket.setTimeout(() => {
      socket.close();
    }, 270_000); // hold for ~4.5min
  });
  check(res, { "ws connected": (r) => r && r.status === 101 });
  sleep(1);
}

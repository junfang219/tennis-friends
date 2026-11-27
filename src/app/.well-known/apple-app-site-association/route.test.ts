import { expect, it } from "vitest";
import { GET } from "./route";

it("associates team invitations and existing share links with the iPhone app", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(await response.json()).toMatchObject({
    applinks: {
      details: [{
        appIDs: ["QJ62YDMGLF.com.tennisfriend.app"],
        components: expect.arrayContaining([
          expect.objectContaining({ "/": "/p/*" }),
          expect.objectContaining({ "/": "/club-invite/*" }),
          expect.objectContaining({ "/": "/join-team/*" }),
          expect.objectContaining({ "/": "/team-invitations/*" }),
        ]),
      }],
    },
  });
});

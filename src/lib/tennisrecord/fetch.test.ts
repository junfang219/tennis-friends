import { afterEach, describe, it, expect, vi } from "vitest";
import {
  fetchTennisRecordTeam,
  searchTennisRecordTeams,
  TennisRecordFetchError,
} from "./fetch";

// These guard the user-facing failure messages: when the import fails the
// captain must see WHY and be asked to retry — never undici's bare
// "fetch failed". We drive the network layer by stubbing global fetch.

const teamUrl =
  "https://www.tennisrecord.com/adult/teamprofile.aspx?team=123456";

// A Node/undici-style network rejection: a bare TypeError with the real reason
// hidden on `.cause.code`.
function networkError(code?: string): TypeError {
  const err = new TypeError("fetch failed");
  if (code) (err as { cause?: unknown }).cause = { code };
  return err;
}

function okResponse(body = "<html></html>"): Response {
  return new Response(body, { status: 200 });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchTennisRecordTeam error handling", () => {
  it("maps a connect timeout to a friendly, retry-asking network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(networkError("UND_ERR_CONNECT_TIMEOUT")),
    );

    await expect(fetchTennisRecordTeam({ url: teamUrl })).rejects.toMatchObject(
      {
        name: "TennisRecordFetchError",
        kind: "network",
      },
    );

    const err = await fetchTennisRecordTeam({ url: teamUrl }).catch((e) => e);
    expect(err).toBeInstanceOf(TennisRecordFetchError);
    expect(err.message).toMatch(/timed out/i);
    expect(err.message).toMatch(/try again/i);
  });

  it("never leaks the raw 'fetch failed' message when there is no cause code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError()));

    const err = await fetchTennisRecordTeam({ url: teamUrl }).catch((e) => e);
    expect(err).toBeInstanceOf(TennisRecordFetchError);
    expect(err.kind).toBe("network");
    expect(err.message).not.toMatch(/^fetch failed$/i);
    expect(err.message).toMatch(/couldn't reach tennisrecord/i);
    expect(err.message).toMatch(/try again/i);
  });

  it("maps a 403 to an upstream error carrying the status + retry ask", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("blocked", { status: 403 })),
    );

    const err = await fetchTennisRecordTeam({ url: teamUrl }).catch((e) => e);
    expect(err).toBeInstanceOf(TennisRecordFetchError);
    expect(err.kind).toBe("upstream");
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/403/);
    expect(err.message).toMatch(/try again/i);
  });

  it("maps a 5xx to a friendly 'having trouble' upstream error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("oops", { status: 503 })),
    );

    const err = await fetchTennisRecordTeam({ url: teamUrl }).catch((e) => e);
    expect(err.kind).toBe("upstream");
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/having trouble/i);
    expect(err.message).toMatch(/try again/i);
  });

  it("keeps validation errors precise and does not ask to retry", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const err = await fetchTennisRecordTeam({ url: "not a link" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(TennisRecordFetchError);
    expect(err.kind).toBe("validation");
    expect(err.message).toMatch(/tennisrecord team link/i);
    expect(err.message).not.toMatch(/try again/i);
    // Bad input must never hit the network.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("succeeds and returns the page html on a 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse("<html>ok</html>")));

    const result = await fetchTennisRecordTeam({ url: teamUrl });
    expect(result.html).toBe("<html>ok</html>");
    expect(result.resolvedUrl).toContain("teamprofile.aspx");
  });
});

describe("searchTennisRecordTeams error handling", () => {
  it("maps a network rejection to a friendly retry-asking error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(networkError("ECONNRESET")),
    );

    const err = await searchTennisRecordTeams({ teamName: "Slice Girls" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(TennisRecordFetchError);
    expect(err.kind).toBe("network");
    expect(err.message).toMatch(/dropped/i);
    expect(err.message).toMatch(/try again/i);
  });

  it("maps a non-OK status to an upstream error with the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 429 })),
    );

    const err = await searchTennisRecordTeams({ teamName: "Slice Girls" }).catch(
      (e) => e,
    );
    expect(err.kind).toBe("upstream");
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/rate-limit/i);
    expect(err.message).toMatch(/try again/i);
  });

  it("rejects empty input as a validation error without hitting the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const err = await searchTennisRecordTeams({ teamName: "  " }).catch(
      (e) => e,
    );
    expect(err.kind).toBe("validation");
    expect(err.message).not.toMatch(/try again/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

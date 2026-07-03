import "server-only";
import { parseTeamUrl, parseSearchResults } from "./parse";
import type { TeamSearchResult } from "./parse";

// Network layer for tennisrecord. Kept separate from parse.ts so the parser
// stays pure/testable and the fetch strategy can be swapped without touching
// parsing. Server-only: this runs in API routes, never the browser (CORS +
// we set a browser-like UA that the client can't).
//
// RUNTIME RISK (documented in the plan): tennisrecord may block datacenter
// IPs (Vercel) or non-browser clients. If plain fetch starts returning 403/
// challenge HTML in production, the fallback is to drive the request through
// the already-installed `puppeteer` (real headless Chrome) — slot it in at
// the marked seam below. Do not add puppeteer-on-Vercel plumbing until plain
// fetch is proven blocked.

const TEAM_PROFILE_BASE =
  "https://www.tennisrecord.com/adult/teamprofile.aspx";
const TEAM_SEARCH_URL = "https://www.tennisrecord.com/adult/teamsearch.aspx";

// Browser-like headers — tennisrecord 403s obvious bots.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// "validation" = bad/empty caller input (retrying won't help → HTTP 400).
// "network"     = couldn't reach tennisrecord (retryable → 502).
// "upstream"    = tennisrecord answered with a non-OK status (retryable → 502).
export type FetchErrorKind = "validation" | "network" | "upstream";

export class TennisRecordFetchError extends Error {
  constructor(
    message: string,
    readonly kind: FetchErrorKind = "validation",
    readonly status?: number,
  ) {
    super(message);
    this.name = "TennisRecordFetchError";
  }
}

// Turn an undici/Node fetch rejection into a human reason. Node throws a bare
// `TypeError: fetch failed` and tucks the real cause (timeout, DNS, reset) on
// `.cause.code` — surface that instead of leaking "fetch failed" to captains.
function describeNetworkError(err: unknown): string {
  const code =
    err !== null &&
    typeof err === "object" &&
    "cause" in err &&
    (err as { cause?: { code?: unknown } }).cause !== null &&
    typeof (err as { cause?: { code?: unknown } }).cause === "object"
      ? (err as { cause?: { code?: string } }).cause?.code
      : undefined;

  let reason: string;
  switch (code) {
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_BODY_TIMEOUT":
    case "ETIMEDOUT":
      reason = "TennisRecord took too long to respond (timed out)";
      break;
    case "ENOTFOUND":
    case "EAI_AGAIN":
      reason = "Couldn't look up TennisRecord (a network/DNS issue)";
      break;
    case "ECONNREFUSED":
    case "ECONNRESET":
      reason = "The connection to TennisRecord was dropped";
      break;
    default:
      reason = "Couldn't reach TennisRecord";
  }
  return `${reason}. It may be temporarily down — please try again.`;
}

// Map a non-OK HTTP status to a friendly, mostly-retryable message.
function friendlyHttpMessage(status: number): string {
  if (status === 403) {
    return (
      "TennisRecord blocked this request (403), which usually clears up on " +
      "a retry. Please try again."
    );
  }
  if (status === 429) {
    return (
      "TennisRecord is rate-limiting requests right now (429). " +
      "Please wait a moment and try again."
    );
  }
  if (status === 404) {
    // Not really retryable — the page is gone, not flaky.
    return (
      "That team page couldn't be found on TennisRecord (404). " +
      "Double-check the team and search again."
    );
  }
  if (status >= 500) {
    return `TennisRecord is having trouble right now (status ${status}). Please try again.`;
  }
  return `TennisRecord returned an unexpected response (status ${status}). Please try again.`;
}

export type FetchTeamInput = {
  url?: string;
  teamName?: string;
};

export type FetchTeamResult = {
  html: string;
  resolvedUrl: string;
  teamKey: string;
  // Team name carried by the pasted URL (teamname= links), if any.
  urlTeamName?: string;
};

// Resolve the caller's input (a pasted URL or a bare team key) into a
// canonical team-profile URL. teamName-only lookup (no key) is not supported
// yet — tennisrecord search would need a separate scrape; surface a clear
// error so the UI can tell the captain to paste the team link.
function resolveTeamUrl(input: FetchTeamInput): {
  url: string;
  teamKey: string;
  urlTeamName?: string;
} {
  const raw = (input.url ?? input.teamName ?? "").trim();
  if (!raw) {
    throw new TennisRecordFetchError("Paste a tennisrecord team link.");
  }
  const parsed = parseTeamUrl(raw);
  if (!parsed) {
    throw new TennisRecordFetchError(
      "That doesn't look like a tennisrecord team link. Open the team on " +
        "tennisrecord.com and paste the page URL.",
    );
  }
  return {
    url: `${TEAM_PROFILE_BASE}?${parsed.query}`,
    teamKey: parsed.teamKey,
    urlTeamName: parsed.teamName,
  };
}

export async function fetchTennisRecordTeam(
  input: FetchTeamInput,
): Promise<FetchTeamResult> {
  const { url, teamKey, urlTeamName } = resolveTeamUrl(input);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: BROWSER_HEADERS,
      // tennisrecord is public; don't send/keep cookies.
      cache: "no-store",
      redirect: "follow",
    });
  } catch (err) {
    // ── puppeteer fallback seam: if plain fetch is network-blocked, drive
    //    this URL through headless Chrome here and return its page content.
    throw new TennisRecordFetchError(describeNetworkError(err), "network");
  }

  if (!res.ok) {
    // ── puppeteer fallback seam: a 403 here is the documented bot-block risk.
    throw new TennisRecordFetchError(
      friendlyHttpMessage(res.status),
      "upstream",
      res.status,
    );
  }

  const html = await res.text();
  return { html, resolvedUrl: url, teamKey, urlTeamName };
}

export type SearchTeamsInput = {
  teamName: string;
  year?: string;       // "2026"; defaults to the form's first option upstream
  section?: string;    // exact teamsearch option value, e.g. "Pacific NW"
  leagueType?: string; // exact option value, e.g. "Adult 18+"; "" = All
};

// Search tennisrecord for teams by name (+ optional year/section/league-type
// filters). teamsearch.aspx is a plain form POST (no ASP.NET viewstate), so we
// replicate it with a normal POST and parse the results table. This is the
// "find your team" path that replaces asking the captain to paste a raw link.
export async function searchTennisRecordTeams(
  input: SearchTeamsInput,
): Promise<TeamSearchResult[]> {
  const teamName = input.teamName.trim();
  if (!teamName) {
    throw new TennisRecordFetchError("Enter a team name to search.");
  }

  const form = new URLSearchParams({
    yearnum: input.year?.trim() || "2026",
    leaguetypename: input.leagueType?.trim() ?? "",
    sectionname: input.section?.trim() ?? "",
    teamname: teamName,
  });

  let res: Response;
  try {
    res = await fetch(TEAM_SEARCH_URL, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      // ── puppeteer fallback seam: same bot-block risk as team-profile GETs.
      cache: "no-store",
      redirect: "follow",
    });
  } catch (err) {
    throw new TennisRecordFetchError(describeNetworkError(err), "network");
  }

  if (!res.ok) {
    throw new TennisRecordFetchError(
      friendlyHttpMessage(res.status),
      "upstream",
      res.status,
    );
  }

  return parseSearchResults(await res.text());
}

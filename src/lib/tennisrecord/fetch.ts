import "server-only";
import { parseTeamUrl } from "./parse";

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

// Browser-like headers — tennisrecord 403s obvious bots.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export class TennisRecordFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TennisRecordFetchError";
  }
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
    throw new TennisRecordFetchError(
      err instanceof Error ? err.message : "Could not reach tennisrecord.",
    );
  }

  if (!res.ok) {
    // ── puppeteer fallback seam: a 403 here is the documented bot-block risk.
    throw new TennisRecordFetchError(
      `tennisrecord returned ${res.status}.`,
      res.status,
    );
  }

  const html = await res.text();
  return { html, resolvedUrl: url, teamKey, urlTeamName };
}

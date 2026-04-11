import { NextRequest, NextResponse } from "next/server";

/**
 * Catch-all reverse proxy for Seattle Parks ActiveNet.
 *
 * Every request to /seattle/* on our domain is forwarded to
 * https://anc.apm.activecommunities.com/seattle/* — including HTML,
 * JS, CSS, and API calls made by the embedded SPA.
 *
 * This makes the iframe "same origin" from the browser's perspective,
 * so that:
 *   1. X-Frame-Options on the HTML response is stripped by us → iframe loads
 *   2. Relative URLs in the SPA (like /seattle/rest/reservation/...)
 *      resolve to OUR domain and hit the proxy again → no CORS issue
 *   3. Cookies set by the upstream are rewritten to our domain so the
 *      browser sends them back on subsequent requests
 */

// The modern CUI SPA is at anc.apm; a small set of truly legacy endpoints
// (`ActiveNet_Login`, `Activity_Search`, `servlet/*`) live only on the older
// apm.activecommunities.com host. Everything else — including `myaccount`,
// `wishlist`, `Create_Account`, `signin`, `reservation`, `rest/*`, etc. —
// is handled by the modern CUI and must go to ANC.
const ANC_ORIGIN = "https://anc.apm.activecommunities.com";
const APM_ORIGIN = "https://apm.activecommunities.com";

function chooseUpstream(pathStr: string): string {
  // Only these specific prefixes are legacy-only. Routing anything else to
  // APM causes 404s — e.g. /seattle/myaccount exists on ANC but not APM.
  if (/^(ActiveNet_|Activity_|servlet)/i.test(pathStr)) {
    return APM_ORIGIN;
  }
  return ANC_ORIGIN;
}

// Headers we should not forward upstream (they'd confuse the upstream or cause issues)
const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "accept-encoding",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "keep-alive",
  "te",
  "trailer",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

// Headers we should not pass back to the client (frame blockers, etc.)
const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "keep-alive",
  "te",
  "trailer",
  // Frame blockers — remove so we CAN iframe this
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
]);

async function proxy(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await ctx.params;
  const pathStr = path.join("/");

  // Pick the correct upstream based on the first path segment
  const upstreamOrigin = chooseUpstream(pathStr);
  const upstreamHost = new URL(upstreamOrigin).host;

  // Build upstream URL, preserving the query string
  const upstreamUrl = new URL(`${upstreamOrigin}/seattle/${pathStr}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value);
  });

  // Forward request headers (minus hop-by-hop and overrides)
  const upstreamHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (HOP_BY_HOP_REQUEST_HEADERS.has(key.toLowerCase())) return;
    // Skip the referer/origin since they'd leak our domain; set below
    if (key.toLowerCase() === "referer" || key.toLowerCase() === "origin") return;
    upstreamHeaders.set(key, value);
  });
  upstreamHeaders.set("Host", upstreamHost);
  upstreamHeaders.set("Origin", upstreamOrigin);
  upstreamHeaders.set("Referer", upstreamUrl.toString());

  // Prepare the body for non-GET/HEAD methods
  const method = request.method.toUpperCase();
  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl.toString(), {
      method,
      headers: upstreamHeaders,
      body,
      redirect: "manual", // handle redirects ourselves so we can rewrite Location
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Proxy fetch failed",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 }
    );
  }

  // Build response headers
  const responseHeaders = new Headers();
  upstreamRes.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(k)) return;
    if (k === "set-cookie") return; // handle below
    if (k === "location") {
      // Rewrite absolute redirects on either ActiveNet origin (http OR https)
      // to our relative proxy path. The upstream sometimes emits http://
      // Location headers for ActiveNet_Home, which would leak out of the
      // iframe if not rewritten.
      responseHeaders.set(
        "location",
        value
          .replace(/^https?:\/\/anc\.apm\.activecommunities\.com/i, "")
          .replace(/^https?:\/\/apm\.activecommunities\.com/i, "")
      );
      return;
    }
    responseHeaders.set(key, value);
  });

  // Forward Set-Cookie headers, stripping the Domain attribute so the cookie is
  // scoped to our domain (so the browser sends it back on subsequent requests)
  const setCookies = upstreamRes.headers.getSetCookie?.() || [];
  for (const cookie of setCookies) {
    const rewritten = cookie
      .replace(/;\s*Domain=[^;]+/i, "")
      // Some cookies set Secure, which works fine in prod but not in http://localhost dev
      .replace(/;\s*Secure/i, process.env.NODE_ENV === "production" ? "; Secure" : "");
    responseHeaders.append("set-cookie", rewritten);
  }

  // Handle the response body
  const contentType = upstreamRes.headers.get("content-type") || "";
  const isHtml = contentType.includes("text/html");
  const isJs = contentType.includes("application/javascript") || contentType.includes("text/javascript");

  if (isHtml || isJs) {
    // Rewrite any absolute links/strings that point back to either ActiveNet
    // origin so navigation and XHR stay within our proxy. Match both http
    // and https schemes.
    let body = await upstreamRes.text();
    body = body
      .replace(/https?:\/\/anc\.apm\.activecommunities\.com/gi, "")
      .replace(/https?:\/\/apm\.activecommunities\.com/gi, "");

    // For HTML, inject a script that forces full-page navigation for paths
    // served by the legacy CUI and skips the broken ActiveNet_Login redirect
    // chain by sending users straight to /seattle/signin.
    // The SPA's router uses history.pushState for those paths but has no
    // client-side route for them, causing a "Page not found" error.
    if (isHtml) {
      // Only paths that (a) the SPA's client-side router has no route for and
      // (b) need to reach our proxy via a full HTTP request. Deliberately
      // EXCLUDES /seattle/signin — that IS a valid SPA route and the SPA uses
      // replaceState on it to update query params, which we must not intercept.
      //
      // To avoid a "Page not found" flash when the user clicks "Sign in now",
      // we intercept the click by TEXT CONTENT in capture phase (before the
      // SPA's React handler runs) and use stopImmediatePropagation() to
      // prevent the SPA from ever entering its 404 state.
      const interceptScript = `<script>(function(){
var LEGACY=/^\\/seattle\\/(ActiveNet_|Activity_|Create_Account|myaccount|wishlist|servlet|logout)/i;
// Build the ActiveNet signin URL with a base64-encoded params= callback
// pointing back to the tennis-court reservation search page. After
// successful authentication, ActiveNet redirects to this callback URL so
// the user lands back on the search page — not on their account page.
var CALLBACK_URL='https://anc.apm.activecommunities.com/seattle/reservation/search?keyword=tennis court&resourceType=0&equipmentQty=0&fromLoginPage=true&from_original_cui=true';
var SIGNIN_URL='/seattle/signin?onlineSiteId=0&from_original_cui=true&override_partial_error=False&custom_amount=False&params='+encodeURIComponent(btoa(CALLBACK_URL))+'&locale=en-US';
var TEXT_TO_URL={
  'sign in':SIGNIN_URL,
  'sign in now':SIGNIN_URL,
  'create an account':'/seattle/Create_Account',
  'my account':'/seattle/myaccount',
  'sign out':'/seattle/ActiveNet_Login?logoff=true',
  'log out':'/seattle/ActiveNet_Login?logoff=true'
};
function rewrite(url){
  if(typeof url!=='string')return url;
  // Shortcut the broken ActiveNet_Login redirect chain: go straight to signin
  if(/^\\/seattle\\/ActiveNet_Login(?!\\?logoff)/i.test(url)){
    return SIGNIN_URL;
  }
  return url;
}
// Override history.pushState as a backup for code paths that don't go
// through a click event.
var origPush=history.pushState;
history.pushState=function(state,title,url){
  if(typeof url==='string'&&LEGACY.test(url)){
    window.location.href=rewrite(url);
    return;
  }
  return origPush.apply(this,arguments);
};
// Primary interception: catch clicks BEFORE the SPA's React handler runs.
// We ONLY match anchor tags (<a>) — never <button> — because the actual
// login submit button on the signin page has text "Sign in" and would
// otherwise be hijacked, preventing the login form from submitting.
// Navigation links ("Sign In" header, "Sign in now" inline prompt) are
// always <a> tags, so restricting to anchors is safe.
document.addEventListener('click',function(e){
  var el=e.target.closest&&e.target.closest('a');
  if(!el)return;
  var href=el.getAttribute('href')||'';
  // Match by href first (absolute legacy path)
  if(LEGACY.test(href)){
    e.preventDefault();
    e.stopImmediatePropagation();
    window.location.href=rewrite(href);
    return;
  }
  // Match by text content only for javascript:void(0) or empty-href anchors
  // so we don't accidentally interfere with real navigational anchors on
  // the signin page etc.
  if(href==='javascript:void(0);'||href==='javascript:void(0)'||href===''||href==='#'){
    var text=(el.textContent||'').trim().toLowerCase();
    var target=TEXT_TO_URL[text];
    if(target){
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href=target;
    }
  }
},true);
})();</script>`;
      // Inject right after the opening <head> tag so it runs before any SPA script
      if (body.includes("<head>")) {
        body = body.replace("<head>", `<head>${interceptScript}`);
      } else if (/<head[^>]*>/.test(body)) {
        body = body.replace(/<head([^>]*)>/, `<head$1>${interceptScript}`);
      }
    }

    // Ensure content-length is not set (we changed the body)
    responseHeaders.delete("content-length");
    return new NextResponse(body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  }

  // Non-HTML: stream the raw body through
  const buf = await upstreamRes.arrayBuffer();
  return new NextResponse(buf, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(request, ctx);
}
export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(request, ctx);
}
export async function PUT(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(request, ctx);
}
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(request, ctx);
}
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(request, ctx);
}
export async function OPTIONS(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(request, ctx);
}
export async function HEAD(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(request, ctx);
}

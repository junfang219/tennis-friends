#!/usr/bin/env node
/**
 * Sync the iOS app's dev-server URL to this Mac's current LAN IP.
 *
 * Why this exists: capacitor.config.ts uses `server.url` (not the bundled
 * `out/`), so a physical iPhone loads the Next.js dev server over Wi-Fi at
 * http://<mac-lan-ip>:3000. DHCP reassigns that IP whenever the lease
 * changes, and a stale IP shows up as an all-white screen on launch (the
 * WebView can't reach anything). This script detects the live IP, rewrites
 * capacitor.config.ts, and runs `cap copy ios` so the baked-in
 * ios/App/App/capacitor.config.json is refreshed before you build in Xcode.
 *
 * Usage:
 *   npm run ios:ip          # detect IP, update config, copy into iOS project
 *
 * Simulator note: the simulator shares the Mac's loopback, so set
 * server.url to http://localhost:3000 by hand for simulator runs. This
 * script only rewrites an existing IPv4 URL — it leaves a localhost URL
 * alone (and tells you), so it won't clobber your simulator config.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(ROOT, "capacitor.config.ts");

/** Return the active LAN IPv4, trying common interfaces in order. */
function detectLanIp() {
  // en0 = Wi-Fi on most Macs, en1 = secondary / Ethernet on others.
  for (const iface of ["en0", "en1", "en2"]) {
    try {
      const ip = execSync(`ipconfig getifaddr ${iface}`, {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      if (ip) return ip;
    } catch {
      // interface has no IP — try the next one
    }
  }
  return null;
}

const ip = detectLanIp();
if (!ip) {
  console.error(
    "✖ Could not detect a LAN IP (no en0/en1/en2 address). Are you on Wi-Fi?"
  );
  process.exit(1);
}

let config = readFileSync(CONFIG, "utf8");

const urlMatch = config.match(/DEV_SERVER_URL = 'http:\/\/([^']+):3000'/);
if (!urlMatch) {
  console.error(
    "✖ Couldn't find `DEV_SERVER_URL = 'http://...:3000'` in capacitor.config.ts"
  );
  process.exit(1);
}

const currentHost = urlMatch[1];
// Only rewrite a bare IPv4 URL. Leave localhost (simulator) and hostnames
// like Juns-MacBook-Pro-3.local (the set-and-forget mDNS default) untouched —
// they don't go stale on a DHCP change, so there's nothing to fix.
const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(currentHost);
if (!isIpv4) {
  console.log(
    `ℹ server.url host is '${currentHost}' — not a raw IP, leaving it unchanged.\n` +
      "  (localhost = simulator; *.local = stable mDNS hostname.)\n" +
      "  To force the raw LAN IP, set url to an http://<ip>:3000 form and re-run."
  );
  process.exit(0);
}

if (currentHost === ip) {
  console.log(`✔ Already pointed at ${ip} — nothing to change.`);
} else {
  // Rewrite the dev-server URL literal. allowNavigation derives its host from
  // DEV_SERVER_URL at runtime (new URL(...).hostname), so there's nothing else
  // to patch here.
  config = config.replace(
    /DEV_SERVER_URL = 'http:\/\/[^']+:3000'/,
    `DEV_SERVER_URL = 'http://${ip}:3000'`
  );
  writeFileSync(CONFIG, config);
  console.log(`✔ Updated capacitor.config.ts: ${currentHost} → ${ip}`);
}

console.log("→ Running `cap copy ios` to refresh the iOS config…");
// CAP_ENV=development so capacitor.config.ts resolves to the dev server URL
// (the default is production, which would otherwise bake in the prod URL).
execSync("npx cap copy ios", {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, CAP_ENV: "development" },
});
console.log(
  `\n✔ Done. iOS app will load http://${ip}:3000 — rebuild/relaunch in Xcode.`
);

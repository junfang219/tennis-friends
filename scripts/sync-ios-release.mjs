import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = { ...process.env };
delete env.CAP_ENV;
execFileSync(process.execPath, ["node_modules/@capacitor/cli/bin/capacitor", "sync", "ios"], {
  env,
  stdio: "inherit",
});

const resources = new URL("../ios/App/App/", import.meta.url);
const config = JSON.parse(readFileSync(new URL("capacitor.config.json", resources), "utf8"));
const entry = readFileSync(new URL("public/index.html", resources), "utf8");
if (config.server?.url !== "https://mytennisfriends.com" || config.server.cleartext || !entry.includes("<title>TennisFriend</title>")) {
  throw new Error("The iOS resources are missing the packaged entry point or production HTTPS configuration.");
}

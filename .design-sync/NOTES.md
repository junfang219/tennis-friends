# design-sync notes — TennisFriends

## Shape: off-script, tokens-only

This repo (`tennisfriend-app`) is a **Next.js application**, not a buildable
component library. There is no published package with a `dist/`, no Storybook,
and ~40 of 73 components in `src/components/` are coupled to Supabase /
`next/navigation` / server actions, so they can't render standalone in the
design agent's runtime. The user explicitly scoped this sync to **tokens +
fonts only** (no components).

To drive the converter's tokens-only path deterministically we stage a tiny
DS "package" under `.design-sync/ds-src/`:
- `package.json` — name `tennisfriends-ds`, no `exports`/`types`/`main` → zero
  typed exports → `[ZERO_MATCH]` → `tokensOnly: true`.
- `index.js` — empty entry (`export {}`).
- `styles.css` — the curated design foundation (`cfg.cssEntry`): Google-Fonts
  `@import`, the full color-token `:root` (union of `tailwind.config.ts` +
  `globals.css`, incl. club-purple / circle-lime / ball-pale that globals.css
  omits), and the brand utility classes (`.btn-*`, `.card-hover`, `.skeleton`,
  textures, animations) lifted verbatim from `src/app/globals.css`.

### Build / validate commands (run from repo root)
```
node .ds-sync/package-build.mjs    --config .design-sync/config.json --node-modules ./node_modules --entry .design-sync/ds-src/index.js --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle --no-render-check
```
`--node-modules ./node_modules` is only needed for `vendorReact` (the repo's
React 19). `--entry` is the staged empty module; `PKG_DIR` resolves to
`.design-sync/ds-src/`.

## Known warns (expected — not new)
- `[FONT_REMOTE] "DM Sans" / "Playfair Display"` — fonts load via a remote
  Google-Fonts `@import` inside `_ds_bundle.css`; no `@font-face` ships. By
  design. No action.
- `[RENDER_SKIPPED] (--no-render-check)` — there are **zero component
  previews** in a tokens-only DS, so the headless render check is moot. We pass
  `--no-render-check` deliberately rather than installing chromium. Not an
  "unverified components" risk — there are no components to verify.

## Re-sync risks / watch-list
- The `resync.mjs` driver is **not** used (it's built for the component
  pipeline; for tokens-only it adds a diff/capture/render stage that does
  nothing here). Re-sync = re-run the two commands above, then upload.
- The token set is **hand-curated** from `tailwind.config.ts` + `globals.css`.
  If those files change (new color family, renamed token, changed hex), update
  `.design-sync/ds-src/styles.css` to match — nothing automatically detects
  drift. Cross-check after any palette change in the app.
- `conventions.md` enumerates exact var/class names; re-validate them against
  the rebuilt `ds-bundle/_ds_bundle.css` after any token edit (grep the
  `--color-*` / `--font-*` / `.btn-*` names) before re-uploading.
- No `_ds_sync.json` anchor dependence: the build emits one with 0 render
  hashes; a re-sync simply rebuilds and re-uploads (cheap).
- Tailwind color utilities (`bg-court-green`, etc.) are intentionally NOT
  shipped (no Tailwind runtime). The conventions header tells the design agent
  to use `var(--color-*)` instead — keep that guidance if the scope ever
  expands.

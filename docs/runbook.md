# TennisFriend production runbook

## Database (Supabase)

**Project:** `TennisFriend` (`fqopzafmnaviipumsmfm`) — us-west-1, Postgres 17.6, Micro tier.

### Dashboards
- API + Auth: https://supabase.com/dashboard/project/fqopzafmnaviipumsmfm
- SQL editor: https://supabase.com/dashboard/project/fqopzafmnaviipumsmfm/sql
- Logs: https://supabase.com/dashboard/project/fqopzafmnaviipumsmfm/logs/explorer
- Database advisors: https://supabase.com/dashboard/project/fqopzafmnaviipumsmfm/advisors
- Compute size: https://supabase.com/dashboard/project/fqopzafmnaviipumsmfm/settings/compute-and-disk

### Schema source of truth (pre-launch)

**Until we have real users**, the schema is one file: `supabase/schema.sql`. To make a change:

1. Edit the relevant section of `supabase/schema.sql` directly (no numbered migration file).
2. Apply against the live project via MCP (`apply_migration` with the patched SQL fragment) **or** via the dashboard SQL editor.
3. Regenerate `src/lib/database.types.ts` via the MCP `generate_typescript_types` tool.
4. Update integration tests to cover the change.
5. Verify: `npx tsc --noEmit` + `npm run test:integration`.

This trades the safety of a forward-only chain (which we don't need yet) for one searchable canonical file. **Switch back to a numbered migration chain the day we get real users** — once data exists, you can't DROP/CREATE freely. See the memory `project_schema_single_source_of_truth.md`.

### Rebuilding the schema from scratch

```bash
# In a fresh Supabase project (or the SQL editor of the existing one):
psql "$SUPABASE_DB_URL" < supabase/schema.sql
# Then re-link the project, regenerate types, and run the tests.
```

### Backups
Daily on Pro plan. Manual snapshot before risky changes:
```bash
supabase db dump --linked > backups/$(date +%Y%m%d-%H%M).sql
```

After making a change to the live DB, refresh the canonical file:
```bash
supabase db dump --linked --schema public > supabase/schema.sql
# Trim PostGIS bookkeeping + role-grants the dump emits but our schema doesn't manage.
```

## Tests

| Command | What it runs |
|---|---|
| `npm test` | Unit tests (Vitest, fast, no external deps) |
| `npm run test:integration` | Integration tests against the live Supabase project. Creates + deletes real auth users. Required after every RLS change. |
| `npm run test:e2e` | Playwright e2e (UI flows; needs dev server) |
| `npm run test:coverage` | Vitest coverage report |

### Load tests (k6, not in CI)
```bash
brew install k6
JWT=$(...)  # grab a real session token
k6 run -e SUPABASE_URL=https://fqopzafmnaviipumsmfm.supabase.co \
       -e PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
       -e JWT=$JWT \
       tests/loadtest/feed.js
```
Targets: p95 < 500ms at 100 RPS on `feed.js`, 1K concurrent subs on `realtime-chat.js`.

## Observability

- **Sentry:** `src/instrumentation.ts` auto-initializes if `NEXT_PUBLIC_SENTRY_DSN`
  is set. Install with `npm install @sentry/nextjs` and create a project on
  sentry.io to get the DSN. Without DSN it's a silent no-op (fine for dev).
- **Supabase logs:** explorer above. Useful filters:
  - `metadata.status_code >= 500` for server errors
  - `service:auth` to inspect signin/signup flows
- **Vercel Analytics:** turn on in your Vercel project for frontend perf.

## Common ops

### Apply a migration manually (no MCP)
```bash
npx supabase link --project-ref fqopzafmnaviipumsmfm
npx supabase db push
```

### Regenerate TS types after schema change
```bash
npx supabase gen types typescript --linked > src/lib/database.types.ts
```
CI should fail if migrations changed but types weren't regenerated.

### Rotate the secret key
1. Supabase dashboard → Settings → API keys → "Rotate secret key"
2. Update `SUPABASE_SECRET_KEY` in `.env` and any deploy secrets store.
3. Restart server-side processes.

### Roll back a migration
```bash
# Locally:
supabase db reset --linked  # nukes data, replays migrations
# Production: write a new migration that reverses the change. Never delete files.
```

### Restore from backup (PITR)
Dashboard → Database → Backups → "Restore point in time". Tip: do it on
a branch first if branching is enabled.

## On-call alerts (post-launch checklist)

- [ ] Sentry: alert on >10 errors/min
- [ ] Supabase: alert on DB CPU >80% sustained (compute upgrade time)
- [ ] Supabase: alert on connection pool exhaustion (PgBouncer logs)
- [ ] Vercel: alert on >5% 5xx rate
- [ ] APNs delivery rate <95% (we send push from the Edge Function)

## Phase 5 cutover

See `docs/phase-5-cutover.md`. The Supabase infrastructure is in place;
the remaining work is mechanical migration of ~119 route handlers from
Prisma + NextAuth to Supabase + RLS. Estimated 5-7 days.

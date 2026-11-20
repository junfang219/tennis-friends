// Isolated test schema only. Never reads connection strings or production data.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function teamOnboardingTestSql() {
 const fixture = await readFile('tests/sql/team-onboarding-fixture.sql', 'utf8');
 const canonical = await readFile('supabase/schema.sql', 'utf8');
 const start = canonical.indexOf('CREATE OR REPLACE FUNCTION public._merge_placeholder_into_user');
 const end = canonical.indexOf('-- Reworked to delegate', start);
 if (start < 0 || end < 0) throw new Error('Canonical merge helper not found');
 const suffixes = ['_team_onboarding.sql', '_fix_team_onboarding_invitation_lifecycle.sql', '_shared_team_join_approval.sql', '_roster_first_team_management.sql', '_guided_team_setup_details.sql', '_automatic_sms_team_invitations.sql', '_atomic_onboarding_deliveries.sql', '_allow_acceptance_with_delivery_guards.sql', '_reuse_unissued_sms_drafts.sql', '_recheck_team_managers_and_recover_expired_drafts.sql', '_team_invitation_follow_up.sql'];
 const names = (await readdir('supabase/migrations')).filter(name => suffixes.some(suffix => name.endsWith(suffix))).sort();
 const migrations = await Promise.all(names.map(name => readFile(`supabase/migrations/${name}`, 'utf8')));
 return [fixture, canonical.slice(start, end), ...migrations].join('\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.stdout.write(await teamOnboardingTestSql());

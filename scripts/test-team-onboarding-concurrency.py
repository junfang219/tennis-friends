"""Real concurrent transactions against an ephemeral, Unix-socket-only Postgres.

Requires initdb, pg_ctl, psql, Node, and Python on PATH. No live DB connection,
provider call, environment file, or additional Python dependency is used.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from uuid import uuid4


class TeamManagerLockTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for binary in ("initdb", "pg_ctl", "psql", "node"):
            if not shutil.which(binary):
                raise RuntimeError(f"Install local PostgreSQL and Node; {binary} is missing")
        cls.temp = tempfile.TemporaryDirectory(prefix="tf-lock-")
        cls.root = Path(cls.temp.name)
        cls.env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
        cls.started = False
        cls.addClassCleanup(cls.cleanup_cluster)
        subprocess.run(["initdb", "-D", str(cls.root / "data"), "-A", "trust", "-U", "reviewer", "--no-locale"], env=cls.env, check=True, capture_output=True)
        subprocess.run(["pg_ctl", "-D", str(cls.root / "data"), "-l", str(cls.root / "server.log"), "-o", f"-k {cls.root} -c listen_addresses='' -p 54832", "-w", "start"], env=cls.env, check=True, capture_output=True)
        cls.started = True
        cls.args = ["psql", "-X", "-h", str(cls.root), "-p", "54832", "-U", "reviewer", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"]
        fixture = subprocess.check_output(["node", "scripts/team-onboarding-test-fixture.mjs"], text=True)
        cls.sql(fixture)

    @classmethod
    def cleanup_cluster(cls):
        if cls.started:
            subprocess.run(["pg_ctl", "-D", str(cls.root / "data"), "-m", "immediate", "-w", "stop"], env=cls.env, capture_output=True, timeout=15, check=True)
        cls.temp.cleanup()

    @classmethod
    def sql(cls, query):
        result = subprocess.run(cls.args, input=query, text=True, env=cls.env, capture_output=True, timeout=15)
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    def setUp(self):
        self.owner, self.manager, self.player, self.group, self.manager_member = [str(uuid4()) for _ in range(5)]
        self.sql(f"""
            INSERT INTO profiles VALUES('{self.owner}','Owner','owner@example.com'),('{self.manager}','Manager','manager@example.com'),('{self.player}','Player','player@example.com');
            SELECT set_config('request.jwt.claim.sub','{self.owner}',false);
            SELECT save_team_onboarding('{self.group}','{{"name":"Lock test","includeUsta":false,"teamNumber":"","deadline":""}}','[]');
            INSERT INTO group_members(id,group_id,user_id,roles) VALUES('{self.manager_member}','{self.group}','{self.manager}','{{manager}}');
            SELECT manage_team_join_link('{self.group}','enable');
            SELECT set_config('request.jwt.claim.sub','{self.player}',false);
            SELECT request_team_join((SELECT token FROM team_join_links WHERE group_id='{self.group}'));
        """)
        self.request = self.sql(f"SELECT id FROM team_join_requests WHERE group_id='{self.group}'")
        self.invitee = str(uuid4())
        self.sql(f"SELECT set_config('request.jwt.claim.sub','{self.owner}',false); SELECT patch_team_sms_invitations('{self.group}','{json.dumps({'action':'sms-recipients','recipients':[{'id':self.invitee,'name':'Draft','phone':'+12065550101'}]})}');")

    def snapshot(self):
        # Compare all affected records; denied work must not leak through partially.
        return self.sql(f"SELECT jsonb_build_object('members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM group_members m WHERE group_id='{self.group}'),'config',(SELECT config FROM team_onboarding WHERE group_id='{self.group}'),'link',(SELECT to_jsonb(l) FROM team_join_links l WHERE group_id='{self.group}'),'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM team_join_requests r WHERE group_id='{self.group}'),'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM team_onboarding_players p WHERE group_id='{self.group}'))")

    def queued_call(self, operation, revocation="remove"):
        holder = subprocess.Popen(self.args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.env)
        worker = None
        try:
            revoke = f"SELECT patch_team_onboarding('{self.group}','{{\"action\":\"remove-member\",\"memberId\":\"{self.manager_member}\"}}');" if revocation == "remove" else f"UPDATE group_members SET roles='{{}}' WHERE id='{self.manager_member}';" if revocation == "demote" else ""
            holder.stdin.write(f"SELECT set_config('request.jwt.claim.sub','{self.owner}',false); BEGIN; SELECT 1 FROM groups WHERE id='{self.group}' FOR UPDATE; {revoke} SELECT 'lock-held';\n")
            holder.stdin.flush()
            while True:
                line = holder.stdout.readline()
                if line.strip() == "lock-held":
                    break
                if not line:
                    self.fail("Owner did not acquire the team lock: " + holder.stderr.read())
            tag = "lock-test-" + str(uuid4())
            worker = subprocess.Popen(self.args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.env)
            worker.stdin.write(f"\\set VERBOSITY verbose\nSET application_name='{tag}'; SELECT set_config('request.jwt.claim.sub','{self.manager}',false); SET ROLE authenticated; SELECT {operation};\n")
            worker.stdin.close()
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if self.sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{tag}' AND wait_event_type='Lock'") == "1":
                    break
                time.sleep(.025)
            else:
                self.fail("Manager operation did not wait for the owner's team lock")
            holder.stdin.write("COMMIT;\n")
            holder.stdin.close()
            holder.wait(timeout=10)
            self.assertEqual(holder.returncode, 0, holder.stderr.read())
            worker.wait(timeout=10)
            return worker.returncode, worker.stdout.read(), worker.stderr.read()
        finally:
            for process in (worker, holder):
                if process is not None:
                    if process.poll() is None:
                        process.kill()
                        process.wait(timeout=5)
                    for stream in (process.stdin, process.stdout, process.stderr):
                        if stream is not None and not stream.closed:
                            stream.close()

    def assert_revoked(self, operation, revocation="remove"):
        # Expected state is the original data with only owner revocation applied.
        before = json.loads(self.snapshot())
        if revocation == "remove":
            before['members'] = [m for m in before['members'] if m['id'] != self.manager_member]
        else:
            next(m for m in before['members'] if m['id'] == self.manager_member)['roles'] = []
        code, _, error = self.queued_call(operation, revocation)
        self.assertNotEqual(code, 0)
        self.assertIn("42501", error)
        self.assertEqual(json.loads(self.snapshot()), before)

    def test_removed_manager_cannot_approve_after_waiting(self):
        self.assert_revoked(f"review_team_join_request('{self.group}','{self.request}','approve',NULL)")

    def test_demoted_manager_cannot_reject_after_waiting(self):
        self.assert_revoked(f"review_team_join_request('{self.group}','{self.request}','reject',NULL)", "demote")

    def test_removed_manager_cannot_read_request_contacts(self):
        self.assert_revoked(f"manage_team_join_link('{self.group}','read')")

    def test_removed_manager_cannot_replace_shared_link(self):
        self.assert_revoked(f"manage_team_join_link('{self.group}','replace')")

    def test_demoted_manager_cannot_change_registration(self):
        self.assert_revoked(f"patch_team_onboarding('{self.group}','{{\"action\":\"registration\",\"includeUsta\":true,\"ustaTeamName\":\"Test\",\"teamNumber\":\"0000000000\",\"deadline\":\"2099-12-01\",\"includeRegistrationLink\":false}}')", "demote")

    def test_removed_manager_cannot_remove_another_player(self):
        member = self.sql(f"SELECT member_id FROM team_onboarding_players WHERE id='{self.invitee}'")
        self.assert_revoked(f"patch_team_onboarding('{self.group}','{{\"action\":\"remove-member\",\"memberId\":\"{member}\"}}')")

    def test_removed_manager_cannot_renew_invitation(self):
        self.assert_revoked(f"renew_team_onboarding_invitation('{self.group}','{self.invitee}')")

    def test_still_authorized_manager_can_approve_after_waiting(self):
        code, _, error = self.queued_call(f"review_team_join_request('{self.group}','{self.request}','approve',NULL)", "unchanged")
        self.assertEqual(code, 0, error)
        self.assertEqual(self.sql(f"SELECT count(*) FROM group_members WHERE group_id='{self.group}' AND user_id='{self.player}'"), "1")


if __name__ == '__main__':
    unittest.main(verbosity=2)

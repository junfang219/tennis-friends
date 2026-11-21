"""Capacity and access regression checks in a disposable PostgreSQL cluster.

Run from the repository with initdb, pg_ctl and psql on PATH.
The cluster only listens on a private Unix socket and uses synthetic data.
"""
from pathlib import Path
from subprocess import Popen, PIPE, run
from time import monotonic, sleep
from tempfile import TemporaryDirectory
from uuid import uuid4
import os
import shutil

root = Path(__file__).resolve().parents[1]
snapshot = (root / "supabase/schema.sql").read_text()
migration = (root / "supabase/migrations/20261121192916_unify_private_friend_groups.sql").read_text()
commands = {}
for name in ("initdb", "pg_ctl", "psql"):
    path = shutil.which(name)
    if path is None:
        raise SystemExit(f"Install local PostgreSQL and add {name} to PATH")
    commands[name] = path


def segment(start, end, offset=0):
    begin = snapshot.index(start, offset)
    return snapshot[begin:snapshot.index(end, begin)]
def policy(name):
    start = snapshot.index(f"CREATE POLICY {name}")
    return snapshot[start:snapshot.index(";", start)+1]
def function(name, offset=0):
    start = snapshot.lower().index(f"create or replace function public.{name}(", offset)
    return snapshot[start:snapshot.index("$$;", start)+3]

fixture = """
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
CREATE TABLE profiles (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE posts (id uuid PRIMARY KEY);
CREATE TABLE blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE friendships (requester_id uuid, addressee_id uuid, status text);
CREATE TYPE notification_type AS ENUM ('comment');
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, actor_id uuid, type notification_type);
CREATE FUNCTION invoke_edge_function(text, jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END; $$;
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO authenticated;
GRANT SELECT ON profiles, friendships TO authenticated;
""" + segment('create table public.friend_groups (', '-- =========================================================================\n-- Groups (teams / clubs)') + segment('create table public.chats (', 'create table public.chat_messages (') + function('is_friend') + function('is_blocked') + function('is_chat_participant', snapshot.index('-- is_friend stays SECURITY INVOKER') - 450) + """
ALTER TABLE friend_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
"""
for name in ("friend_groups_select_owner", "friend_groups_insert_owner", "friend_groups_update_owner",
             "friend_groups_delete_owner", "friend_group_members_select", "friend_group_members_insert_owner",
             "friend_group_members_update_owner", "friend_group_members_delete_self_or_owner", "chats_select_participant",
             "chats_insert_self", "chats_update_creator", "chats_delete_creator", "chat_participants_select_member",
             "chat_participants_insert_member_or_creator", "chat_participants_update_self",
             "chat_participants_delete_self_or_creator"):
    fixture += "\n" + policy(name)
fixture += "\n" + segment("CREATE TYPE public.friend_group_kind AS ENUM", "-- =====================================================================\n-- 0013_chat_looking_for_player") + segment("CREATE TABLE public.friend_group_invite_links", "-- =====================================================================\n-- team_expenses")
owner, member, friend, outsider, legacy_group, old_club, legacy_chat = [str(uuid4()) for _ in range(7)]

with TemporaryDirectory(prefix="tf-friend-group-db-") as temp:
    env = {k:v for k,v in os.environ.items() if not k.startswith("PG")}
    datadir = Path(temp) / "data"
    def process(args, sql=None):
        result = run(args, input=sql, text=True, env=env, capture_output=True, timeout=20)
        return result
    def check(result):
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()
    check(process([commands["initdb"], "-D", datadir, "-A", "trust", "-U", "reviewer", "--no-locale"]))
    check(process([commands["pg_ctl"], "-D", datadir, "-l", Path(temp)/"log", "-o", f"-k {temp} -c listen_addresses='' -p 54888", "-w", "start"]))
    psql = [commands["psql"], "-XqAt", "-h", temp, "-p", "54888", "-U", "reviewer", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
    def sql(query, actor=None):
        scope = f"SET request.jwt.claim.sub = '{actor}'; SET ROLE authenticated; " if actor else ""
        return check(process(psql, scope + query))
    def denied(query, actor, expected):
        result = process(psql, f"SET request.jwt.claim.sub = '{actor}'; SET ROLE authenticated; " + query)
        assert result.returncode and expected.lower() in result.stderr.lower(), result.stderr

    try:
        sql(fixture)
        sql(f"""
        INSERT INTO profiles VALUES ('{owner}','Owner'),('{member}','Member'),('{friend}','Friend'),('{outsider}','Outsider');
        INSERT INTO friendships VALUES ('{owner}','{member}','accepted'),('{member}','{friend}','accepted'),('{owner}','{outsider}','accepted');
        INSERT INTO friend_groups (id, name, owner_id, kind) VALUES ('{legacy_group}','Legacy group','{owner}','circle'),('{old_club}','Legacy shared group','{owner}','club');
        INSERT INTO friend_group_members (friend_group_id, user_id) VALUES ('{legacy_group}','{member}');
        INSERT INTO chats (id,name,creator_id,friend_group_id) VALUES ('{legacy_chat}','Legacy group','{outsider}','{legacy_group}');
        INSERT INTO chat_participants (chat_id,user_id,muted) VALUES ('{legacy_chat}','{member}',true),('{legacy_chat}','{outsider}',false);
        """)
        legacy = sql(f"SELECT create_club('Personal invite', ARRAY['{member}']::uuid[])->>'club_id'", owner)
        personal = sql(f"SELECT id FROM friend_group_invites WHERE friend_group_id='{legacy}'")
        token = sql(f"SELECT get_or_create_club_invite_link('{legacy}')->>'token'", owner)
        assert token

        sql(migration)
        assert sql(f"SELECT kind || ':' || members_can_add FROM friend_groups WHERE id='{legacy_group}'") == "club:false"
        assert sql(f"SELECT members_can_add FROM friend_groups WHERE id='{old_club}'") == "f"
        assert sql(f"SELECT count(*) FROM friend_group_members WHERE friend_group_id='{legacy_group}'") == "2"
        assert sql(f"SELECT muted FROM chat_participants WHERE chat_id='{legacy_chat}' AND user_id='{member}'") == "t"
        assert sql(f"SELECT creator_id FROM chats WHERE id='{legacy_chat}'", owner) == owner
        assert sql(f"SELECT count(*) FROM chats WHERE id='{legacy_chat}'", outsider) == "0"
        assert sql("SELECT to_regprocedure('public.accept_club_invite_link(text)') IS NULL") == "t"
        assert sql("SELECT to_regprocedure('public.is_club(uuid)') IS NULL") == "t"
        assert sql(f"SELECT count(*) FROM friend_group_invite_links WHERE token='{token}'", member) == "0"
        denied(f"SELECT accept_club_invite('{personal}');", outsider, "Invite not found")
        assert sql(f"SELECT accept_club_invite('{personal}')->>'ok'", member) == "true"
        denied(f"INSERT INTO friend_group_invites(friend_group_id,inviter_id,invitee_id) VALUES ('{legacy}','{owner}','{outsider}');", owner, "row-level security")

        group = sql(f"SELECT create_friend_group('New group', ARRAY['{member}']::uuid[])", owner)
        chat = sql(f"SELECT id FROM chats WHERE friend_group_id='{group}'", member)
        assert chat
        assert sql(f"SELECT count(*) FROM friend_group_members WHERE friend_group_id='{group}'", member) == "2"
        assert sql(f"SELECT count(*) FROM notifications WHERE friend_group_id='{group}' AND user_id='{member}' AND type='friend_group_added'") == "1"
        assert sql(f"SELECT count(*) FROM friend_group_invites WHERE friend_group_id='{group}'") == "0"
        assert sql(f"SELECT count(*) FROM friend_groups WHERE id='{group}'", outsider) == "0"
        assert sql(f"SELECT count(*) FROM chats WHERE id='{chat}'", outsider) == "0"
        denied(f"SELECT create_friend_group('Invalid batch', ARRAY['{member}','{friend}']::uuid[]);", owner, "own friends")
        assert sql("SELECT count(*) FROM friend_groups WHERE name='Invalid batch'") == "0"
        denied(f"SELECT add_friend_group_members('{group}', ARRAY['{friend}']::uuid[]);", member, "permission")
        denied(f"SELECT add_friend_group_members('{group}', ARRAY['{owner}']::uuid[]);", outsider, "permission")
        assert sql(f"UPDATE friend_groups SET members_can_add=true WHERE id='{group}' RETURNING id", member) == ""
        assert sql(f"UPDATE friend_groups SET members_can_add=true WHERE id='{group}' RETURNING id", owner) == group
        denied(f"SELECT add_friend_group_members('{group}', ARRAY['{friend}','{outsider}']::uuid[]);", member, "own friends")
        assert sql(f"SELECT count(*) FROM friend_group_members WHERE friend_group_id='{group}' AND user_id='{friend}'") == "0"
        sql(f"INSERT INTO blocks VALUES ('{friend}','{member}');")
        denied(f"SELECT add_friend_group_members('{group}', ARRAY['{friend}']::uuid[]);", member, "own friends")
        sql("DELETE FROM blocks;")
        sql(f"SELECT add_friend_group_members('{group}', ARRAY['{friend}','{friend}']::uuid[]);", member)
        sql(f"SELECT add_friend_group_members('{group}', ARRAY['{friend}']::uuid[]);", member)
        assert sql(f"SELECT id FROM chats WHERE id='{chat}'", friend) == chat
        assert sql(f"SELECT count(*) FROM notifications WHERE friend_group_id='{group}' AND user_id='{friend}' AND actor_id='{member}' AND type='friend_group_added'") == "1"
        assert sql(f"DELETE FROM friend_group_members WHERE friend_group_id='{group}' AND user_id='{friend}' RETURNING user_id", friend) == friend
        assert sql(f"SELECT count(*) FROM chats WHERE id='{chat}'", friend) == "0"
        sql(f"UPDATE friend_groups SET members_can_add=false WHERE id='{group}'", owner)
        denied(f"SELECT add_friend_group_members('{group}', ARRAY['{friend}']::uuid[]);", member, "permission")
        denied(f"INSERT INTO chat_participants(chat_id,user_id) VALUES ('{chat}','{outsider}');", owner, "row-level security")
        sql(f"SELECT add_friend_group_members('{group}', ARRAY['{outsider}']::uuid[]);", owner)
        assert sql(f"SELECT id FROM chats WHERE id='{chat}'", outsider) == chat

        players = [str(uuid4()) for _ in range(201)]
        sql("INSERT INTO profiles VALUES " + ",".join(f"('{u}','Fixture {i}')" for i,u in enumerate(players)))
        sql("INSERT INTO friendships VALUES " + ",".join(f"('{owner}','{u}','accepted')" for u in players))
        def ids(items):
            return "ARRAY[" + ",".join(f"'{u}'" for u in items) + "]::uuid[]"
        def limit_reached(query, actor):
            result = process(psql, f"\\set VERBOSITY verbose\nSET request.jwt.claim.sub = '{actor}'; SET ROLE authenticated; {query}")
            assert result.returncode and "P2001" in result.stderr, result.stderr

        initial_group = sql(f"SELECT create_friend_group('199 seats',{ids(players[:198])})", owner)
        assert sql(f"SELECT count(*) FROM friend_group_members WHERE friend_group_id='{initial_group}'") == "199"
        limit_reached(f"SELECT add_friend_group_members('{initial_group}',{ids(players[198:200])});", owner)
        assert sql(f"SELECT count(*) FROM friend_group_members WHERE friend_group_id='{initial_group}'") == "199"
        sql(f"SELECT add_friend_group_members('{initial_group}',{ids(players[198:199])});", owner)
        assert sql(f"SELECT count(*) FROM friend_group_members WHERE friend_group_id='{initial_group}'") == "200"
        assert sql(f"SELECT count(*) FROM chats c JOIN chat_participants p ON p.chat_id=c.id WHERE c.friend_group_id='{initial_group}'") == "200"
        sql(f"SELECT add_friend_group_members('{initial_group}',{ids(players[198:199])});", owner)
        limit_reached(f"SELECT add_friend_group_members('{initial_group}',{ids(players[199:200])});", owner)
        assert sql(f"SELECT count(*) FROM notifications WHERE friend_group_id='{initial_group}' AND user_id='{players[199]}'") == "0"

        limit_reached(f"SELECT create_standalone_chat('Invalid 201',{ids(players[:200])});", owner)
        assert sql("SELECT count(*) FROM chats WHERE name='Invalid 201'") == "0"
        standalone = sql(f"SELECT create_standalone_chat('Full standalone',{ids(players[:199])})", owner)
        assert sql(f"SELECT count(*) FROM chat_participants WHERE chat_id='{standalone}'") == "200"
        limit_reached(f"SELECT update_standalone_chat('{standalone}','Rolled back',{ids(players[199:201])},{ids(players[:1])});", owner)
        assert sql(f"SELECT name FROM chats WHERE id='{standalone}'") == "Full standalone"
        assert sql(f"SELECT count(*) FROM chat_participants WHERE chat_id='{standalone}' AND user_id='{players[0]}'") == "1"
        denied(f"SELECT update_standalone_chat('{standalone}','No',{ids([])},{ids(players[1:2])});", players[0], "Only the chat creator")
        sql(f"SELECT update_standalone_chat('{standalone}','Replacement',{ids(players[199:200])},{ids(players[:1])});", owner)
        assert sql(f"SELECT name FROM chats WHERE id='{standalone}'") == "Replacement"
        assert sql(f"SELECT count(*) FROM chat_participants WHERE chat_id='{standalone}'") == "200"
        assert sql(f"SELECT count(*) FROM chat_participants WHERE chat_id='{standalone}' AND user_id='{players[199]}'") == "1"

        race_chat = sql(f"SELECT create_standalone_chat('Concurrent adds',{ids(players[:198])})", owner)
        def command(actor, connection_name, statement):
            return f"\\set VERBOSITY verbose\nSET application_name='{connection_name}'; SET request.jwt.claim.sub='{actor}'; SET ROLE authenticated; {statement}\n"
        with Popen(psql, stdin=PIPE, stdout=PIPE, stderr=PIPE, text=True, env=env) as first, \
             Popen(psql, stdin=PIPE, stdout=PIPE, stderr=PIPE, text=True, env=env) as second:
            first.stdin.write(command(players[0], "capacity-first", f"BEGIN; SELECT update_standalone_chat('{race_chat}','Concurrent adds',{ids(players[198:199])},{ids([])}); SELECT 'held';"))
            first.stdin.flush()
            for line in first.stdout:
                if line.strip() == "held":
                    break
            else:
                raise AssertionError(first.stderr.read())
            second.stdin.write(command(players[1], "capacity-second", f"SELECT update_standalone_chat('{race_chat}','Concurrent adds',{ids(players[199:200])},{ids([])});"))
            second.stdin.close()
            deadline = monotonic() + 5
            while sql("SELECT count(*) FROM pg_stat_activity WHERE application_name = 'capacity-second' AND wait_event_type = 'Lock'") != "1":
                if monotonic() > deadline:
                    raise AssertionError("Second addition did not wait for the first")
                sleep(.025)
            first.stdin.write("COMMIT;\n")
            first.stdin.close()
            first.wait(timeout=10)
            second.wait(timeout=10)
            assert first.returncode == 0, first.stderr.read()
            assert second.returncode and "P2001" in second.stderr.read()
        assert sql(f"SELECT count(*) FROM chat_participants WHERE chat_id='{race_chat}'") == "200"
        print("PostgreSQL checks passed: legacy access, direct adds, both 200-person limits, atomic rejection, and concurrent adds.")
    finally:
        check(process([commands["pg_ctl"], "-D", datadir, "-m", "immediate", "-w", "stop"]))

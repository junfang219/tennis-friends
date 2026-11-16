-- Minimal isolated fixture for the production onboarding functions. Never run on a live database.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE DOMAIN citext AS text;
CREATE TYPE public.group_member_role AS ENUM ('manager','captain');
CREATE TABLE profiles(id uuid PRIMARY KEY,name text,email text);
CREATE TABLE groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,owner_id uuid REFERENCES profiles(id));
CREATE TABLE friendships(requester_id uuid,addressee_id uuid,status text);
CREATE TABLE group_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),group_id uuid REFERENCES groups(id),user_id uuid REFERENCES profiles(id),roles group_member_role[] DEFAULT '{}',placeholder_name text,placeholder_email citext,placeholder_phone text,placeholder_scope text,claim_token text,claim_expires_at timestamptz, UNIQUE(group_id,user_id));
CREATE TABLE availabilities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),member_id uuid REFERENCES group_members(id),user_id uuid,match_id uuid,practice_id uuid,status text);
CREATE TABLE availability_poll_responses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),member_id uuid REFERENCES group_members(id),user_id uuid,poll_id uuid,status text);
CREATE FUNCTION can_admin_group(g uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM groups WHERE id=g AND owner_id=auth.uid()) $$;

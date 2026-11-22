set local lock_timeout = '5s';

alter policy chat_messages_select_member on public.chat_messages
  using (public.is_chat_participant(chat_id) and not public.is_blocked((select auth.uid()), sender_id));
alter policy group_messages_select_member on public.group_messages
  using (public.is_group_member(group_id) and not public.is_blocked((select auth.uid()), sender_id));

CREATE OR REPLACE FUNCTION public.push_on_chat_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_chat_name   text;
  v_recipients  uuid[];
  v_body        text;
BEGIN
  SELECT name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;
  SELECT name INTO v_chat_name   FROM public.chats    WHERE id = NEW.chat_id;
  SELECT array_agg(user_id) INTO v_recipients
  FROM public.chat_participants
  WHERE chat_id = NEW.chat_id
    AND user_id <> NEW.sender_id
    AND NOT public.is_blocked(user_id, NEW.sender_id);

  IF v_recipients IS NULL OR cardinality(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

  v_body := COALESCE(v_sender_name, 'A player')
         || ': '
         || left(COALESCE(NULLIF(trim(NEW.content), ''), '[media]'), 180);

  PERFORM public.invoke_edge_function(
    'push-fanout',
    jsonb_build_object(
      'user_ids',  to_jsonb(v_recipients),
      'title',     COALESCE(v_chat_name, 'Session chat'),
      'body',      v_body,
      'thread_id', 'chat:' || NEW.chat_id::text,
      'data',      jsonb_build_object(
                     'kind',       'chat',
                     'chat_id',    NEW.chat_id::text,
                     'message_id', NEW.id::text
                   )
    )
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.push_on_group_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_group_name  text;
  v_recipients  uuid[];
  v_body        text;
BEGIN
  SELECT name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;
  SELECT name INTO v_group_name  FROM public.groups   WHERE id = NEW.group_id;
  SELECT array_agg(user_id) INTO v_recipients
  FROM public.group_members
  WHERE group_id = NEW.group_id
    AND user_id <> NEW.sender_id
    AND NOT public.is_blocked(user_id, NEW.sender_id)
    AND muted = false
    AND archived_at IS NULL;

  IF v_recipients IS NULL OR cardinality(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

  v_body := COALESCE(v_sender_name, 'A teammate')
         || ': '
         || left(COALESCE(NULLIF(trim(NEW.content), ''), '[media]'), 180);

  PERFORM public.invoke_edge_function(
    'push-fanout',
    jsonb_build_object(
      'user_ids',  to_jsonb(v_recipients),
      'title',     COALESCE(v_group_name, 'Team chat'),
      'body',      v_body,
      'thread_id', 'group:' || NEW.group_id::text,
      'data',      jsonb_build_object(
                     'kind',       'group',
                     'group_id',   NEW.group_id::text,
                     'message_id', NEW.id::text
                   )
    )
  );
  RETURN NEW;
END;
$$;

-- Retain historical decisions. The same viewer may report a changed item
-- after dismissal, while retries still resolve to the existing pending report.
alter table public.content_reports add column evidence_fingerprint text;
alter table public.content_reports drop constraint content_reports_reporter_id_target_type_target_id_key;
create unique index content_reports_one_pending_per_reporter
  on public.content_reports (reporter_id, target_type, target_id) where decision is null;
create index content_reports_reporter_target_history_idx
  on public.content_reports (reporter_id, target_type, target_id, created_at desc, id desc);

create or replace function public.record_content_report(
  p_reporter_id uuid, p_author_id uuid, p_target_type text, p_target_id uuid,
  p_reason text, p_details text, p_evidence_text text, p_evidence_media text[]
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  prior public.content_reports%rowtype;
  fingerprint text := encode(sha256(convert_to(jsonb_build_array(p_evidence_text, p_evidence_media)::text, 'UTF8')), 'hex');
begin
  perform pg_advisory_xact_lock(hashtextextended(p_reporter_id::text, 7501));
  perform pg_advisory_xact_lock(hashtextextended(p_target_type || ':' || p_target_id::text, 7502));

  select * into prior from public.content_reports
  where reporter_id = p_reporter_id and target_type = p_target_type and target_id = p_target_id
  order by (decision is null) desc, created_at desc, id desc limit 1;
  if found and (
    prior.decision is null or prior.decision = 'removed'
    or coalesce(prior.evidence_fingerprint = fingerprint,
      prior.evidence_text = p_evidence_text and prior.evidence_media = p_evidence_media)
  ) then
    return 'duplicate';
  end if;

  if (
    select count(*) from public.content_reports
    where reporter_id = p_reporter_id and created_at > now() - interval '24 hours'
  ) >= 20 then
    return 'rate_limited';
  end if;
  insert into public.content_reports (
    reporter_id, author_id, target_type, target_id, reason, details, evidence_text, evidence_media, evidence_fingerprint
  ) values (
    p_reporter_id, p_author_id, p_target_type, p_target_id, p_reason, p_details,
    left(p_evidence_text, 4000), p_evidence_media[1:8], fingerprint
  );
  return 'created';
end;
$$;

-- Keep removal work durable if the Storage API fails after the DB commits.
-- Keep it independent of account/report deletion so unfinished work survives.
create table public.moderation_media_cleanup (
  report_id uuid primary key,
  author_id uuid not null,
  media_urls text[] not null,
  created_at timestamptz not null default now()
);
alter table public.moderation_media_cleanup enable row level security;
revoke all on table public.moderation_media_cleanup from public, anon, authenticated, service_role;
grant select, insert, delete on table public.moderation_media_cleanup to service_role;

create or replace function public.review_content_report(p_report_id uuid, p_reviewer_id uuid, p_decision text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  report public.content_reports%rowtype;
  attached_urls text[];
  cleanup_urls text[];
begin
  if p_decision is null or p_decision not in ('dismissed', 'removed') then
    raise exception 'Invalid moderation decision';
  end if;
  select * into report from public.content_reports where id = p_report_id;
  if not found then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(report.target_type || ':' || report.target_id::text, 7502));
  if not exists (select 1 from public.content_reports where id = p_report_id and decision is null) then
    return false;
  end if;

  if p_decision = 'removed' then
    case report.target_type
      when 'post' then
        -- Lock the parent before reading attachments so a concurrent insert
        -- cannot add a child which the cascading delete would miss here.
        perform 1 from public.posts where id = report.target_id and author_id = report.author_id for update;
        with locked_media as (
          select photo.url, photo.thumbnail_url
          from public.posts post join public.photos photo on photo.post_id = post.id
          where post.id = report.target_id and post.author_id = report.author_id
          for update of photo
        )
        select array_agg(files.url) into attached_urls
        from locked_media
        cross join lateral (values (locked_media.url), (locked_media.thumbnail_url)) files(url);
        delete from public.posts where id = report.target_id and author_id = report.author_id;
      when 'comment' then
        delete from public.comments where id = report.target_id and author_id = report.author_id;
      when 'direct_message' then
        delete from public.messages where id = report.target_id and sender_id = report.author_id
        returning array[media_url] into attached_urls;
      when 'chat_message' then
        delete from public.chat_messages where id = report.target_id and sender_id = report.author_id
        returning array[media_url] into attached_urls;
      when 'team_message' then
        delete from public.group_messages where id = report.target_id and sender_id = report.author_id
        returning array[media_url] into attached_urls;
    end case;

    -- Reports can include a former attachment that the author has since edited
    -- out. Preserve it as a candidate as well as the URLs on the deleted row.
    select array_agg(distinct url) into cleanup_urls
    from (
      select unnest(attached_urls) as url
      union all
      select unnest(evidence_media)
      from public.content_reports
      where target_type = report.target_type and target_id = report.target_id
        and author_id = report.author_id and decision is null
    ) files
    where url <> '';
    if cleanup_urls is not null then
      insert into public.moderation_media_cleanup (report_id, author_id, media_urls)
      values (p_report_id, report.author_id, cleanup_urls);
    end if;

    update public.content_reports set decision = p_decision, reviewed_at = now(), reviewed_by = p_reviewer_id
    where target_type = report.target_type and target_id = report.target_id and decision is null;
  else
    update public.content_reports set decision = p_decision, reviewed_at = now(), reviewed_by = p_reviewer_id
    where id = p_report_id;
  end if;
  return true;
end;
$$;

-- Check the structured references in the feed, Playbook, and all chat types.
-- A public object and its rendered thumbnail are references to the same file.
create function public.moderation_unreferenced_media(p_urls text[])
returns text[]
language sql
security invoker
set search_path = ''
as $$
  with referenced as (
    select regexp_replace(replace(url, '/storage/v1/render/image/public/', '/storage/v1/object/public/'), '[?#].*$', '') as url
    from (
      select url from public.photos
      union all select thumbnail_url from public.photos
      union all select media_url from public.messages
      union all select media_url from public.chat_messages
      union all select media_url from public.group_messages
    ) media
    where url <> ''
  )
  select array(select candidate.url from unnest(p_urls) candidate(url)
    where not exists (select 1 from referenced where referenced.url = candidate.url));
$$;
revoke execute on function public.moderation_unreferenced_media(text[]) from public, anon, authenticated;
grant execute on function public.moderation_unreferenced_media(text[]) to service_role;

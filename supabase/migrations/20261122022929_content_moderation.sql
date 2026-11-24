set local lock_timeout = '5s';
-- Reports are written and reviewed through authenticated server code only.
create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'direct_message', 'chat_message', 'team_message')),
  target_id uuid not null,
  reason text not null check (reason in ('harassment', 'hate', 'threat', 'sexual', 'spam', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  evidence_text text not null default '' check (char_length(evidence_text) <= 4000),
  evidence_media text[] not null default '{}' check (cardinality(evidence_media) <= 8),
  created_at timestamptz not null default now(),
  decision text check (decision in ('dismissed', 'removed')),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  check (reporter_id <> author_id),
  check ((decision is null) = (reviewed_at is null)),
  unique (reporter_id, target_type, target_id)
);

alter table public.content_reports enable row level security;
revoke all on table public.content_reports from public, anon, authenticated, service_role;
grant select, insert, update on table public.content_reports to service_role;

create index content_reports_pending_idx on public.content_reports (created_at, id) where decision is null;
create index content_reports_pending_target_idx on public.content_reports (target_type, target_id) where decision is null;
create index content_reports_reporter_created_idx on public.content_reports (reporter_id, created_at desc);
create index content_reports_author_idx on public.content_reports (author_id);
create index content_reports_reviewer_idx on public.content_reports (reviewed_by) where reviewed_by is not null;

create function public.record_content_report(
  p_reporter_id uuid, p_author_id uuid, p_target_type text, p_target_id uuid,
  p_reason text, p_details text, p_evidence_text text, p_evidence_media text[]
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Serialize a reporter's submissions so parallel requests cannot exceed the limit.
  perform pg_advisory_xact_lock(hashtextextended(p_reporter_id::text, 7501));
  if exists (
    select 1 from public.content_reports
    where reporter_id = p_reporter_id and target_type = p_target_type and target_id = p_target_id
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
    reporter_id, author_id, target_type, target_id, reason, details, evidence_text, evidence_media
  ) values (
    p_reporter_id, p_author_id, p_target_type, p_target_id, p_reason,
    p_details, p_evidence_text, p_evidence_media
  );
  return 'created';
end;
$$;

create function public.review_content_report(p_report_id uuid, p_reviewer_id uuid, p_decision text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  report public.content_reports%rowtype;
begin
  if p_decision is null or p_decision not in ('dismissed', 'removed') then
    raise exception 'Invalid moderation decision';
  end if;
  select * into report from public.content_reports where id = p_report_id;
  if not found then return false; end if;

  -- Lock the target rather than just the report, since several people may report it.
  perform pg_advisory_xact_lock(hashtextextended(report.target_type || ':' || report.target_id::text, 7502));
  if not exists (select 1 from public.content_reports where id = p_report_id and decision is null) then
    return false;
  end if;

  if p_decision = 'removed' then
    case report.target_type
      when 'post' then delete from public.posts where id = report.target_id and author_id = report.author_id;
      when 'comment' then delete from public.comments where id = report.target_id and author_id = report.author_id;
      when 'direct_message' then delete from public.messages where id = report.target_id and sender_id = report.author_id;
      when 'chat_message' then delete from public.chat_messages where id = report.target_id and sender_id = report.author_id;
      when 'team_message' then delete from public.group_messages where id = report.target_id and sender_id = report.author_id;
    end case;
    update public.content_reports set decision = p_decision, reviewed_at = now(), reviewed_by = p_reviewer_id
    where target_type = report.target_type and target_id = report.target_id and decision is null;
  else
    update public.content_reports set decision = p_decision, reviewed_at = now(), reviewed_by = p_reviewer_id
    where id = p_report_id;
  end if;
  return true;
end;
$$;

revoke execute on function public.record_content_report(uuid, uuid, text, uuid, text, text, text, text[]),
  public.review_content_report(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_content_report(uuid, uuid, text, uuid, text, text, text, text[]),
  public.review_content_report(uuid, uuid, text) to service_role;

create schema if not exists private;

create function private.filter_objectionable_text()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  normalized text;
begin
  if tg_op = 'UPDATE' then
    if new.content is not distinct from old.content then return new; end if;
  end if;
  normalized := lower(translate(normalize(new.content, NFKC), U&'\200B\200C\200D\2060\FEFF', ''));
  normalized := regexp_replace(normalized, '[^[:alnum:]]+', ' ', 'g');
  -- High-confidence threats, self-harm harassment, and severe slurs. Human review
  -- handles context, other abuse, and visual media.
  if normalized ~ $pattern$\m(kill yourself|i will kill you|i m going to kill you|k[i1]ke|n[i1]gg[e3]rs?|f[a4]gg[o0]ts?|sp[i1]cs?)\M$pattern$ then
    raise exception using errcode = 'P0001', message = 'This text can’t be posted. Remove abusive language or threats and try again.';
  end if;
  return new;
end;
$$;

revoke execute on function private.filter_objectionable_text() from public, anon, authenticated;
create trigger filter_post_text before insert or update of content on public.posts
  for each row execute function private.filter_objectionable_text();
create trigger filter_comment_text before insert or update of content on public.comments
  for each row execute function private.filter_objectionable_text();
create trigger filter_direct_message_text before insert or update of content on public.messages
  for each row execute function private.filter_objectionable_text();
create trigger filter_chat_message_text before insert or update of content on public.chat_messages
  for each row execute function private.filter_objectionable_text();
create trigger filter_team_message_text before insert or update of content on public.group_messages
  for each row execute function private.filter_objectionable_text();

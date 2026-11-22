set local lock_timeout = '5s';

create table public.apple_account_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ciphertext text not null
);
alter table public.apple_account_tokens enable row level security;
revoke all on public.apple_account_tokens from public, anon, authenticated, service_role;
grant select, insert, update on public.apple_account_tokens to service_role;

-- A replacement object receives a new ID and must pass its own review.
create table public.media_upload_reviews (
  object_id uuid primary key,
  approved boolean not null,
  reviewed_at timestamptz not null default now()
);
alter table public.media_upload_reviews enable row level security;
revoke all on public.media_upload_reviews from public, anon, authenticated, service_role;
grant select, insert on public.media_upload_reviews to service_role;

-- Existing uploads were published before screening. Preserve them while
-- changing delivery to enforce the current audience of their parent row.
insert into public.media_upload_reviews(object_id, approved)
select id, true from storage.objects where bucket_id in ('avatars', 'posts', 'albums', 'court-reviews');

create function private.media_upload_approved(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.media_upload_reviews where object_id = p_id and approved);
$$;
revoke execute on function private.media_upload_approved(uuid) from public;
grant execute on function private.media_upload_approved(uuid) to anon, authenticated;

create function public.pending_media_uploads() returns table(object_id uuid, bucket text, object_key text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select o.id, o.bucket_id, o.name, o.created_at from storage.objects o
  where o.bucket_id in ('avatars', 'posts', 'albums', 'court-reviews')
    and not exists(select 1 from public.media_upload_reviews r where r.object_id = o.id)
  order by o.created_at, o.id limit 50;
$$;
create function public.decide_media_upload(p_id uuid, p_approved boolean) returns boolean
language sql security invoker set search_path = '' as $$
  with saved as (
    insert into public.media_upload_reviews(object_id, approved)
    select id, p_approved from storage.objects
    where id = p_id and bucket_id in ('avatars','posts','albums','court-reviews')
    on conflict (object_id) do nothing returning 1
  )
  select exists(select 1 from saved);
$$;
revoke execute on function public.pending_media_uploads(), public.decide_media_upload(uuid, boolean) from public, anon, authenticated;
grant execute on function public.pending_media_uploads(), public.decide_media_upload(uuid, boolean) to service_role;

-- Existing app-owned URLs are replaced in place, including thumbnails and
-- evidence already in the queue. External media links are left alone.
create function private.protect_media_url(value text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(value,
    '^https?://(fqopzafmnaviipumsmfm[.]supabase[.]co|localhost(:[0-9]+)?|127[.]0[.]0[.]1(:[0-9]+)?)/storage/v1/(object|render/image)/public/(avatars|posts|albums|court-reviews)/([^?#]+)([?#].*)?$',
    '/api/storage/media/\5/\6', 'i');
$$;

update public.photos set url = private.protect_media_url(url), thumbnail_url = private.protect_media_url(thumbnail_url)
where url is distinct from private.protect_media_url(url) or thumbnail_url is distinct from private.protect_media_url(thumbnail_url);
update public.messages set media_url = private.protect_media_url(media_url)
where media_url is distinct from private.protect_media_url(media_url);
update public.chat_messages set media_url = private.protect_media_url(media_url)
where media_url is distinct from private.protect_media_url(media_url);
update public.group_messages set media_url = private.protect_media_url(media_url)
where media_url is distinct from private.protect_media_url(media_url);
update public.album_items set url = private.protect_media_url(url)
where url is distinct from private.protect_media_url(url);
update public.court_review_photos set url = private.protect_media_url(url)
where url is distinct from private.protect_media_url(url);
update public.profiles set profile_image_url = private.protect_media_url(profile_image_url), cover_image_url = private.protect_media_url(cover_image_url)
where profile_image_url is distinct from private.protect_media_url(profile_image_url) or cover_image_url is distinct from private.protect_media_url(cover_image_url);
update public.groups set image_url = private.protect_media_url(image_url), cover_image_url = private.protect_media_url(cover_image_url)
where image_url is distinct from private.protect_media_url(image_url) or cover_image_url is distinct from private.protect_media_url(cover_image_url);
update public.events set cover_image_url = private.protect_media_url(cover_image_url)
where cover_image_url is distinct from private.protect_media_url(cover_image_url);

update storage.buckets set public = false where id in ('avatars', 'posts', 'albums', 'court-reviews');

drop policy storage_avatars_read on storage.objects;
drop policy storage_posts_read on storage.objects;
drop policy storage_albums_read on storage.objects;
drop policy storage_court_reviews_read on storage.objects;
alter policy storage_authenticated_update on storage.objects
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy storage_managed_media_read on storage.objects
  for select to anon, authenticated using (
    bucket_id in ('avatars', 'posts', 'albums', 'court-reviews')
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (private.media_upload_approved(id) and case bucket_id
        when 'posts' then
          exists(select 1 from public.photos p join public.posts post on post.id = p.post_id
            where post.author_id::text = split_part(storage.objects.name, '/', 1)
              and '/api/storage/media/posts/' || storage.objects.name in (p.url, p.thumbnail_url))
          or exists(select 1 from public.messages m where m.sender_id::text = split_part(storage.objects.name, '/', 1) and m.media_url = '/api/storage/media/posts/' || storage.objects.name)
          or exists(select 1 from public.chat_messages m where m.sender_id::text = split_part(storage.objects.name, '/', 1) and m.media_url = '/api/storage/media/posts/' || storage.objects.name)
          or exists(select 1 from public.group_messages m where m.sender_id::text = split_part(storage.objects.name, '/', 1) and m.media_url = '/api/storage/media/posts/' || storage.objects.name)
        when 'albums' then exists(select 1 from public.album_items a where a.added_by_id::text = split_part(storage.objects.name, '/', 1) and a.url = '/api/storage/media/albums/' || storage.objects.name)
        when 'court-reviews' then exists(select 1 from public.court_review_photos p join public.court_reviews r on r.id = p.review_id
          where r.user_id::text = split_part(storage.objects.name, '/', 1) and p.url = '/api/storage/media/court-reviews/' || storage.objects.name)
        when 'avatars' then
          exists(select 1 from public.profiles p where '/api/storage/media/avatars/' || storage.objects.name in (p.profile_image_url, p.cover_image_url))
          or exists(select 1 from public.groups g where '/api/storage/media/avatars/' || storage.objects.name in (g.image_url, g.cover_image_url))
          or exists(select 1 from public.events e where e.cover_image_url = '/api/storage/media/avatars/' || storage.objects.name)
        else false end)
    )
  );

create index photos_storage_url_idx on public.photos(url);
create index photos_storage_thumbnail_idx on public.photos(thumbnail_url) where thumbnail_url <> '';
create index messages_storage_url_idx on public.messages(media_url) where media_url <> '';
create index chat_messages_storage_url_idx on public.chat_messages(media_url) where media_url <> '';
create index group_messages_storage_url_idx on public.group_messages(media_url) where media_url <> '';
create index album_items_storage_url_idx on public.album_items(url);
create index court_review_photos_storage_url_idx on public.court_review_photos(url);

alter table public.content_reports drop constraint content_reports_target_type_check;
alter table public.content_reports add constraint content_reports_target_type_check
  check (target_type in ('post', 'comment', 'direct_message', 'chat_message', 'team_message', 'profile', 'album', 'album_item', 'court_review'));

-- The prior report text remains useful; legacy evidence URLs map to the
-- same objects after this change.
update public.content_reports r set
  evidence_media = array(select private.protect_media_url(u) from unnest(r.evidence_media) u),
  evidence_fingerprint = null
where exists(select 1 from unnest(r.evidence_media) u where u <> private.protect_media_url(u));

update public.moderation_media_cleanup r set
  media_urls = array(select private.protect_media_url(u) from unnest(r.media_urls) u)
where exists(select 1 from unnest(r.media_urls) u where u <> private.protect_media_url(u));

grant usage on schema private to service_role;

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
      when 'profile' then
        select array[profile_image_url, cover_image_url] into attached_urls
        from public.profiles where id = report.target_id and id = report.author_id for update;
        update public.profiles set name = 'Tennis Player', bio = '', handle = null,
          profile_image_url = '', cover_image_url = ''
        where id = report.target_id and id = report.author_id;
      when 'album' then
        update public.albums set name = 'Team album', description = ''
        where id = report.target_id and created_by_id = report.author_id;
      when 'album_item' then
        delete from public.album_items where id = report.target_id and added_by_id = report.author_id
        returning array[url] into attached_urls;
      when 'court_review' then
        perform 1 from public.court_reviews where id = report.target_id and user_id = report.author_id for update;
        with photos as (
          select p.url from public.court_review_photos p join public.court_reviews r on r.id = p.review_id
          where r.id = report.target_id and r.user_id = report.author_id for update of p
        )
        select array_agg(url) into attached_urls from photos;
        delete from public.court_reviews where id = report.target_id and user_id = report.author_id;
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

create or replace function public.moderation_unreferenced_media(p_urls text[])
returns text[]
language sql security invoker set search_path = '' as $$
  with refs(url) as (
    select url from public.photos
    union all select thumbnail_url from public.photos
    union all select media_url from public.messages
    union all select media_url from public.chat_messages
    union all select media_url from public.group_messages
    union all select url from public.album_items
    union all select url from public.court_review_photos
    union all select profile_image_url from public.profiles
    union all select cover_image_url from public.profiles
    union all select image_url from public.groups
    union all select cover_image_url from public.groups
    union all select cover_image_url from public.events
  )
  select array(select candidate from unnest(p_urls) candidate
    where not exists(select 1 from refs where url <> '' and private.protect_media_url(url) = private.protect_media_url(candidate)));
$$;

-- New writes on these surfaces use the same narrow abusive-text filter
-- already used on posts, comments and messages.
create function private.filter_additional_content() returns trigger
language plpgsql set search_path = '' as $$
declare
  field text;
  normalized text;
begin
  foreach field in array tg_argv loop
    if tg_op = 'UPDATE' and to_jsonb(new)->>field is not distinct from to_jsonb(old)->>field then
      continue;
    end if;
    normalized := lower(translate(normalize(to_jsonb(new)->>field, NFKC), U&'\200B\200C\200D\2060\FEFF', ''));
    normalized := regexp_replace(normalized, '[^[:alnum:]]+', ' ', 'g');
    if normalized ~ $pattern$\m(kill yourself|i will kill you|i m going to kill you|k[i1]ke|n[i1]gg[e3]rs?|f[a4]gg[o0]ts?|sp[i1]cs?)\M$pattern$ then
      raise exception using errcode = 'P0001', message = 'This text can’t be posted. Remove abusive language or threats and try again.';
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function private.filter_additional_content() from public, anon, authenticated;
create trigger filter_profile_text before insert or update of name, bio, handle on public.profiles
  for each row execute function private.filter_additional_content('name','bio','handle');
create trigger filter_album_text before insert or update of name, description on public.albums
  for each row execute function private.filter_additional_content('name','description');
create trigger filter_album_item_text before insert or update of caption on public.album_items
  for each row execute function private.filter_additional_content('caption');
create trigger filter_court_review_text before insert or update of content on public.court_reviews
  for each row execute function private.filter_additional_content('content');

-- Signed-in clients can attach only uploads belonging to their own
-- storage prefix. Privileged migrations and provider-created profiles keep
-- existing imported data.
create function private.require_owned_media_url() returns trigger
language plpgsql set search_path = '' as $$
declare
  field text;
  value text;
  prefix text := '/api/storage/media/' || tg_argv[0] || '/' || (select auth.uid())::text || '/';
begin
  if current_user <> 'authenticated' then return new; end if;
  foreach field in array tg_argv[1:] loop
    value := to_jsonb(new)->>field;
    if tg_op = 'UPDATE' and value is not distinct from to_jsonb(old)->>field then continue; end if;
    if coalesce(value, '') <> '' and (
      not starts_with(value, prefix)
      or substring(value from length(prefix) + 1) !~ '^[a-zA-Z0-9][a-zA-Z0-9._-]*$'
    ) then
      raise exception using errcode = '22023', message = 'Choose a file to upload before attaching it.';
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function private.require_owned_media_url() from public, anon, authenticated;
create trigger photos_managed_urls before insert or update of url, thumbnail_url on public.photos
  for each row execute function private.require_owned_media_url('posts','url','thumbnail_url');
create trigger dm_managed_urls before insert or update of media_url on public.messages
  for each row execute function private.require_owned_media_url('posts','media_url');
create trigger group_chat_managed_urls before insert or update of media_url on public.chat_messages
  for each row execute function private.require_owned_media_url('posts','media_url');
create trigger team_chat_managed_urls before insert or update of media_url on public.group_messages
  for each row execute function private.require_owned_media_url('posts','media_url');
create trigger album_item_managed_urls before insert or update of url on public.album_items
  for each row execute function private.require_owned_media_url('albums','url');
create trigger court_review_managed_urls before insert or update of url on public.court_review_photos
  for each row execute function private.require_owned_media_url('court-reviews','url');
create trigger profile_managed_urls before update of profile_image_url, cover_image_url on public.profiles
  for each row execute function private.require_owned_media_url('avatars','profile_image_url','cover_image_url');
create trigger group_managed_urls before insert or update of image_url, cover_image_url on public.groups
  for each row execute function private.require_owned_media_url('avatars','image_url','cover_image_url');

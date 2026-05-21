-- Supabase Storage buckets for TennisFriend.
--
-- Bucket conventions:
--   - avatars       — profile/cover images. Public reads, owner writes.
--   - posts         — feed media (photos, videos). Public reads, author writes.
--   - albums        — group album items. Public reads (linked from public group
--                     albums); writes gated by group membership at the row level.
--   - files         — group document store (waivers, schedules). Private reads
--                     via signed URLs; group-member writes.
--   - court-reviews — review photos. Public reads, author writes.
--
-- Object naming convention: <userId>/<timestamp>-<rand>.<ext>
-- The first path segment is the owner uuid. Policies use that to enforce
-- "only the uploader can mutate" without needing extra metadata columns.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',       'avatars',       true,  10 * 1024 * 1024,   array['image/jpeg','image/png','image/webp','image/gif']),
  ('posts',         'posts',         true,  100 * 1024 * 1024,  array['image/jpeg','image/png','image/webp','image/gif','image/heic','video/mp4','video/webm','video/quicktime']),
  ('albums',        'albums',        true,  100 * 1024 * 1024,  array['image/jpeg','image/png','image/webp','image/gif','image/heic','video/mp4','video/webm','video/quicktime']),
  ('files',         'files',         false, 100 * 1024 * 1024,  null),
  ('court-reviews', 'court-reviews', true,  10 * 1024 * 1024,   array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy storage_avatars_read on storage.objects
  for select using (bucket_id = 'avatars');

create policy storage_posts_read on storage.objects
  for select using (bucket_id = 'posts');

create policy storage_albums_read on storage.objects
  for select using (bucket_id = 'albums');

create policy storage_court_reviews_read on storage.objects
  for select using (bucket_id = 'court-reviews');

create policy storage_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_authenticated_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('avatars','posts','albums','files','court-reviews')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_authenticated_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('avatars','posts','albums','files','court-reviews')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_authenticated_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('avatars','posts','albums','files','court-reviews')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

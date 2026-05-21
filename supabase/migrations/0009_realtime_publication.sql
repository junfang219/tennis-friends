-- Enable Postgres logical replication (CDC) on the tables the app subscribes
-- to via Supabase Realtime. RLS still applies to the broadcast stream, so
-- only rows the subscriber would see via REST are delivered.
--
-- Add tables here as new realtime use cases appear. Don't enable everything
-- by default — every replicated INSERT/UPDATE/DELETE goes over the wire.

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.group_messages;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.event_matches;
alter publication supabase_realtime add table public.event_participants;
alter publication supabase_realtime add table public.likes;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.play_requests;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.poll_votes;

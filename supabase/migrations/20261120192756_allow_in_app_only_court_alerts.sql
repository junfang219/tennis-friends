-- Every matching alert creates an in-app notification. Email and push are optional.
alter table public.court_alerts
  drop constraint if exists court_alerts_has_channel;

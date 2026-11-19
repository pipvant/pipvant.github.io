-- v13: coach usage quotas for the live AI coach (pip-coach Edge Function).
-- One row per user per day; the Edge Function (service role) reads and
-- upserts it. Users can read only their own rows.
create table if not exists public.coach_usage (
  user_id uuid not null,
  day date not null default CURRENT_DATE,
  count int not null default 0,
  primary key (user_id, day)
);
alter table public.coach_usage enable row level security;
drop policy if exists "users read own coach usage" on public.coach_usage;
create policy "users read own coach usage" on public.coach_usage
  for select using (auth.uid() = user_id);

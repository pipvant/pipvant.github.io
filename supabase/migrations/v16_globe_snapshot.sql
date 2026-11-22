-- v16: Globe snapshot (live global map) + profile country
-- Founder order 2026-11-22: the Globe page shows live Pipvant data —
-- partner firms and traders per country — from Supabase, never demo.
-- Data source: Supabase (Phase 0 decision, option C).
--
-- What this does:
--  1. globe_snapshot — ONE row (key='latest') holding the aggregated
--     snapshot JSON the Globe page reads. Written ONLY by the
--     globe-snapshot Edge Function (service role, daily rebuild).
--     Public read (anon + authenticated) so the static page can fetch
--     it with the anon key. No per-user data inside: only firm
--     aggregates and masked country counts (counts < 5 are null).
--  2. profiles.country — ISO 3166-1 alpha-2 code (e.g. 'MA'), set by
--     IP auto-detection in the app (ipapi.co) with a manual picker
--     override in Profile edit. Nullable: a user with no country is
--     simply not counted on the map. Never inferred from IP on the
--     server; the app sends only the 2-letter code, never the IP.
--  3. profiles.country_manual — true when the user picked the country
--     by hand (picker override). IP detection skips the user when
--     this is true, so a VPN correction is never overwritten.
--
-- Daily rebuild: the globe-snapshot Edge Function is invoked once a
-- day from the Supabase dashboard (Edge Functions > globe-snapshot >
-- Schedule, cron "0 5 * * *" — 05:00 UTC). pg_cron is NOT assumed.
-- The snapshot carries generatedAt; the page warns if it is older
-- than 24 hours. Free plan pauses after 7 days of inactivity, so
-- keep the project awake (any daily activity, e.g. this rebuild,
-- counts) and export the snapshot regularly.
--
-- SECURITY: the snapshot contains no user identity, no exact
-- location, no account data — only aggregates. The Edge Function
-- reads profiles/accounts with the service role and publishes only
-- the masked aggregate. RLS below allows public SELECT of the single
-- snapshot row only; there is deliberately NO write policy for
-- anon/authenticated (service role bypasses RLS to write).
--
-- Idempotent: safe to run twice (IF NOT EXISTS / ON CONFLICT).

-- ---------- 1. globe_snapshot ----------
create table if not exists public.globe_snapshot (
  key text primary key,
  snapshot jsonb not null,
  mode text not null default 'live',
  updated_at timestamptz not null default now()
);

alter table public.globe_snapshot enable row level security;

drop policy if exists "public read globe snapshot" on public.globe_snapshot;
create policy "public read globe snapshot" on public.globe_snapshot
  for select to anon, authenticated using (true);

-- No insert/update/delete policy for anon/authenticated: only the
-- service-role Edge Function writes (it bypasses RLS).

-- Seed an empty live snapshot so the page has a valid document before
-- the first Edge Function run. The page treats an empty firms list as
-- "no data yet" (honest empty state), never as demo numbers.
insert into public.globe_snapshot (key, snapshot, mode, updated_at)
values (
  'latest',
  '{"generatedAt": 0, "mask": 5, "mode": "live", "hidden_countries": [], "firms": [], "countries": [], "traders": {"total": 0}}'::jsonb,
  'live',
  now()
)
on conflict (key) do nothing;

-- ---------- 2. profiles.country + country_manual ----------
alter table public.profiles
  add column if not exists country text
    check (country is null or country ~ '^[A-Z]{2}$');

alter table public.profiles
  add column if not exists country_manual boolean not null default false;

-- ---------- verification (run after applying) ----------
select 'globe_snapshot rows', count(*) from public.globe_snapshot;
select policyname, roles, cmd from pg_policies
  where tablename = 'globe_snapshot' order by policyname;
select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name in ('country', 'country_manual');

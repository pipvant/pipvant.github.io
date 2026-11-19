-- v15: broker connections — automatic account linking (Phase 1: TradeLocker)
-- Founder order 2026-11-19: linking must be automatic like the big
-- journals (user consents, account links, trades auto-import) — no
-- human approval step anywhere in the flow.
--
-- What this does:
--  1. broker_connections — one row per linked broker account. Stores
--     ONLY the encrypted TradeLocker refresh token (AES-GCM, key in
--     the BROKER_SYNC_KEY Edge Function secret). Passwords are never
--     stored: the Edge Function exchanges them for tokens once and
--     discards them immediately.
--  2. trades.external_id + trades.source — dedup key for synced trades
--     ('tradelocker:<positionId>') and origin ('manual' | 'import' |
--     'sync'). Synced trades land in the SAME trades table the app
--     already reads, so journal / dashboard / analytics / discipline
--     treat them exactly like manually logged trades.
--
-- Columns beyond the v10 spec (both required for sync to work):
--  - env ('demo' | 'live'): picks the TradeLocker base URL at sync
--    time. Without it the function cannot know which environment to
--    refresh against.
--  - acc_num: TradeLocker requires an accNum header on every /trade
--    call. Cached here at link time; the function re-derives it from
--    /auth/jwt/all-accounts on every sync (accNum can shift if the
--    user adds or removes accounts).
--
-- SECURITY: there is deliberately NO founder policy on this table.
-- The founder must never be able to read users' refresh tokens
-- (even encrypted). Only the row owner (via RLS) and the
-- broker-sync Edge Function (service role, bypasses RLS) can touch
-- these rows. The ciphertext is visible to its owner through RLS but
-- is useless without BROKER_SYNC_KEY, which never leaves the
-- Edge Function environment.
--
-- Idempotent: safe to run twice (IF NOT EXISTS / DROP IF EXISTS).
-- Do NOT apply from here — the coordinator applies it via the
-- Supabase SQL Editor at deploy time (see V10-BACKEND.md).

-- ---------- 1. broker_connections ----------
create table if not exists public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('tradelocker', 'dxtrade', 'ctrader', 'topstepx')),
  account_label text,
  broker_account_id text,
  acc_num text,
  env text not null default 'live' check (env in ('demo', 'live')),
  refresh_token_encrypted text,
  status text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  last_sync_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_broker_connections_user
  on public.broker_connections (user_id);

-- One connection per user per broker account: re-linking the same
-- account refreshes its token instead of creating a duplicate row.
create unique index if not exists broker_connections_user_platform_account_unique
  on public.broker_connections (user_id, platform, broker_account_id)
  where broker_account_id is not null;

alter table public.broker_connections enable row level security;

-- Users manage ONLY their own connections. No founder policy (see header).
drop policy if exists "users read own broker_connections" on public.broker_connections;
create policy "users read own broker_connections" on public.broker_connections for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "users insert own broker_connections" on public.broker_connections;
create policy "users insert own broker_connections" on public.broker_connections for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "users update own broker_connections" on public.broker_connections;
create policy "users update own broker_connections" on public.broker_connections for update
  to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users delete own broker_connections" on public.broker_connections;
create policy "users delete own broker_connections" on public.broker_connections for delete
  to authenticated using (auth.uid() = user_id);

-- ---------- 2. trades: external_id + source ----------
alter table public.trades
  add column if not exists external_id text;

alter table public.trades
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'import', 'sync'));

-- Dedup key for synced/imported trades. Partial index: manual trades
-- (external_id NULL) are unaffected. Postgres treats NULLs as
-- distinct, so the predicate is belt-and-braces.
create unique index if not exists trades_user_external_unique
  on public.trades (user_id, external_id) where external_id is not null;

-- ---------- verification (run after applying) ----------
-- Expect: broker_connections exists, empty, RLS on, 4 own-row policies
-- (and NO founder policy):
-- select 'broker_connections' as t, count(*) from public.broker_connections;
-- select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename = 'broker_connections';
-- select policyname, roles, cmd from pg_policies
--   where tablename = 'broker_connections' order by policyname;
-- Expect: trades gained external_id + source; all existing rows read
-- source = 'manual':
-- select column_name, data_type, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'trades'
--     and column_name in ('external_id', 'source')
--   order by column_name;
-- select source, count(*) from public.trades group by source;
-- select indexname, indexdef from pg_indexes
--   where schemaname = 'public'
--     and indexname in ('trades_user_external_unique',
--       'broker_connections_user_platform_account_unique');

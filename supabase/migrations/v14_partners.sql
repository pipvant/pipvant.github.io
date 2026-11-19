-- v14: Connect partners + new inbox message types (founder order 2026-11-19)
-- Partners the founder adds (on his word, when a partnership is agreed)
-- appear live on the Connect page (the app reads active partners).
-- Companies that want to partner contact us by email, outside the app —
-- there is no partnership form in the product.
-- Also extends the messages.type check: without this, the two new
-- Connect request types (firm_request / connect_request) cannot be
-- inserted — the v7 check allows only bug/idea/question.
-- Note: messages.status stays (new, prog, done) — requests are answered
-- with the existing inbox reply flow; there is no 'replied' status.
-- Founder UIDs (both accounts, per 2026-11-15 decision "خليهم بجوج"):
--   admin    ed6c93e6-209e-4e6d-b40a-c2965a4d18b2 (bniaichsifdin110@gmail.com)
--   personal 38b5a8b3-47dd-490d-9cba-8bd7b0e31000 (sifeddinebneiaich45@gmail.com)

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('Prop firm', 'Broker', 'Data provider')),
  logo_url text,
  website text,
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now()
);

create unique index if not exists partners_name_lower_unique
  on public.partners (lower(name));

alter table public.partners enable row level security;

drop policy if exists "founder all partners" on public.partners;
create policy "founder all partners" on public.partners for all
  to authenticated
  using (auth.uid() in (
    'ed6c93e6-209e-4e6d-b40a-c2965a4d18b2',
    '38b5a8b3-47dd-490d-9cba-8bd7b0e31000'
  ))
  with check (auth.uid() in (
    'ed6c93e6-209e-4e6d-b40a-c2965a4d18b2',
    '38b5a8b3-47dd-490d-9cba-8bd7b0e31000'
  ));

drop policy if exists "public read active partners" on public.partners;
create policy "public read active partners" on public.partners for select
  to anon, authenticated
  using (status = 'active');

-- messages.type: allow the two Connect request types.
-- The constraint name is the Postgres default for the inline v7 check
-- (messages_type_check); drop-if-exists keeps this idempotent.
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check
  check (type in ('bug', 'idea', 'question',
                  'firm_request', 'connect_request'));

-- verification (run after applying)
select 'partners rows', count(*) from public.partners;
select policyname, roles, cmd from pg_policies
  where tablename = 'partners' order by policyname;
select conname, pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.messages'::regclass
    and conname = 'messages_type_check';

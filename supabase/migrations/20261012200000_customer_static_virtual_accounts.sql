-- Permanent per-customer Flutterwave virtual accounts.
-- NIN is intentionally NOT stored by TopVerify: it is sent directly to Flutterwave
-- during provisioning and discarded from application memory after the request.
create table if not exists public.virtual_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete restrict,
  provider text not null default 'flutterwave' check (provider = 'flutterwave'),
  tx_ref text not null unique,
  account_number text,
  bank_name text,
  provider_reference text,
  status text not null default 'provisioning' check (status in ('provisioning','active','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint virtual_accounts_active_details check (
    status <> 'active' or (account_number is not null and bank_name is not null)
  )
);

create index if not exists virtual_accounts_status_idx on public.virtual_accounts(status);
alter table public.virtual_accounts enable row level security;
drop policy if exists virtual_accounts_deny_browser_access on public.virtual_accounts;
create policy virtual_accounts_deny_browser_access on public.virtual_accounts
  for all to anon, authenticated using (false) with check (false);
revoke all on table public.virtual_accounts from public, anon, authenticated;
grant all on table public.virtual_accounts to service_role;

-- A Flutterwave transaction reference must map to at most one funding record.
create unique index if not exists wallet_topups_provider_reference_unique
  on public.wallet_topups(provider_reference) where provider_reference is not null;


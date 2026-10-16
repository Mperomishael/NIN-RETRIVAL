-- Idempotent sync for wallet funding. Safe to run on a database that already has
-- these objects; it only fills in anything that a missed migration left behind.
-- If wallets are not being credited, run this in the Supabase SQL editor first.

-- 1. Permanent virtual accounts table (migration 20261012200000).
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
alter table public.virtual_accounts enable row level security;
drop policy if exists virtual_accounts_deny_browser_access on public.virtual_accounts;
create policy virtual_accounts_deny_browser_access on public.virtual_accounts
  for all to anon, authenticated using (false) with check (false);
revoke all on table public.virtual_accounts from public, anon, authenticated;
grant all on table public.virtual_accounts to service_role;

-- 2. Bank transfers can be any positive amount (migration 20261012203000).
--    Without this, transfers under ₦500 can never be recorded.
alter table public.wallet_topups drop constraint if exists wallet_topups_amount_kobo_check;
alter table public.wallet_topups add constraint wallet_topups_amount_kobo_check check (amount_kobo > 0);

-- 3. One funding record per Flutterwave transaction.
create unique index if not exists wallet_topups_provider_reference_unique
  on public.wallet_topups(provider_reference) where provider_reference is not null;

-- 4. Make sure every profile has a wallet (the credit function raises WALLET_NOT_FOUND otherwise).
insert into public.wallets (user_id)
select p.id from public.profiles p
where not exists (select 1 from public.wallets w where w.user_id = p.id)
on conflict (user_id) do nothing;

-- 5. Ensure the service role can run the credit function.
grant execute on function public.topverify_credit_flutterwave_topup(text, text, bigint, text, jsonb) to service_role;

-- Enable row-level-secured Realtime updates for customer wallet balances and request activity.
-- wallet_topups intentionally remains server-only; clients retrieve their own safe top-up history through an authenticated API.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication is missing';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wallets'
  ) then
    alter publication supabase_realtime add table public.wallets;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wallet_ledger'
  ) then
    alter publication supabase_realtime add table public.wallet_ledger;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'identity_requests'
  ) then
    alter publication supabase_realtime add table public.identity_requests;
  end if;
end $$;

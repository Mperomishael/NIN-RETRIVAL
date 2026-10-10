-- Flutterwave NGN wallet top-ups. Customer wallets remain internal ledger liabilities;
-- Flutterwave collections settle to the merchant's configured settlement account.
create table if not exists public.wallet_topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  tx_ref text not null unique,
  amount_kobo bigint not null check (amount_kobo between 50000 and 100000000),
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'pending' check (status in ('pending', 'credited', 'failed')),
  flutterwave_transaction_id text unique,
  provider_reference text,
  paid_amount_kobo bigint,
  provider_payload jsonb not null default '{}'::jsonb,
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wallet_topups_user_created_idx
  on public.wallet_topups(user_id, created_at desc);

alter table public.wallet_topups enable row level security;
drop policy if exists wallet_topups_deny_browser_access on public.wallet_topups;
create policy wallet_topups_deny_browser_access
  on public.wallet_topups
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on table public.wallet_topups from public, anon, authenticated;
grant all on table public.wallet_topups to service_role;

create or replace function public.topverify_credit_flutterwave_topup(
  p_tx_ref text,
  p_transaction_id text,
  p_amount_kobo bigint,
  p_currency text,
  p_provider_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_topup public.wallet_topups%rowtype;
  v_balance bigint;
begin
  if coalesce(trim(p_tx_ref), '') = ''
     or coalesce(trim(p_transaction_id), '') = ''
     or p_amount_kobo <= 0
     or upper(coalesce(p_currency, '')) <> 'NGN' then
    raise exception 'INVALID_FLUTTERWAVE_PAYMENT';
  end if;

  select * into v_topup
    from public.wallet_topups
   where tx_ref = p_tx_ref
   for update;

  if not found then
    raise exception 'TOPUP_NOT_FOUND';
  end if;

  if v_topup.status = 'credited' then
    select balance_kobo into v_balance
      from public.wallets
     where user_id = v_topup.user_id;
    return jsonb_build_object(
      'status', 'credited',
      'already_credited', true,
      'balance_after_kobo', v_balance
    );
  end if;

  if v_topup.status <> 'pending' then
    raise exception 'TOPUP_NOT_PENDING';
  end if;

  if v_topup.amount_kobo <> p_amount_kobo then
    raise exception 'FLUTTERWAVE_AMOUNT_MISMATCH';
  end if;

  if exists (
    select 1 from public.wallet_topups
     where flutterwave_transaction_id = p_transaction_id
       and tx_ref <> p_tx_ref
  ) then
    raise exception 'FLUTTERWAVE_TRANSACTION_ALREADY_USED';
  end if;

  select balance_kobo into v_balance
    from public.wallets
   where user_id = v_topup.user_id
   for update;

  if not found then
    raise exception 'WALLET_NOT_FOUND';
  end if;

  v_balance := v_balance + v_topup.amount_kobo;

  update public.wallets
     set balance_kobo = v_balance,
         updated_at = now()
   where user_id = v_topup.user_id;

  insert into public.wallet_ledger (
    user_id, entry_type, amount_kobo, balance_after_kobo,
    reference, description, payment_provider, provider_reference
  ) values (
    v_topup.user_id, 'credit', v_topup.amount_kobo, v_balance,
    'FLW-' || v_topup.tx_ref, 'Flutterwave wallet funding',
    'flutterwave', p_transaction_id
  );

  update public.wallet_topups
     set status = 'credited',
         flutterwave_transaction_id = p_transaction_id,
         provider_reference = p_transaction_id,
         paid_amount_kobo = p_amount_kobo,
         provider_payload = coalesce(p_provider_payload, '{}'::jsonb),
         credited_at = now(),
         updated_at = now()
   where id = v_topup.id;

  insert into public.payment_events (
    provider, provider_event_id, provider_reference, user_id,
    amount_kobo, status, raw_event
  ) values (
    'flutterwave', 'transaction:' || p_transaction_id, p_tx_ref,
    v_topup.user_id, p_amount_kobo, 'credited',
    coalesce(p_provider_payload, '{}'::jsonb)
  )
  on conflict (provider, provider_event_id) do nothing;

  insert into public.audit_logs (
    actor_id, target_user_id, action, entity_type, entity_id, metadata
  ) values (
    v_topup.user_id, v_topup.user_id, 'wallet_topup_credited',
    'wallet_topup', v_topup.id::text,
    jsonb_build_object(
      'tx_ref', v_topup.tx_ref,
      'transaction_id', p_transaction_id,
      'amount_kobo', p_amount_kobo,
      'currency', 'NGN'
    )
  );

  return jsonb_build_object(
    'status', 'credited',
    'already_credited', false,
    'balance_after_kobo', v_balance
  );
end;
$function$;

revoke all on function public.topverify_credit_flutterwave_topup(text, text, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.topverify_credit_flutterwave_topup(text, text, bigint, text, jsonb)
  to service_role;

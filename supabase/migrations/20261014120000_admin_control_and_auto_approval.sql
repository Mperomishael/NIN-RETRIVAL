-- Admin control functions + automatic approval for users whose NIN has been verified.

-- 1. Users who already have an active, NIN-verified deposit account no longer need manual approval.
update public.profiles p
set status = 'approved', authorization_reviewed_at = coalesce(p.authorization_reviewed_at, now()), updated_at = now()
where p.status = 'pending'
  and exists (select 1 from public.virtual_accounts v where v.user_id = p.id and v.status = 'active');

-- 2. Platform statistics for the admin dashboard.
create or replace function public.topverify_admin_stats()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'users', (select jsonb_build_object(
        'total', count(*),
        'pending', count(*) filter (where status = 'pending'),
        'approved', count(*) filter (where status = 'approved'),
        'restricted', count(*) filter (where status = 'restricted'),
        'admins', count(*) filter (where is_super_admin)) from public.profiles),
    'wallet_liability_kobo', (select coalesce(sum(balance_kobo), 0) from public.wallets),
    'funded_month_kobo', (select coalesce(sum(amount_kobo), 0) from public.wallet_topups
                          where status = 'credited' and credited_at >= date_trunc('month', now())),
    'funded_total_kobo', (select coalesce(sum(amount_kobo), 0) from public.wallet_topups where status = 'credited'),
    'revenue_month_kobo', (select coalesce(sum(fee_kobo), 0) from public.identity_requests
                           where status in ('completed', 'processing') and created_at >= date_trunc('month', now())),
    'revenue_total_kobo', (select coalesce(sum(fee_kobo), 0) from public.identity_requests where status in ('completed', 'processing')),
    'requests', (select jsonb_build_object(
        'total', count(*),
        'today', count(*) filter (where created_at >= date_trunc('day', now())),
        'processing', count(*) filter (where status = 'processing'),
        'completed', count(*) filter (where status = 'completed'),
        'failed', count(*) filter (where status in ('failed', 'refunded'))) from public.identity_requests),
    'pending_topups', (select count(*) from public.wallet_topups where status = 'pending'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'requests', coalesce(c.n, 0), 'revenue_kobo', coalesce(c.rev, 0)) order by d), '[]'::jsonb)
              from generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') d
              left join (select date_trunc('day', created_at) as day, count(*) as n,
                                coalesce(sum(fee_kobo) filter (where status in ('completed', 'processing')), 0) as rev
                         from public.identity_requests
                         where created_at >= date_trunc('day', now()) - interval '6 days' group by 1) c on c.day = d)
  );
$$;
revoke all on function public.topverify_admin_stats() from public, anon, authenticated;
grant execute on function public.topverify_admin_stats() to service_role;

-- 3. Manual wallet adjustment with ledger entry and audit trail.
create or replace function public.topverify_admin_adjust_wallet(
  p_admin_id uuid, p_user_id uuid, p_direction text, p_amount_kobo bigint, p_reason text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_balance bigint; v_ref text;
begin
  if not exists (select 1 from public.profiles where id = p_admin_id and is_super_admin) then raise exception 'NOT_ADMIN'; end if;
  if p_direction not in ('credit', 'debit') then raise exception 'INVALID_DIRECTION'; end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 or p_amount_kobo > 100000000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  perform 1 from public.wallets where user_id = p_user_id for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;

  if p_direction = 'credit' then
    update public.wallets set balance_kobo = balance_kobo + p_amount_kobo, updated_at = now()
    where user_id = p_user_id returning balance_kobo into v_balance;
  else
    update public.wallets set balance_kobo = balance_kobo - p_amount_kobo, updated_at = now()
    where user_id = p_user_id and balance_kobo >= p_amount_kobo returning balance_kobo into v_balance;
    if v_balance is null then raise exception 'INSUFFICIENT_BALANCE'; end if;
  end if;

  v_ref := 'ADJ-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.wallet_ledger(user_id, entry_type, amount_kobo, balance_after_kobo, reference, description, payment_provider, created_by)
  values (p_user_id, case when p_direction = 'credit' then 'adjustment'::public.wallet_entry_type else 'debit'::public.wallet_entry_type end,
          p_amount_kobo, v_balance, v_ref, 'Admin adjustment: ' || left(trim(p_reason), 150), 'admin', p_admin_id);
  insert into public.audit_logs(actor_id, target_user_id, action, entity_type, entity_id, metadata)
  values (p_admin_id, p_user_id, 'wallet_adjusted', 'wallet', p_user_id::text,
          jsonb_build_object('direction', p_direction, 'amount_kobo', p_amount_kobo, 'reason', left(trim(p_reason), 150), 'reference', v_ref));
  return jsonb_build_object('balance_after_kobo', v_balance, 'reference', v_ref);
end;
$$;
revoke all on function public.topverify_admin_adjust_wallet(uuid, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.topverify_admin_adjust_wallet(uuid, uuid, text, bigint, text) to service_role;

-- 4. Manual refund of a request fee. Shares the -REFUND reference with automatic refunds, so a fee can never be refunded twice.
create or replace function public.topverify_admin_refund_request(p_admin_id uuid, p_request_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_req public.identity_requests%rowtype; v_balance bigint; v_ref text;
begin
  if not exists (select 1 from public.profiles where id = p_admin_id and is_super_admin) then raise exception 'NOT_ADMIN'; end if;
  select * into v_req from public.identity_requests where id = p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  v_ref := v_req.request_reference || '-REFUND';
  if v_req.status = 'refunded' or exists (select 1 from public.wallet_ledger where reference = v_ref) then raise exception 'ALREADY_REFUNDED'; end if;
  if v_req.fee_kobo <= 0 then raise exception 'NOTHING_TO_REFUND'; end if;

  update public.wallets set balance_kobo = balance_kobo + v_req.fee_kobo, updated_at = now()
  where user_id = v_req.user_id returning balance_kobo into v_balance;
  if v_balance is null then raise exception 'WALLET_NOT_FOUND'; end if;
  insert into public.wallet_ledger(user_id, entry_type, amount_kobo, balance_after_kobo, reference, description, payment_provider, created_by)
  values (v_req.user_id, 'refund', v_req.fee_kobo, v_balance, v_ref, 'Admin refund: ' || left(coalesce(nullif(trim(p_reason), ''), 'Request refunded'), 150), 'admin', p_admin_id);
  update public.identity_requests set status = 'refunded', completed_at = coalesce(completed_at, now()) where id = p_request_id;
  insert into public.audit_logs(actor_id, target_user_id, action, entity_type, entity_id, metadata)
  values (p_admin_id, v_req.user_id, 'request_refunded', 'identity_request', p_request_id::text,
          jsonb_build_object('fee_kobo', v_req.fee_kobo, 'reason', left(coalesce(p_reason, ''), 150)));
  return jsonb_build_object('balance_after_kobo', v_balance);
end;
$$;
revoke all on function public.topverify_admin_refund_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.topverify_admin_refund_request(uuid, uuid, text) to service_role;

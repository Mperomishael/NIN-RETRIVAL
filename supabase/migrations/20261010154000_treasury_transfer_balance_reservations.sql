-- Reserve approved/pending transfer capacity against the treasury ledger to prevent over-proposal.
create or replace function private.topverify_request_treasury_transfer(
 p_source_account_id uuid,p_destination_account_id uuid,p_amount numeric,p_rationale text,p_requester_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare s public.treasury_accounts%rowtype; d public.treasury_accounts%rowtype; t public.treasury_transfers%rowtype;
 v_ledger_balance numeric; v_reserved numeric;
begin
 if not exists(select 1 from public.profiles p where p.id=p_requester_id and p.is_super_admin and p.status='approved') then raise exception 'ADMIN_REQUIRED'; end if;
 if p_amount <= 0 or length(trim(coalesce(p_rationale,''))) < 8 or length(trim(p_rationale)) > 500 then raise exception 'INVALID_TRANSFER_DETAILS'; end if;
 select * into s from public.treasury_accounts where id=p_source_account_id and is_active for update;
 select * into d from public.treasury_accounts where id=p_destination_account_id and is_active for update;
 if s.id is null or d.id is null then raise exception 'TREASURY_ACCOUNT_NOT_FOUND'; end if;
 if s.id=d.id or s.asset<>d.asset or s.network<>d.network then raise exception 'INCOMPATIBLE_TREASURY_ACCOUNTS'; end if;
 select coalesce(sum(case when l.direction='credit' then l.amount else -l.amount end),0)
 into v_ledger_balance from public.treasury_ledger l where l.account_id=s.id;
 select coalesce(sum(t.amount),0) into v_reserved from public.treasury_transfers t
 where t.source_account_id=s.id and t.status in ('pending_approval','approved_to_execute');
 if v_ledger_balance-v_reserved < p_amount then raise exception 'INSUFFICIENT_TREASURY_BALANCE'; end if;
 insert into public.treasury_transfers(source_account_id,destination_account_id,asset,amount,status,rationale,requested_by)
 values(s.id,d.id,s.asset,p_amount,'pending_approval',trim(p_rationale),p_requester_id) returning * into t;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(p_requester_id,'treasury_transfer_requested','treasury_transfer',t.id::text,jsonb_build_object('source',s.code,'destination',d.code,'asset',s.asset,'amount',p_amount));
 return jsonb_build_object('id',t.id,'status',t.status);
end $$;

create or replace function private.topverify_approve_treasury_transfer(p_transfer_id uuid,p_approver_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare t public.treasury_transfers%rowtype; s public.treasury_accounts%rowtype;
 v_ledger_balance numeric; v_reserved numeric;
begin
 if not exists(select 1 from public.profiles p where p.id=p_approver_id and p.is_super_admin and p.status='approved') then raise exception 'ADMIN_REQUIRED'; end if;
 select * into t from public.treasury_transfers where id=p_transfer_id for update;
 if not found then raise exception 'TRANSFER_NOT_FOUND'; end if;
 if t.status <> 'pending_approval' then return jsonb_build_object('status',t.status,'already_reviewed',true); end if;
 if t.requested_by=p_approver_id then raise exception 'SECOND_APPROVER_REQUIRED'; end if;
 select * into s from public.treasury_accounts where id=t.source_account_id and is_active for update;
 if not found then raise exception 'TREASURY_ACCOUNT_NOT_FOUND'; end if;
 select coalesce(sum(case when l.direction='credit' then l.amount else -l.amount end),0)
 into v_ledger_balance from public.treasury_ledger l where l.account_id=s.id;
 select coalesce(sum(other.amount),0) into v_reserved from public.treasury_transfers other
 where other.source_account_id=s.id and other.status in ('pending_approval','approved_to_execute') and other.id<>t.id;
 if v_ledger_balance-v_reserved < t.amount then raise exception 'INSUFFICIENT_TREASURY_BALANCE'; end if;
 update public.treasury_transfers set status='approved_to_execute',approved_by=p_approver_id,approved_at=now() where id=t.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(p_approver_id,'treasury_transfer_approved_to_execute','treasury_transfer',t.id::text,jsonb_build_object('asset',t.asset,'amount',t.amount,'source_account_id',t.source_account_id,'destination_account_id',t.destination_account_id));
 return jsonb_build_object('status','approved_to_execute','id',t.id,'note','External custody execution is not configured.');
end $$;

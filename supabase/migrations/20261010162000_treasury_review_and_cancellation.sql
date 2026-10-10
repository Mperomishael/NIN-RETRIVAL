-- Allow reviewed rejection/cancellation so false deposits and stale transfer reservations can be closed safely.
alter table public.treasury_transfers drop constraint if exists treasury_transfers_status_check;
alter table public.treasury_transfers add constraint treasury_transfers_status_check
 check(status in ('pending_approval','approved_to_execute','rejected','cancelled','executed','failed'));

create or replace function private.topverify_reject_ngn_deposit(p_deposit_id uuid,p_reviewer_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare d public.treasury_deposits%rowtype;
begin
 if not exists(select 1 from public.profiles p where p.id=p_reviewer_id and p.is_super_admin and p.status='approved') then raise exception 'ADMIN_REQUIRED'; end if;
 if length(trim(coalesce(p_reason,''))) < 8 or length(trim(p_reason)) > 500 then raise exception 'REASON_REQUIRED'; end if;
 select * into d from public.treasury_deposits where id=p_deposit_id for update;
 if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
 if d.asset<>'NGN' or d.status<>'pending_review' then raise exception 'DEPOSIT_NOT_PENDING'; end if;
 if d.submitted_by=p_reviewer_id then raise exception 'SECOND_REVIEWER_REQUIRED'; end if;
 update public.treasury_deposits set status='rejected',reviewed_by=p_reviewer_id,reviewed_at=now(),
 metadata=metadata||jsonb_build_object('review_reason',trim(p_reason)) where id=d.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(p_reviewer_id,'treasury_ngn_deposit_rejected','treasury_deposit',d.id::text,jsonb_build_object('reason',trim(p_reason),'amount',d.amount,'external_reference',d.external_reference));
 return jsonb_build_object('status','rejected','deposit_id',d.id);
end $$;

create or replace function private.topverify_cancel_treasury_transfer(p_transfer_id uuid,p_actor_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare t public.treasury_transfers%rowtype; v_status text;
begin
 if not exists(select 1 from public.profiles p where p.id=p_actor_id and p.is_super_admin and p.status='approved') then raise exception 'ADMIN_REQUIRED'; end if;
 if length(trim(coalesce(p_reason,''))) < 8 or length(trim(p_reason)) > 500 then raise exception 'REASON_REQUIRED'; end if;
 select * into t from public.treasury_transfers where id=p_transfer_id for update;
 if not found then raise exception 'TRANSFER_NOT_FOUND'; end if;
 if t.status not in ('pending_approval','approved_to_execute') then return jsonb_build_object('status',t.status,'already_closed',true); end if;
 if t.status='approved_to_execute' and t.requested_by=p_actor_id then raise exception 'REQUESTER_CANNOT_CANCEL_APPROVED_TRANSFER'; end if;
 v_status:=case when t.status='pending_approval' and t.requested_by<>p_actor_id then 'rejected' when t.status='pending_approval' then 'cancelled' else 'cancelled' end;
 update public.treasury_transfers set status=v_status,metadata=metadata||jsonb_build_object('closure_reason',trim(p_reason),'closed_by',p_actor_id),execution_reference=null where id=t.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(p_actor_id,'treasury_transfer_'||v_status,'treasury_transfer',t.id::text,jsonb_build_object('reason',trim(p_reason),'amount',t.amount,'asset',t.asset));
 return jsonb_build_object('status',v_status,'id',t.id);
end $$;

create or replace function public.topverify_admin_reject_ngn_deposit(p_deposit_id uuid,p_reviewer_id uuid,p_reason text)
returns jsonb language sql security definer set search_path=pg_catalog,public,private
as $$ select private.topverify_reject_ngn_deposit(p_deposit_id,p_reviewer_id,p_reason) $$;
create or replace function public.topverify_admin_cancel_treasury_transfer(p_transfer_id uuid,p_actor_id uuid,p_reason text)
returns jsonb language sql security definer set search_path=pg_catalog,public,private
as $$ select private.topverify_cancel_treasury_transfer(p_transfer_id,p_actor_id,p_reason) $$;

revoke all on function private.topverify_reject_ngn_deposit(uuid,uuid,text) from public,anon,authenticated;
revoke all on function private.topverify_cancel_treasury_transfer(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.topverify_reject_ngn_deposit(uuid,uuid,text) to service_role;
grant execute on function private.topverify_cancel_treasury_transfer(uuid,uuid,text) to service_role;
revoke all on function public.topverify_admin_reject_ngn_deposit(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.topverify_admin_cancel_treasury_transfer(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.topverify_admin_reject_ngn_deposit(uuid,uuid,text) to service_role;
grant execute on function public.topverify_admin_cancel_treasury_transfer(uuid,uuid,text) to service_role;

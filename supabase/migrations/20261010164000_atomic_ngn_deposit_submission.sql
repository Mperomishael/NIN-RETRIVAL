create or replace function private.topverify_record_ngn_deposit(
 p_amount numeric,p_external_reference text,p_evidence_reference text,p_actor_id uuid,p_note text default ''
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare a public.treasury_accounts%rowtype; d public.treasury_deposits%rowtype;
begin
 if not exists(select 1 from public.profiles p where p.id=p_actor_id and p.is_super_admin and p.status='approved') then raise exception 'ADMIN_REQUIRED'; end if;
 if p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'INVALID_NGN_AMOUNT'; end if;
 if length(trim(coalesce(p_external_reference,'')))<5 or length(trim(p_external_reference))>180 then raise exception 'INVALID_EXTERNAL_REFERENCE'; end if;
 if length(trim(coalesce(p_evidence_reference,'')))<5 or length(trim(p_evidence_reference))>500 then raise exception 'EVIDENCE_REQUIRED'; end if;
 select * into a from public.treasury_accounts where code='NGN_HOT' and asset='NGN' and network='NGN_BANK' and custody_class='hot' and is_active for update;
 if not found then raise exception 'NGN_HOT_ACCOUNT_NOT_FOUND'; end if;
 insert into public.treasury_deposits(account_id,asset,network,amount,external_reference,status,submitted_by,evidence_reference,metadata)
 values(a.id,'NGN','NGN_BANK',p_amount,trim(p_external_reference),'pending_review',p_actor_id,trim(p_evidence_reference),jsonb_build_object('submitted_via','admin_console','note',left(trim(coalesce(p_note,'')),300)))
 returning * into d;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(p_actor_id,'treasury_ngn_deposit_submitted','treasury_deposit',d.id::text,jsonb_build_object('amount',p_amount,'external_reference',trim(p_external_reference),'evidence_reference',trim(p_evidence_reference)));
 return jsonb_build_object('id',d.id,'status',d.status);
end $$;

create or replace function public.topverify_admin_record_ngn_deposit(
 p_amount numeric,p_external_reference text,p_evidence_reference text,p_actor_id uuid,p_note text default ''
) returns jsonb language sql security definer set search_path=pg_catalog,public,private
as $$ select private.topverify_record_ngn_deposit(p_amount,p_external_reference,p_evidence_reference,p_actor_id,p_note) $$;

revoke all on function private.topverify_record_ngn_deposit(numeric,text,text,uuid,text) from public,anon,authenticated;
grant execute on function private.topverify_record_ngn_deposit(numeric,text,text,uuid,text) to service_role;
revoke all on function public.topverify_admin_record_ngn_deposit(numeric,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.topverify_admin_record_ngn_deposit(numeric,text,text,uuid,text) to service_role;

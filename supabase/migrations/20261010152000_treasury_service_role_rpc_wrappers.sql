-- PostgREST-compatible wrappers: execution is still restricted to service_role only.
create or replace function public.topverify_admin_approve_ngn_deposit(p_deposit_id uuid,p_reviewer_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public,private
as $$ select private.topverify_approve_ngn_deposit(p_deposit_id,p_reviewer_id) $$;
create or replace function public.topverify_admin_record_bsc_usdt_deposit(
 p_account_id uuid,p_tx_hash text,p_amount numeric,p_confirmations integer,p_block_number bigint,p_actor_id uuid,p_metadata jsonb default '{}'::jsonb
) returns jsonb language sql security definer set search_path=pg_catalog,public,private
as $$ select private.topverify_record_bsc_usdt_deposit(p_account_id,p_tx_hash,p_amount,p_confirmations,p_block_number,p_actor_id,p_metadata) $$;
create or replace function public.topverify_admin_request_treasury_transfer(
 p_source_account_id uuid,p_destination_account_id uuid,p_amount numeric,p_rationale text,p_requester_id uuid
) returns jsonb language sql security definer set search_path=pg_catalog,public,private
as $$ select private.topverify_request_treasury_transfer(p_source_account_id,p_destination_account_id,p_amount,p_rationale,p_requester_id) $$;
create or replace function public.topverify_admin_approve_treasury_transfer(p_transfer_id uuid,p_approver_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public,private
as $$ select private.topverify_approve_treasury_transfer(p_transfer_id,p_approver_id) $$;

revoke all on function public.topverify_admin_approve_ngn_deposit(uuid,uuid) from public,anon,authenticated;
revoke all on function public.topverify_admin_record_bsc_usdt_deposit(uuid,text,numeric,integer,bigint,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.topverify_admin_request_treasury_transfer(uuid,uuid,numeric,text,uuid) from public,anon,authenticated;
revoke all on function public.topverify_admin_approve_treasury_transfer(uuid,uuid) from public,anon,authenticated;
grant execute on function public.topverify_admin_approve_ngn_deposit(uuid,uuid) to service_role;
grant execute on function public.topverify_admin_record_bsc_usdt_deposit(uuid,text,numeric,integer,bigint,uuid,jsonb) to service_role;
grant execute on function public.topverify_admin_request_treasury_transfer(uuid,uuid,numeric,text,uuid) to service_role;
grant execute on function public.topverify_admin_approve_treasury_transfer(uuid,uuid) to service_role;

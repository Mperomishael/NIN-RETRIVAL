-- Empire Identity Hub starter schema. Review before applying to a production project.
create extension if not exists pgcrypto;
do $$ begin create type public.agent_status as enum ('pending','approved','restricted'); exception when duplicate_object then null; end $$;
do $$ begin create type public.identity_request_status as enum ('queued','processing','completed','failed','refunded','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.wallet_entry_type as enum ('credit','debit','refund','adjustment'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null, phone text, business_name text, business_address text,
 country_code text not null default 'NG', intended_use text,
 authorization_reviewed_at timestamptz,
 status public.agent_status not null default 'pending',
 is_super_admin boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.services (
 id text primary key, name text not null, description text not null default '',
 category text not null, price_kobo bigint not null check(price_kobo >= 0),
 enabled boolean not null default true, requires_manual_review boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.wallets (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 currency text not null default 'NGN' check(currency='NGN'),
 balance_kobo bigint not null default 0 check(balance_kobo >= 0), updated_at timestamptz not null default now()
);
create table if not exists public.wallet_ledger (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 entry_type public.wallet_entry_type not null, amount_kobo bigint not null check(amount_kobo > 0),
 balance_after_kobo bigint, reference text not null unique, description text not null,
 payment_provider text, provider_reference text, created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.identity_requests (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 service_id text not null references public.services(id), status public.identity_request_status not null default 'queued',
 fee_kobo bigint not null check(fee_kobo >= 0), request_reference text not null unique, provider_reference text,
 input_payload jsonb not null default '{}'::jsonb, result_payload jsonb, error_code text, error_message_safe text,
 consent_confirmed_at timestamptz not null, created_at timestamptz not null default now(), completed_at timestamptz
);
create table if not exists public.payment_events (
 id uuid primary key default gen_random_uuid(), provider text not null, provider_event_id text not null,
 provider_reference text not null, user_id uuid not null references public.profiles(id), amount_kobo bigint not null check(amount_kobo > 0),
 status text not null check(status in ('received','verified','rejected','credited')), raw_event jsonb,
 created_at timestamptz not null default now(), unique(provider,provider_event_id)
);
create table if not exists public.audit_logs (
 id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id),
 target_user_id uuid references public.profiles(id), action text not null, entity_type text not null,
 entity_id text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_super_admin=true and p.status='approved') $$;

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.identity_requests enable row level security;
alter table public.payment_events enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profile read own or admin" on public.profiles;
create policy "profile read own or admin" on public.profiles for select to authenticated using(id=auth.uid() or public.is_super_admin());
-- Only an existing super admin can update profile rows. Regular users cannot self-approve or grant themselves admin access.
drop policy if exists "profile update own or admin" on public.profiles;
drop policy if exists "profile update admin only" on public.profiles;
create policy "profile update admin only" on public.profiles for update to authenticated using((select public.is_super_admin())) with check((select public.is_super_admin()));
drop policy if exists "services read enabled or admin" on public.services;
create policy "services read enabled or admin" on public.services for select to authenticated using(enabled=true or public.is_super_admin());
drop policy if exists "services admin all" on public.services;
create policy "services admin all" on public.services for all to authenticated using(public.is_super_admin()) with check(public.is_super_admin());
drop policy if exists "wallet read own or admin" on public.wallets;
create policy "wallet read own or admin" on public.wallets for select to authenticated using(user_id=auth.uid() or public.is_super_admin());
drop policy if exists "ledger read own or admin" on public.wallet_ledger;
create policy "ledger read own or admin" on public.wallet_ledger for select to authenticated using(user_id=auth.uid() or public.is_super_admin());
drop policy if exists "requests read own or admin" on public.identity_requests;
create policy "requests read own or admin" on public.identity_requests for select to authenticated using(user_id=auth.uid() or public.is_super_admin());
drop policy if exists "payment events admin read" on public.payment_events;
create policy "payment events admin read" on public.payment_events for select to authenticated using(public.is_super_admin());
drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs for select to authenticated using(public.is_super_admin());

-- Trusted server endpoints only should insert requests, debit wallets, process payments, and write audit logs.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
 insert into public.profiles(id,full_name,phone,business_name,status,is_super_admin)
 values(new.id,coalesce(new.raw_user_meta_data->>'full_name','New agent'),new.raw_user_meta_data->>'phone',new.raw_user_meta_data->>'business_name','pending',false)
 on conflict(id) do nothing;
 insert into public.wallets(user_id,balance_kobo) values(new.id,0) on conflict(user_id) do nothing;
 return new;
end; $;
revoke all on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

insert into public.services(id,name,description,category,price_kobo) values
('nin-lookup','NIN Verification','Verify a NIN using an authorized source','Verification',35000),
('phone-lookup','NIN Phone Lookup','Check a phone association with authorization','Verification',45000),
('bvn-verify','BVN Verification','Validate a BVN using an authorized source','Verification',40000),
('demographic','Demographic Match','Compare supplied details with an authorized response','Verification',50000),
('nin-slip','NIN Slip Request','Request an eligible NIN slip document','Documents',120000),
('bvn-slip','BVN Slip Request','Submit an eligible document request','Documents',100000),
('nin-validation','NIN Validation','Submit a validation request','Special services',70000),
('ipe-clearance','IPE Clearance','Submit or track a clearance request','Special services',150000),
('nin-modification','NIN Modification','Start an eligible demographic update request','Special services',200000)
on conflict(id) do nothing;

-- Apply this schema only after review. To bootstrap the first administrator:
-- UPDATE public.profiles SET is_super_admin=true,status='approved',authorization_reviewed_at=now() WHERE id='VERIFIED_AUTH_USER_UUID';
-- Never expose admin assignment in a public signup form. Store only minimal identity data with appropriate encryption and retention.


-- TopVerify onboarding metadata. The signup form records acceptance of the current acceptable-use version.
alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists kyc_submitted_at timestamptz;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
 insert into public.profiles(
   id, full_name, phone, business_name, business_address, intended_use,
   terms_accepted_at, terms_version, kyc_submitted_at, status, is_super_admin
 )
 values(
   new.id,
   coalesce(new.raw_user_meta_data->>'full_name','New agent'),
   nullif(new.raw_user_meta_data->>'phone',''),
   nullif(new.raw_user_meta_data->>'business_name',''),
   nullif(new.raw_user_meta_data->>'business_address',''),
   nullif(new.raw_user_meta_data->>'intended_use',''),
   nullif(new.raw_user_meta_data->>'terms_accepted_at','')::timestamptz,
   nullif(new.raw_user_meta_data->>'terms_version',''),
   now(),
   'pending',
   false
 )
 on conflict(id) do nothing;
 insert into public.wallets(user_id,balance_kobo) values(new.id,0) on conflict(user_id) do nothing;
 return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- These billing functions are callable only by the server-side service role.
create or replace function public.topverify_reserve_request(
 p_user_id uuid, p_service_id text, p_request_reference text, p_consent_confirmed_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_profile public.profiles%rowtype; v_service public.services%rowtype; v_wallet public.wallets%rowtype;
        v_request_id uuid; v_new_balance bigint;
begin
 select * into v_profile from public.profiles where id=p_user_id for update;
 if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
 if v_profile.status <> 'approved' then raise exception 'ACCOUNT_NOT_APPROVED'; end if;
 if v_profile.terms_accepted_at is null then raise exception 'TERMS_NOT_ACCEPTED'; end if;
 select * into v_service from public.services where id=p_service_id and enabled=true;
 if not found then raise exception 'SERVICE_UNAVAILABLE'; end if;
 if p_consent_confirmed_at is null then raise exception 'CONSENT_REQUIRED'; end if;
 select * into v_wallet from public.wallets where user_id=p_user_id for update;
 if not found then raise exception 'WALLET_NOT_FOUND'; end if;
 if v_wallet.balance_kobo < v_service.price_kobo then raise exception 'INSUFFICIENT_BALANCE'; end if;
 v_new_balance := v_wallet.balance_kobo - v_service.price_kobo;
 update public.wallets set balance_kobo=v_new_balance,updated_at=now() where user_id=p_user_id;
 insert into public.wallet_ledger(user_id,entry_type,amount_kobo,balance_after_kobo,reference,description)
 values(p_user_id,'debit',v_service.price_kobo,v_new_balance,p_request_reference,'TopVerify '||v_service.name);
 insert into public.identity_requests(user_id,service_id,status,fee_kobo,request_reference,input_payload,consent_confirmed_at)
 values(p_user_id,p_service_id,'processing',v_service.price_kobo,p_request_reference,'{}'::jsonb,p_consent_confirmed_at)
 returning id into v_request_id;
 insert into public.audit_logs(actor_id,target_user_id,action,entity_type,entity_id,metadata)
 values(p_user_id,p_user_id,'identity_request_started','identity_request',v_request_id::text,jsonb_build_object('service_id',p_service_id,'reference',p_request_reference));
 return jsonb_build_object('request_id',v_request_id,'fee_kobo',v_service.price_kobo,'balance_after_kobo',v_new_balance);
end;
$$;

create or replace function public.topverify_finalize_request(
 p_request_id uuid, p_status text, p_provider_reference text default null,
 p_result_summary jsonb default '{}'::jsonb, p_error_code text default null
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_req public.identity_requests%rowtype; v_balance bigint; v_refund_ref text;
begin
 if p_status not in ('completed','failed') then raise exception 'INVALID_FINAL_STATUS'; end if;
 select * into v_req from public.identity_requests where id=p_request_id for update;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 if v_req.status <> 'processing' then return jsonb_build_object('status',v_req.status,'already_finalized',true); end if;
 if p_status='failed' and v_req.fee_kobo>0 then
   update public.wallets set balance_kobo=balance_kobo+v_req.fee_kobo,updated_at=now()
   where user_id=v_req.user_id returning balance_kobo into v_balance;
   v_refund_ref:=v_req.request_reference||'-REFUND';
   insert into public.wallet_ledger(user_id,entry_type,amount_kobo,balance_after_kobo,reference,description)
   values(v_req.user_id,'refund',v_req.fee_kobo,v_balance,v_refund_ref,'Refund for failed TopVerify request')
   on conflict(reference) do nothing;
 end if;
 update public.identity_requests set status=p_status,provider_reference=p_provider_reference,
 result_payload=coalesce(p_result_summary,'{}'::jsonb),error_code=p_error_code,
 error_message_safe=case when p_status='failed' then 'Provider could not complete this request. Any service fee has been refunded.' else null end,
 completed_at=now() where id=p_request_id;
 insert into public.audit_logs(actor_id,target_user_id,action,entity_type,entity_id,metadata)
 values(v_req.user_id,v_req.user_id,'identity_request_'||p_status,'identity_request',p_request_id::text,
 jsonb_build_object('service_id',v_req.service_id,'provider_reference',p_provider_reference));
 return jsonb_build_object('status',p_status,'balance_after_kobo',v_balance);
end;
$$;

revoke all on function public.topverify_reserve_request(uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.topverify_finalize_request(uuid,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.topverify_reserve_request(uuid,text,text,timestamptz) to service_role;
grant execute on function public.topverify_finalize_request(uuid,text,text,jsonb,text) to service_role;


-- Keep the SECURITY DEFINER admin-check outside PostgREST's exposed public schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path=public
as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_super_admin=true and p.status='approved')
$$;
revoke all on function private.is_super_admin() from public, anon;
grant execute on function private.is_super_admin() to authenticated;

drop policy if exists "profile read own or admin" on public.profiles;
create policy "profile read own or admin" on public.profiles for select to authenticated
using(id=auth.uid() or (select private.is_super_admin()));
drop policy if exists "profile update admin only" on public.profiles;
create policy "profile update admin only" on public.profiles for update to authenticated
using((select private.is_super_admin())) with check((select private.is_super_admin()));
drop policy if exists "services read enabled or admin" on public.services;
create policy "services read enabled or admin" on public.services for select to authenticated
using(enabled=true or (select private.is_super_admin()));
drop policy if exists "services admin all" on public.services;
create policy "services admin all" on public.services for all to authenticated
using((select private.is_super_admin())) with check((select private.is_super_admin()));
drop policy if exists "wallet read own or admin" on public.wallets;
create policy "wallet read own or admin" on public.wallets for select to authenticated
using(user_id=auth.uid() or (select private.is_super_admin()));
drop policy if exists "ledger read own or admin" on public.wallet_ledger;
create policy "ledger read own or admin" on public.wallet_ledger for select to authenticated
using(user_id=auth.uid() or (select private.is_super_admin()));
drop policy if exists "requests read own or admin" on public.identity_requests;
create policy "requests read own or admin" on public.identity_requests for select to authenticated
using(user_id=auth.uid() or (select private.is_super_admin()));
drop policy if exists "payment events admin read" on public.payment_events;
create policy "payment events admin read" on public.payment_events for select to authenticated
using((select private.is_super_admin()));
drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs for select to authenticated
using((select private.is_super_admin()));
drop function if exists public.is_super_admin();


-- Latest request-reservation signature records the purpose, without persisting submitted identity numbers.
drop function if exists public.topverify_reserve_request(uuid,text,text,timestamptz);
create or replace function public.topverify_reserve_request(
 p_user_id uuid,p_service_id text,p_request_reference text,p_consent_confirmed_at timestamptz,p_purpose text
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_profile public.profiles%rowtype; v_service public.services%rowtype; v_wallet public.wallets%rowtype;
 v_request_id uuid; v_new_balance bigint;
begin
 if p_purpose not in ('Customer onboarding / KYC with consent','Data subject requested their own record','Compliance verification with lawful basis') then raise exception 'INVALID_REQUEST_PURPOSE'; end if;
 select * into v_profile from public.profiles where id=p_user_id for update;
 if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
 if v_profile.status <> 'approved' then raise exception 'ACCOUNT_NOT_APPROVED'; end if;
 if v_profile.is_super_admin is false and v_profile.terms_accepted_at is null then raise exception 'TERMS_NOT_ACCEPTED'; end if;
 select * into v_service from public.services where id=p_service_id and enabled=true;
 if not found then raise exception 'SERVICE_UNAVAILABLE'; end if;
 if p_consent_confirmed_at is null then raise exception 'CONSENT_REQUIRED'; end if;
 select * into v_wallet from public.wallets where user_id=p_user_id for update;
 if not found then raise exception 'WALLET_NOT_FOUND'; end if;
 if v_wallet.balance_kobo < v_service.price_kobo then raise exception 'INSUFFICIENT_BALANCE'; end if;
 v_new_balance:=v_wallet.balance_kobo-v_service.price_kobo;
 update public.wallets set balance_kobo=v_new_balance,updated_at=now() where user_id=p_user_id;
 insert into public.wallet_ledger(user_id,entry_type,amount_kobo,balance_after_kobo,reference,description)
 values(p_user_id,'debit',v_service.price_kobo,v_new_balance,p_request_reference,'TopVerify '||v_service.name);
 insert into public.identity_requests(user_id,service_id,status,fee_kobo,request_reference,input_payload,consent_confirmed_at)
 values(p_user_id,p_service_id,'processing',v_service.price_kobo,p_request_reference,jsonb_build_object('purpose',p_purpose),p_consent_confirmed_at)
 returning id into v_request_id;
 insert into public.audit_logs(actor_id,target_user_id,action,entity_type,entity_id,metadata)
 values(p_user_id,p_user_id,'identity_request_started','identity_request',v_request_id::text,jsonb_build_object('service_id',p_service_id,'reference',p_request_reference,'purpose',p_purpose));
 return jsonb_build_object('request_id',v_request_id,'fee_kobo',v_service.price_kobo,'balance_after_kobo',v_new_balance);
end;
$$;
revoke all on function public.topverify_reserve_request(uuid,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.topverify_reserve_request(uuid,text,text,timestamptz,text) to service_role;


-- Treasury tables and restricted server-side treasury operations are maintained in the migration below.
-- TopVerify treasury foundation: separate company treasury from agent wallet liabilities.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table if not exists public.treasury_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  asset text not null check (asset in ('NGN','USDT')),
  network text not null check (network in ('NGN_BANK','BSC')),
  custody_class text not null check (custody_class in ('hot','cold')),
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(asset, network, custody_class),
  check ((asset='NGN' and network='NGN_BANK') or (asset='USDT' and network='BSC'))
);

create table if not exists public.treasury_deposits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.treasury_accounts(id),
  asset text not null check(asset in ('NGN','USDT')),
  network text not null check(network in ('NGN_BANK','BSC')),
  amount numeric(38,18) not null check(amount > 0),
  external_reference text not null,
  tx_hash text,
  status text not null check(status in ('pending_review','credited','rejected')),
  submitted_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  evidence_reference text,
  confirmations integer not null default 0 check(confirmations >= 0),
  block_number bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(network, external_reference),
  unique(network, tx_hash)
);

create table if not exists public.treasury_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.treasury_accounts(id),
  asset text not null check(asset in ('NGN','USDT')),
  direction text not null check(direction in ('credit','debit')),
  amount numeric(38,18) not null check(amount > 0),
  reference text not null unique,
  source_type text not null check(source_type in ('deposit','transfer','adjustment','provider_settlement')),
  source_id uuid,
  description text not null,
  created_by uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.treasury_transfers (
  id uuid primary key default gen_random_uuid(),
  source_account_id uuid not null references public.treasury_accounts(id),
  destination_account_id uuid not null references public.treasury_accounts(id),
  asset text not null check(asset in ('NGN','USDT')),
  amount numeric(38,18) not null check(amount > 0),
  status text not null check(status in ('pending_approval','approved_to_execute','rejected','executed','failed')),
  rationale text not null check(length(trim(rationale)) between 8 and 500),
  requested_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  external_reference text,
  execution_reference text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  executed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  check(source_account_id <> destination_account_id),
  check(approved_by is null or approved_by <> requested_by)
);

create index if not exists treasury_deposits_status_created_idx on public.treasury_deposits(status, created_at desc);
create index if not exists treasury_ledger_account_created_idx on public.treasury_ledger(account_id, created_at desc);
create index if not exists treasury_transfers_status_created_idx on public.treasury_transfers(status, created_at desc);

alter table public.treasury_accounts enable row level security;
alter table public.treasury_deposits enable row level security;
alter table public.treasury_ledger enable row level security;
alter table public.treasury_transfers enable row level security;
revoke all on public.treasury_accounts, public.treasury_deposits, public.treasury_ledger, public.treasury_transfers from public, anon, authenticated;
grant select, insert, update, delete on public.treasury_accounts, public.treasury_deposits, public.treasury_ledger, public.treasury_transfers to service_role;

insert into public.treasury_accounts(code,label,asset,network,custody_class)
values
 ('NGN_HOT','NGN Operating Treasury','NGN','NGN_BANK','hot'),
 ('NGN_COLD','NGN Reserve Treasury','NGN','NGN_BANK','cold'),
 ('USDT_BSC_HOT','USDT BSC Operating Wallet','USDT','BSC','hot'),
 ('USDT_BSC_COLD','USDT BSC Reserve Wallet','USDT','BSC','cold')
on conflict(code) do nothing;

create or replace function private.topverify_approve_ngn_deposit(p_deposit_id uuid,p_reviewer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare d public.treasury_deposits%rowtype; v_account public.treasury_accounts%rowtype;
begin
 if not exists(select 1 from public.profiles p where p.id=p_reviewer_id and p.is_super_admin and p.status='approved') then raise exception 'ADMIN_REQUIRED'; end if;
 select * into d from public.treasury_deposits where id=p_deposit_id for update;
 if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
 if d.asset <> 'NGN' or d.network <> 'NGN_BANK' then raise exception 'MANUAL_REVIEW_ONLY_FOR_NGN'; end if;
 if d.status <> 'pending_review' then return jsonb_build_object('status',d.status,'already_reviewed',true); end if;
 if d.submitted_by=p_reviewer_id then raise exception 'SECOND_REVIEWER_REQUIRED'; end if;
 if nullif(trim(coalesce(d.evidence_reference,'')),'') is null then raise exception 'EVIDENCE_REQUIRED'; end if;
 select * into v_account from public.treasury_accounts where id=d.account_id for update;
 insert into public.treasury_ledger(account_id,asset,direction,amount,reference,source_type,source_id,description,created_by,metadata)
 values(d.account_id,d.asset,'credit',d.amount,'treasury-deposit:'||d.id::text,'deposit',d.id,'Reviewed NGN treasury deposit',p_reviewer_id,jsonb_build_object('evidence_reference',d.evidence_reference))
 on conflict(reference) do nothing;
 update public.treasury_deposits set status='credited',reviewed_by=p_reviewer_id,reviewed_at=now() where id=d.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(p_reviewer_id,'treasury_ngn_deposit_credited','treasury_deposit',d.id::text,jsonb_build_object('amount',d.amount,'asset',d.asset,'evidence_reference',d.evidence_reference));
 return jsonb_build_object('status','credited','deposit_id',d.id);
end $$;

create or replace function private.topverify_record_bsc_usdt_deposit(
 p_account_id uuid,p_tx_hash text,p_amount numeric,p_confirmations integer,p_block_number bigint,p_actor_id uuid,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare a public.treasury_accounts%rowtype; d public.treasury_deposits%rowtype;
begin
 if not exists(select 1 from public.profiles p where p.id=p_actor_id and p.is_super_admin and p.status='approved') then raise exception 'ADMIN_REQUIRED'; end if;
 if p_tx_hash !~ '^0x[0-9a-fA-F]{64}$' or p_amount <= 0 or p_confirmations < 1 then raise exception 'INVALID_CHAIN_EVIDENCE'; end if;
 select * into a from public.treasury_accounts where id=p_account_id and code='USDT_BSC_HOT' and asset='USDT' and network='BSC' and custody_class='hot' and is_active for update;
 if not found then raise exception 'HOT_USDT_ACCOUNT_NOT_FOUND'; end if;
 select * into d from public.treasury_deposits where network='BSC' and lower(tx_hash)=lower(p_tx_hash);
 if found then return jsonb_build_object('status',d.status,'already_recorded',true,'deposit_id',d.id); end if;
 insert into public.treasury_deposits(account_id,asset,network,amount,external_reference,tx_hash,status,submitted_by,reviewed_by,confirmations,block_number,metadata,reviewed_at)
 values(a.id,'USDT','BSC',p_amount,lower(p_tx_hash),lower(p_tx_hash),'credited',p_actor_id,p_actor_id,p_confirmations,p_block_number,coalesce(p_metadata,'{}'::jsonb),now())
 returning * into d;
 insert into public.treasury_ledger(account_id,asset,direction,amount,reference,source_type,source_id,description,created_by,metadata)
 values(a.id,'USDT','credit',p_amount,'treasury-deposit:'||d.id::text,'deposit',d.id,'Verified BSC USDT transfer',p_actor_id,jsonb_build_object('tx_hash',lower(p_tx_hash),'confirmations',p_confirmations,'block_number',p_block_number))
 on conflict(reference) do nothing;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(p_actor_id,'treasury_bsc_usdt_deposit_credited','treasury_deposit',d.id::text,jsonb_build_object('tx_hash',lower(p_tx_hash),'amount',p_amount,'confirmations',p_confirmations,'block_number',p_block_number));
 return jsonb_build_object('status','credited','deposit_id',d.id,'amount',p_amount);
end $$;

create or replace function private.topverify_request_treasury_transfer(
 p_source_account_id uuid,p_destination_account_id uuid,p_amount numeric,p_rationale text,p_requester_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare s public.treasury_accounts%rowtype; d public.treasury_accounts%rowtype; t public.treasury_transfers%rowtype;
begin
 if not exists(select 1 from public.profiles p where p.id=p_requester_id and p.is_super_admin and p.status='approved') then raise exception 'ADMIN_REQUIRED'; end if;
 if p_amount <= 0 or length(trim(coalesce(p_rationale,''))) < 8 or length(trim(p_rationale)) > 500 then raise exception 'INVALID_TRANSFER_DETAILS'; end if;
 select * into s from public.treasury_accounts where id=p_source_account_id and is_active for update;
 select * into d from public.treasury_accounts where id=p_destination_account_id and is_active for update;
 if s.id is null or d.id is null then raise exception 'TREASURY_ACCOUNT_NOT_FOUND'; end if;
 if s.id=d.id or s.asset<>d.asset or s.network<>d.network then raise exception 'INCOMPATIBLE_TREASURY_ACCOUNTS'; end if;
 insert into public.treasury_transfers(source_account_id,destination_account_id,asset,amount,status,rationale,requested_by)
 values(s.id,d.id,s.asset,p_amount,'pending_approval',trim(p_rationale),p_requester_id) returning * into t;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(p_requester_id,'treasury_transfer_requested','treasury_transfer',t.id::text,jsonb_build_object('source',s.code,'destination',d.code,'asset',s.asset,'amount',p_amount));
 return jsonb_build_object('id',t.id,'status',t.status);
end $$;

create or replace function private.topverify_approve_treasury_transfer(p_transfer_id uuid,p_approver_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare t public.treasury_transfers%rowtype;
begin
 if not exists(select 1 from public.profiles p where p.id=p_approver_id and p.is_super_admin and p.status='approved') then raise exception 'ADMIN_REQUIRED'; end if;
 select * into t from public.treasury_transfers where id=p_transfer_id for update;
 if not found then raise exception 'TRANSFER_NOT_FOUND'; end if;
 if t.status <> 'pending_approval' then return jsonb_build_object('status',t.status,'already_reviewed',true); end if;
 if t.requested_by=p_approver_id then raise exception 'SECOND_APPROVER_REQUIRED'; end if;
 update public.treasury_transfers set status='approved_to_execute',approved_by=p_approver_id,approved_at=now() where id=t.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(p_approver_id,'treasury_transfer_approved_to_execute','treasury_transfer',t.id::text,jsonb_build_object('asset',t.asset,'amount',t.amount,'source_account_id',t.source_account_id,'destination_account_id',t.destination_account_id));
 return jsonb_build_object('status','approved_to_execute','id',t.id,'note','External custody execution is not configured.');
end $$;

revoke all on function private.topverify_approve_ngn_deposit(uuid,uuid) from public,anon,authenticated;
revoke all on function private.topverify_record_bsc_usdt_deposit(uuid,text,numeric,integer,bigint,uuid,jsonb) from public,anon,authenticated;
revoke all on function private.topverify_request_treasury_transfer(uuid,uuid,numeric,text,uuid) from public,anon,authenticated;
revoke all on function private.topverify_approve_treasury_transfer(uuid,uuid) from public,anon,authenticated;
grant execute on function private.topverify_approve_ngn_deposit(uuid,uuid) to service_role;
grant execute on function private.topverify_record_bsc_usdt_deposit(uuid,text,numeric,integer,bigint,uuid,jsonb) to service_role;
grant execute on function private.topverify_request_treasury_transfer(uuid,uuid,numeric,text,uuid) to service_role;
grant execute on function private.topverify_approve_treasury_transfer(uuid,uuid) to service_role;


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



-- Explicit deny policies document the intended service-role-only treasury data plane.
drop policy if exists "treasury accounts server only" on public.treasury_accounts;
create policy "treasury accounts server only" on public.treasury_accounts for all to anon, authenticated using (false) with check (false);
drop policy if exists "treasury deposits server only" on public.treasury_deposits;
create policy "treasury deposits server only" on public.treasury_deposits for all to anon, authenticated using (false) with check (false);
drop policy if exists "treasury ledger server only" on public.treasury_ledger;
create policy "treasury ledger server only" on public.treasury_ledger for all to anon, authenticated using (false) with check (false);
drop policy if exists "treasury transfers server only" on public.treasury_transfers;
create policy "treasury transfers server only" on public.treasury_transfers for all to anon, authenticated using (false) with check (false);


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


-- Flutterwave wallet top-ups (active wallet funding path).
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

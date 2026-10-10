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

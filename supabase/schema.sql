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

-- Upstream (NINSlip) cost per service and per-request cost snapshots.
-- Both tables are admin/service-role only so customers can never read your costs.

create table if not exists public.service_costs (
  service_id text primary key references public.services(id) on delete cascade,
  cost_kobo bigint not null default 0 check (cost_kobo >= 0),
  updated_at timestamptz not null default now()
);
alter table public.service_costs enable row level security;
drop policy if exists service_costs_deny_browser_access on public.service_costs;
create policy service_costs_deny_browser_access on public.service_costs
  for all to anon, authenticated using (false) with check (false);
revoke all on table public.service_costs from public, anon, authenticated;
grant all on table public.service_costs to service_role;

insert into public.service_costs(service_id, cost_kobo)
select id, 0 from public.services
on conflict (service_id) do nothing;

-- NINSlip price list (naira x 100). Services not on the list stay at 0 until you set them.
update public.service_costs set cost_kobo = v.cost, updated_at = now()
from (values
  ('nin-lookup', 12000), ('nin-image-report', 12000), ('phone-lookup', 12000), ('bvn-verify', 12000),
  ('tracking-id-lookup', 16000), ('ipe-clearance', 50000), ('nin-validation', 150000)
) as v(id, cost)
where service_costs.service_id = v.id and service_costs.cost_kobo = 0;

create table if not exists public.request_costs (
  request_id uuid primary key references public.identity_requests(id) on delete cascade,
  cost_kobo bigint not null default 0 check (cost_kobo >= 0)
);
alter table public.request_costs enable row level security;
drop policy if exists request_costs_deny_browser_access on public.request_costs;
create policy request_costs_deny_browser_access on public.request_costs
  for all to anon, authenticated using (false) with check (false);
revoke all on table public.request_costs from public, anon, authenticated;
grant all on table public.request_costs to service_role;

create or replace function public.topverify_snapshot_request_cost()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.request_costs(request_id, cost_kobo)
  values (new.id, coalesce((select cost_kobo from public.service_costs where service_id = new.service_id), 0))
  on conflict (request_id) do nothing;
  return new;
end;
$$;
drop trigger if exists topverify_snapshot_request_cost on public.identity_requests;
create trigger topverify_snapshot_request_cost after insert on public.identity_requests
  for each row execute function public.topverify_snapshot_request_cost();

insert into public.request_costs(request_id, cost_kobo)
select r.id, coalesce(c.cost_kobo, 0)
from public.identity_requests r left join public.service_costs c on c.service_id = r.service_id
on conflict (request_id) do nothing;

-- Dashboard statistics now include real profit (fee minus the cost recorded when the request was made).
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
    'cost_month_kobo', (select coalesce(sum(rc.cost_kobo), 0) from public.identity_requests r
                        join public.request_costs rc on rc.request_id = r.id
                        where r.status in ('completed', 'processing') and r.created_at >= date_trunc('month', now())),
    'cost_total_kobo', (select coalesce(sum(rc.cost_kobo), 0) from public.identity_requests r
                        join public.request_costs rc on rc.request_id = r.id
                        where r.status in ('completed', 'processing')),
    'loss_requests', (select count(*) from public.identity_requests r
                      join public.request_costs rc on rc.request_id = r.id
                      where r.status in ('completed', 'processing') and rc.cost_kobo > r.fee_kobo),
    'loss_total_kobo', (select coalesce(sum(rc.cost_kobo - r.fee_kobo), 0) from public.identity_requests r
                        join public.request_costs rc on rc.request_id = r.id
                        where r.status in ('completed', 'processing') and rc.cost_kobo > r.fee_kobo),
    'requests', (select jsonb_build_object(
        'total', count(*),
        'today', count(*) filter (where created_at >= date_trunc('day', now())),
        'processing', count(*) filter (where status = 'processing'),
        'completed', count(*) filter (where status = 'completed'),
        'failed', count(*) filter (where status in ('failed', 'refunded'))) from public.identity_requests),
    'pending_topups', (select count(*) from public.wallet_topups where status = 'pending'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'requests', coalesce(c.n, 0),
                     'revenue_kobo', coalesce(c.rev, 0), 'profit_kobo', coalesce(c.rev, 0) - coalesce(c.cost, 0)) order by d), '[]'::jsonb)
              from generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') d
              left join (select date_trunc('day', r.created_at) as day, count(*) as n,
                                coalesce(sum(r.fee_kobo) filter (where r.status in ('completed', 'processing')), 0) as rev,
                                coalesce(sum(rc.cost_kobo) filter (where r.status in ('completed', 'processing')), 0) as cost
                         from public.identity_requests r left join public.request_costs rc on rc.request_id = r.id
                         where r.created_at >= date_trunc('day', now()) - interval '6 days' group by 1) c on c.day = d)
  );
$$;
revoke all on function public.topverify_admin_stats() from public, anon, authenticated;
grant execute on function public.topverify_admin_stats() to service_role;

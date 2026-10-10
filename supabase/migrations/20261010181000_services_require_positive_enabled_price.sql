do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'services_enabled_price_positive'
      and conrelid = 'public.services'::regclass
  ) then
    alter table public.services
      add constraint services_enabled_price_positive
      check (enabled = false or price_kobo > 0);
  end if;
end $$;

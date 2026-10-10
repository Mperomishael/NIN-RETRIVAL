-- Explicit deny policies document the intended service-role-only treasury data plane.
drop policy if exists "treasury accounts server only" on public.treasury_accounts;
create policy "treasury accounts server only" on public.treasury_accounts for all to anon, authenticated using (false) with check (false);
drop policy if exists "treasury deposits server only" on public.treasury_deposits;
create policy "treasury deposits server only" on public.treasury_deposits for all to anon, authenticated using (false) with check (false);
drop policy if exists "treasury ledger server only" on public.treasury_ledger;
create policy "treasury ledger server only" on public.treasury_ledger for all to anon, authenticated using (false) with check (false);
drop policy if exists "treasury transfers server only" on public.treasury_transfers;
create policy "treasury transfers server only" on public.treasury_transfers for all to anon, authenticated using (false) with check (false);

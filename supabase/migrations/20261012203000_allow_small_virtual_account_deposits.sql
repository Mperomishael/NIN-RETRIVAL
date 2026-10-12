-- Permanent bank accounts can receive arbitrary positive transfer amounts.
-- Hosted checkout keeps its own ₦500 minimum; virtual-account deposits must not be stranded.
alter table public.wallet_topups drop constraint if exists wallet_topups_amount_kobo_check;
alter table public.wallet_topups add constraint wallet_topups_amount_kobo_check check (amount_kobo > 0);

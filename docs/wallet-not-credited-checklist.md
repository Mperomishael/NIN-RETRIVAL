# Wallet paid but not credited — checklist

The code now recovers missed payments automatically (wallet page open, return from checkout, "check status" button, daily cron). If a payment is still not credited, work through this list in order.

1. **Run the migration** `supabase/migrations/20261014090000_sync_wallet_payment_schema.sql` in the Supabase SQL editor (safe to run more than once).
2. **Flutterwave dashboard → Settings → Webhooks**
   - URL: `https://YOUR_DOMAIN/api/payments/flutterwave/webhook` (must be the live HTTPS domain, never localhost).
   - Secret hash must equal `FLUTTERWAVE_WEBHOOK_SECRET_HASH` in Vercel, character for character.
   - Live and test mode have separate webhook settings and separate keys.
3. **Vercel environment variables** (then redeploy): `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_SECRET_HASH`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`.
4. **Read the Vercel runtime logs** and search for `[TopVerify`. The messages say exactly why a payment was not credited, e.g.
   - `Ignored unmatched transaction` → the transfer could not be tied to a TopVerify account (send the logged txRef/transactionId to support).
   - `Wallet credit RPC failed` / `Could not create funding record` → a database problem; the logged reason names it.
   - `Invalid webhook signature` (HTTP 401 in Flutterwave's webhook log) → secret hash mismatch.
5. **Manual recovery for one user**: have them open *My wallet* and tap **I've paid — check status**.

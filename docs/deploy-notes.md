# Deploy notes

1. `npm install` (adds `jspdf` for automatic PDF downloads).
2. Run these migrations in the Supabase SQL editor, in order:
   - `20261014090000_sync_wallet_payment_schema.sql`
   - `20261014120000_admin_control_and_auto_approval.sql` (also approves users who already have a verified deposit account)
3. Optional: set `NEXT_PUBLIC_SUPPORT_EMAIL` in Vercel to show a support link. The link is hidden when it is not set.
4. Required server variables: `SUPABASE_SERVICE_ROLE_KEY`, `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_SECRET_HASH`.

Registration (`/api/auth/register`) creates a confirmed account, verifies the NIN with Flutterwave, and approves the account in one step. If the NIN is rejected, no account is created.

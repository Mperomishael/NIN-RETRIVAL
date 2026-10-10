# TopVerify setup notes

## Required environment variables

Configure these in Vercel Project Settings → Environment Variables for Production and Preview as appropriate:

- `NEXT_PUBLIC_SUPABASE_URL`: the TopVerify Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase secret used by trusted billing/request code. Never prefix it with `NEXT_PUBLIC_`, expose it in a browser, or commit it to GitHub.
- `NINSLIP_API_KEY`: the authorized NINSlip Bearer API token. Never expose it to the browser.
- `BSC_RPC_URL`: trusted BNB Smart Chain mainnet RPC endpoint (optional; defaults to the public BNB Chain endpoint).
- `BSC_USDT_TOKEN_ADDRESS`: the independently verified BEP-20 token contract address for the USDT asset you accept. Do not use a token address based only on its displayed symbol.
- `BSC_USDT_HOT_ADDRESS`: the receiving address for the TopVerify USDT BSC hot wallet. The private key must remain in a separate custody/signing system, never in this app.
- `BSC_USDT_COLD_ADDRESS`: optional cold reserve address shown in the admin console; deposits are not scanned there by the initial hot-wallet workflow.
- `BSC_USDT_MIN_CONFIRMATIONS`: required block confirmations; default is 15.

After changing variables, redeploy the project.

## Initial administrator bootstrap

1. Create your owner account through TopVerify signup and confirm the email if Supabase email confirmation is enabled.
2. In Supabase SQL Editor, run this query after replacing the email with the exact email used for that owner account:

```sql
update public.profiles p
set is_super_admin = true,
    status = 'approved',
    authorization_reviewed_at = now(),
    updated_at = now()
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('OWNER_EMAIL_HERE');
```

3. Sign out and sign back in. The owner account should then show Agent oversight and Service pricing.

Do not put administrator privileges in the public signup form. For dual-control operations, provision a second, separately controlled administrator only after verifying their identity and enabling MFA. Run this in Supabase SQL Editor with their exact registered email:

```sql
update public.profiles p
set is_super_admin = true,
    status = 'approved',
    authorization_reviewed_at = now(),
    updated_at = now()
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('SECOND_ADMIN_EMAIL_HERE');
```

Keep this account separate from the treasury requester account. Never share administrator credentials.

## NINSlip integration

The server route uses the API key from `NINSLIP_API_KEY` and calls `https://api.ninslip.com` directly. Currently exposed live request types are:

- NIN verification
- NIN phone lookup
- BVN verification
- Demographic match
- NIN PDF slip
- BVN PDF slip

Validation, IPE clearance and modification services are intentionally hidden until their account permissions, legal authorization, pricing, and provider response/settlement behavior are confirmed.

## Wallet and billing

New agents receive a dedicated zero-balance wallet. Each live request uses a server-side database function to check approval and available balance, debit the configured TopVerify retail fee, create a ledger row and record the request. Provider failures recorded by the route trigger a refund entry. Ambiguous timeouts should be reconciled against the provider dashboard before retrying.

Payment-gateway funding is not yet wired. Do not manually credit users from browser code; implement and verify a signed payment webhook before enabling wallet top-ups.

## KYC and privacy

The current signup stores basic agent onboarding details (name, phone, business, address, intended use, terms version and timestamp) in the profile. It does not currently collect or store an agent's government ID document. Collect additional KYC evidence only if required for your business/provider onboarding, with a documented lawful basis, clear privacy notice, restricted access, retention rules and secure storage.

Identity responses are returned to the approved requesting agent but are not stored as full identity records in the request history. The request record stores service, price, reference, status and a minimal result summary. Never use test credentials to query real people's identities.

## Super-admin treasury console

Open `/admin/treasury` while signed in as an approved super-admin. The API independently verifies the authenticated user against `public.profiles` on every request. Treasury tables have RLS enabled and no direct privileges for browser roles; server-only service-role endpoints perform the controlled writes.

The migration creates separate company treasury accounts for NGN hot/cold and USDT on BSC hot/cold. These are **company treasury ledgers**, separate from agent balances in `public.wallets` and `public.wallet_ledger`. The balance shown is computed from recorded ledger entries and is not a live bank or chain balance.

### BSC USDT deposits

The admin console can verify a submitted transaction hash against BSC mainnet, check successful receipt status, configured token contract, a BEP-20 `Transfer` log to the configured hot-wallet address, and the configured confirmation threshold. A unique transaction hash and atomic database function prevent duplicate ledger credits. Configure and independently verify `BSC_USDT_TOKEN_ADDRESS` and `BSC_USDT_HOT_ADDRESS` before testing with a small amount. Deposits to the cold wallet are not scanned by this initial hot-deposit workflow.

### NGN treasury deposits

Recording a bank/provider deposit creates a pending record only. It does not credit the ledger. A different approved super-admin must review the reference against the bank/provider statement and then approve the credit. Do not treat an uploaded or typed evidence reference by itself as proof of settlement.

### Transfers and custody

Transfer requests require a second, distinct approved super-admin. Pending and approved proposals reserve the requested amount against the source account's ledger balance to prevent over-proposing funds. Approval changes the request to `approved_to_execute`; it **does not** broadcast a blockchain transaction, instruct a bank, or create a transfer ledger movement. An external custody/signing provider and bank execution/reconciliation integration are still required. Cold-wallet keys must remain offline or in a dedicated custody system; never place private keys in Supabase tables, browser code, GitHub, or ordinary Vercel environment variables.

Do not enable production funding or move material funds until token identity, destination addresses, RPC reliability, bank evidence procedures, custody controls, reconciliation, limits and incident response have been tested.

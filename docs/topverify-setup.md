# TopVerify setup notes

## Required environment variables

Configure these in Vercel Project Settings → Environment Variables for Production and Preview as appropriate:

- `NEXT_PUBLIC_SUPABASE_URL`: the TopVerify Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase secret used by trusted billing/request code. Never prefix it with `NEXT_PUBLIC_`, expose it in a browser, or commit it to GitHub.
- `NINSLIP_API_KEY`: the authorized NINSlip Bearer API token. Never expose it to the browser.
- `NEXT_PUBLIC_SITE_URL`: canonical HTTPS origin for the TopVerify site, used for the Flutterwave return URL.
- `FLUTTERWAVE_SECRET_KEY`: server-only Flutterwave secret key used to create checkout links and verify transactions. Never expose it to browser code.
- `FLUTTERWAVE_WEBHOOK_SECRET_HASH`: the secret hash configured in the Flutterwave dashboard for the v3 webhook endpoint. Keep it private and identical on both sides.

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

Keep administrator accounts separately controlled, enable MFA, and never share administrator credentials.

## NINSlip integration

The server route uses the API key from `NINSLIP_API_KEY` and calls `https://api.ninslip.com` directly. The service catalogue and retail fees are read from Supabase. The UI supports NIN verification, phone-based NIN lookup, tracking-ID verification, BVN verification, demographic match, NIN/BVN/phone-based PDF slips, NIN validation submission, IPE clearance submission and NIN modification submission. Phone-slip generation and tracking-ID verification are seeded as disabled services at zero price until a super-admin sets a positive retail fee and enables them under Service pricing.

The NINSlip documentation describes validation, IPE clearance and modification as accepted asynchronous requests. TopVerify leaves these requests in `processing` after provider acceptance and displays the provider reference; it does not yet poll the provider's status endpoints automatically. Confirm the NINSlip account has permission for each endpoint and verify its current pricing/response behavior in a test account before enabling production use. Only submit identity or modification requests with appropriate authorization and consent.

## Wallet funding and Flutterwave

Each signup automatically creates a zero-balance NGN wallet for that TopVerify user. The My wallet page starts a Flutterwave hosted checkout for amounts from ₦500 to ₦1,000,000. The server creates a unique pending top-up reference; the customer never supplies a wallet user ID or transaction reference.

Set `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_SECRET_HASH`, and `NEXT_PUBLIC_SITE_URL` in Vercel. In Flutterwave's v3 dashboard, configure the webhook URL as `https://YOUR_DOMAIN/api/payments/flutterwave/webhook` and set its secret hash to the same value as `FLUTTERWAVE_WEBHOOK_SECRET_HASH`. The webhook uses the v3 `verif-hash` header. Configure the live webhook separately from the test webhook.

Before crediting a wallet, the server re-queries Flutterwave's transaction verification API and checks transaction ID, unique reference, successful status, exact NGN amount and currency. The database function locks the pending top-up and wallet, writes a unique wallet-ledger credit, records a payment event and audit entry, and marks the top-up credited in one transaction. Duplicate webhook or callback delivery cannot credit the same top-up twice. The browser cannot write to top-up records.

All collections settle to the merchant's configured Flutterwave settlement account by default; there is no automatic split or separate "profit wallet" in this implementation. Customer wallet balances are liabilities tracked in TopVerify's ledger. NINSlip provider costs are still funded by the business owner separately, and customer service fees are charged from their TopVerify wallet when they request a service.

This flow uses hosted checkout; it does not create a permanent personal bank account number for each user. Flutterwave static virtual accounts have additional customer-identity and eligibility requirements and should be treated as a separate feature. Never manually credit users from browser code. Test successful, failed, mismatched, duplicate and delayed webhook scenarios in test mode before enabling live payments.

## KYC and privacy

The current signup stores basic agent onboarding details (name, phone, business, address, intended use, terms version and timestamp) in the profile. It does not currently collect or store an agent's government ID document. Collect additional KYC evidence only if required for your business/provider onboarding, with a documented lawful basis, clear privacy notice, restricted access, retention rules and secure storage.

Identity responses are returned to the approved requesting agent but are not stored as full identity records in the request history. The request record stores service, price, reference, status and a minimal result summary. Never use test credentials to query real people's identities.

## Retired treasury console

The previous hot/cold NGN and USDT treasury console is retired from the active product. The old treasury tables and migrations remain in the database for historical auditability; they are not part of the current customer wallet funding path. The current flow is Flutterwave merchant collections → verified top-up → individual TopVerify wallet ledger → service debit. The application does not automatically transfer NINSlip costs or profits between accounts.

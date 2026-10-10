# TopVerify setup notes

## Required environment variables

Configure these in Vercel Project Settings → Environment Variables for Production and Preview as appropriate:

- `NEXT_PUBLIC_SUPABASE_URL`: the TopVerify Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase secret used by trusted billing/request code. Never prefix it with `NEXT_PUBLIC_`, expose it in a browser, or commit it to GitHub.
- `NINSLIP_API_KEY`: the authorized NINSlip Bearer API token. Never expose it to the browser.

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

Do not put administrator privileges in the public signup form.

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

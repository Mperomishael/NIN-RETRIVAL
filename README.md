# TopVerify

A mobile-first identity-services workspace for approved agents, with Supabase authentication, agent onboarding/KYC metadata, dedicated NGN wallets, retail service pricing, request history and a server-side NINSlip adapter.

## Run locally

Requirements: Node.js 20.9+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Configure all environment variables in `.env.local` for local development. Never commit real provider or service-role secrets.

## Supabase

The live Supabase project is configured through `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The schema and secure billing functions are in `supabase/schema.sql`; the current project has also received the TopVerify onboarding/billing migration.

- New accounts receive a pending profile and an individual zero-balance wallet.
- KYC/onboarding metadata is stored in `public.profiles`.
- Wallet balances and service history are read under row-level security.
- Server-only database functions reserve service fees and finalize request outcomes.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.

See [docs/topverify-setup.md](docs/topverify-setup.md) for environment variables and the initial owner-admin bootstrap procedure.

## NINSlip integration

The server route at `app/api/identity/route.ts` uses `NINSLIP_API_KEY` as a Bearer token. Currently exposed service types are NIN verification, phone-based NIN lookup, BVN verification, demographic matching, and NIN/BVN PDF slip generation. It does not store full identity responses in request history; it records only request metadata and a minimal summary.

Before enabling production access, confirm the upstream account's permissions, price list, intended customer-facing use and legal basis for each endpoint. Validation, IPE clearance and modification services are intentionally not exposed by the current UI.

## Wallet funding and merchant settlement

Each registered TopVerify user automatically receives an individual NGN wallet in the application database. Flutterwave hosted checkout is used to collect wallet top-ups; the server verifies the transaction and reconciles it idempotently before adding a credit to that user's wallet ledger. Collections settle to the merchant's configured Flutterwave settlement account. The customer wallet is an internal balance/liability, not a separate bank account. NINSlip remains the upstream identity provider and must be funded separately by the business owner.

The previous hot/cold treasury console has been retired from the active application. Existing treasury database tables and historical records are retained, not deleted. See [the setup guide](docs/topverify-setup.md) for Flutterwave environment variables and webhook setup.

## Production checklist

- Set Vercel environment variables, including server-only `SUPABASE_SERVICE_ROLE_KEY` and `NINSLIP_API_KEY`.
- Create the owner account, then bootstrap it as the first administrator using the SQL in the setup guide.
- Configure Supabase email confirmation and production redirect URLs.
- Configure Flutterwave keys and the signed webhook, then test the checkout, transaction verification, duplicate webhook and ledger reconciliation in test mode before enabling live wallet funding.
- Add request rate limiting, abuse monitoring, data retention and deletion procedures, and provider reconciliation for ambiguous timeouts.
- Review applicable NIMC/provider authorization and Nigeria Data Protection Act obligations before launch.

Do not use the platform to access identity information without a lawful purpose and the data subject's authorization. Do not use test credentials to query real people.

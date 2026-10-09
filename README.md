# Empire Identity Hub

Responsive Next.js dashboard starter for identity-service agents and super-admins. Includes service-specific request forms, pricing and wallet UI previews, Supabase starter schema, and setup notes.

## Run locally

Requirements: Node.js 20.9+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Without Supabase credentials, the UI is in demo mode. It does not call NINSLIP or move real money.

## Supabase setup

1. Create a Supabase project and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`.
2. Review and run `supabase/schema.sql` in the Supabase SQL Editor.
3. Configure Auth email confirmation and password-reset URLs.
4. Create your first account, verify its UUID, then manually approve it as the first super admin in SQL. Never expose admin privilege assignment in a public signup form.

## Production checklist

- Implement server-side Supabase sessions, auth flows, protected admin actions, and authorization checks.
- Connect only to an authorized NINSLIP/provider API using server-only credentials and the provider's current docs.
- Add payment checkout and signature-verified, idempotent webhook processing; wallet credit/debit must be atomic and server-side.
- Add rate limits, request idempotency, audit logs, data minimization, retention controls, and error monitoring.
- Replace mock UI data with database-backed records. The role switch is only a UI preview, not a security boundary.

Do not deploy as a live identity or payment service until authorization, provider access, data handling, and payment reconciliation are implemented and tested.
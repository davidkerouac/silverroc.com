# Silverroc

从前有座山 / Temple on the Hill MVP.

## What Is Included

- Next.js wrapper around the original visual prototype.
- Supabase Auth for email/password accounts.
- Supabase tables for profiles, memberships, and Antom payment records.
- Antom checkout creation and payment notification handling.
- 30-day membership grant after a successful Antom notification.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev -- --port 4190
```

Fill `.env.local` before testing auth or payment:

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:4190
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

ANTOM_ENV=sandbox
ANTOM_GATEWAY_URL=https://open-sea-global.alipay.com
ANTOM_CLIENT_ID=
ANTOM_MERCHANT_ID=
ANTOM_PRIVATE_KEY_FILE=
ANTOM_PUBLIC_KEY=
ANTOM_DEFAULT_CURRENCY=CNY
ANTOM_MONTHLY_PRICE_MINOR=990
ANTOM_PAYMENT_METHODS=ALIPAY
```

## Supabase

Run [supabase/schema.sql](./supabase/schema.sql) in the Supabase SQL editor.

The app uses Supabase Auth users as the source of identity. Membership and payment
tables are written from Next.js API routes with the service role key.

## Antom

The MVP uses one-time checkout for a 30-day membership. It is not recurring billing yet.

Required callback URL in Antom:

```text
https://silverroc.com/api/payments/antom/notify
```

Required return URL:

```text
https://silverroc.com/?payment=return
```

## Verification

```bash
npm run typecheck
npm run build
curl http://localhost:4190/api/health
```

Unauthenticated `/api/membership` should return `401`. After login it should return
the server-side membership state.

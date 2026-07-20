# Dodo Payments And Conversion Quotas

PodToClips uses Dodo Payments as its Merchant of Record and keeps its own
server-side entitlement ledger. The browser never decides whether a conversion
may start.

## Plans

| Plan | Price | Podcast conversions | Reset |
| --- | ---: | ---: | --- |
| Free | $0 | 1 | Never; lifetime allowance |
| Creator | $5.99/month | 5 | Verified subscription billing period |
| Growth | $14.99/month | 12 | Verified subscription billing period |
| Studio | $24.99/month | 24 | Verified subscription billing period |

Each accepted podcast conversion can produce up to eight ranked clips. Clip
count is descriptive; the enforced billing unit is an accepted podcast
conversion.

## Strict enforcement model

- Every file upload, direct upload completion, and URL import calls the same
  server-side quota claim.
- The production claim is a conditional PostgreSQL `UPDATE`, so concurrent
  requests cannot consume the same remaining allowance.
- The Free counter is lifetime and is never reset by a paid subscription.
- Paid counters reset only when a verified Dodo webhook advances the billing
  period or creates a new subscription.
- Inactive, on-hold, failed, cancelled, and expired subscriptions cannot start
  conversions.
- Production fails closed if PostgreSQL is unavailable. The local JSON adapter
  is development-only.
- UI gates explain the limit but are not security controls.
- Checkout redirects never grant access. Only a signed webhook can change an
  entitlement.

## Server configuration

```text
DODO_PAYMENTS_API_KEY=
DODO_PAYMENTS_WEBHOOK_KEY=
DODO_PAYMENTS_ENVIRONMENT=test_mode
DODO_CREATOR_PRODUCT_ID=
DODO_GROWTH_PRODUCT_ID=
DODO_STUDIO_PRODUCT_ID=
PUBLIC_APP_URL=https://your-app.example
DATABASE_URL=
```

The API key and webhook key must be stored only in the backend environment or
Google Secret Manager. They must never use the `VITE_` prefix or be exposed to
the browser.

## Checkout and portal

1. An authenticated customer selects Creator, Growth, or Studio.
2. `POST /api/billing/checkout` resolves the product ID on the server and
   creates a hosted Dodo checkout session.
3. Checkout metadata contains the immutable Clerk user ID.
4. The return URL sends the customer to Settings, but does not unlock access.
5. `POST /api/billing/portal` creates a short-lived hosted customer portal link
   for an existing Dodo customer.

## Webhooks

Configure this public endpoint in Dodo:

```text
https://<api-domain>/api/billing/dodo/webhook
```

The route receives the untouched request body before Express JSON parsing and
verifies `webhook-id`, `webhook-signature`, and `webhook-timestamp` with the
official Dodo SDK. Webhook IDs are persisted for replay protection.

Handled events:

- `subscription.active`
- `subscription.updated`
- `subscription.on_hold`
- `subscription.renewed`
- `subscription.plan_changed`
- `subscription.cancelled`
- `subscription.failed`
- `subscription.expired`

## Activation checklist

1. Rotate any API key that has been pasted into chat or logs.
2. Add the replacement API key directly to the backend secret store.
3. Deploy the webhook endpoint.
4. Create the webhook in the matching Dodo test or live environment and store
   its signing key as `DODO_PAYMENTS_WEBHOOK_KEY`.
5. Run `npm run db:migrate` before serving the new backend.
6. Complete a test checkout and confirm the signed subscription event changes
   the Clerk account entitlement.
7. Attempt concurrent requests at each limit and confirm only the remaining
   number are accepted.

References:

- https://docs.dodopayments.com/developer-resources/checkout-session
- https://docs.dodopayments.com/developer-resources/webhooks
- https://docs.dodopayments.com/developer-resources/webhooks/intents/subscription
- https://docs.dodopayments.com/features/customer-portal

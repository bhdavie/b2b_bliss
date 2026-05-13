# Bliss B2B

Save-first payment plan platform for the booking economy. Distributed through merchants, consumer-branded for end users.

## What this is

Bliss B2B lets merchants in the booking and reservation economy (photographers, boutique hotels, retreats, events, salons, med-spas) offer their customers a way to commit to a future booking and pay for it over time from their own debit card, with no credit, no interest, and no underwriting risk to the merchant.

The customer commits the full price upfront, sets a payment schedule, and Bliss handles the scheduled card charges. On the final payment, the merchant gets paid in full and the booking is confirmed. If the customer cancels mid-plan, the merchant's cancellation policy applies and refunds happen via standard card refund mechanics.

This is structurally different from BNPL. There is no credit extended, no debt taken on, no underwriting capital required, no balance sheet exposure. The customer is committing their own money over time toward a specific dated transaction.

## Why this exists

Festival Pay proved the behavior at scale in event ticketing. The merchants who currently lose high-ticket bookings to "we can't afford it right now" don't have a clean way to convert that intent into a committed plan. BNPL (Affirm, Klarna) extends credit and serves a different consumer. Existing merchant CRM payment plans (Honeybook 3-pay, Studio Ninja, Pixifi) are crude and vertical-locked. The space for a horizontal, consumer-branded, save-first payment plan rail across the booking economy is open.

## Target ICP

**Merchant ICP for v1:** Independent operators and small businesses with high-ticket dated services. Wedding photographers ($2-8K packages), boutique resorts and destination hotels (deposit-and-balance bookings), retreat operators (yoga, wellness, photography workshops at $1-4K), wedding venues.

**Consumer ICP:** Gen Z women and millennial women, cash-flow-constrained but credit-disciplined, making high-ticket booking commitments for life moments. Debit-native, BNPL-cautious.

## Stack

- Backend: Java + Dropwizard
- Frontend: Next.js + TypeScript (App Router)
- Database: PostgreSQL
- Payments: Stripe end-to-end. Stripe Elements for card capture, Stripe Customer + Payment Methods for vaulting, Stripe PaymentIntents off-session for scheduled charges, Stripe Connect Express for merchant onboarding, KYB, and ACH payouts. No other processor.
- Email: Postmark
- SMS: Twilio
- Hosting: Vercel for frontend, AWS or Fly.io for backend
- Domains: app.bliss.com (merchant dashboard), pay.bliss.com (hosted consumer checkout)
- Form factor: responsive web app, desktop and mobile browser. No native mobile app.

The Stripe-everywhere choice is deliberate for v1 simplicity. Architecturally, keep payment integration concerns isolated in a `payments/` package so a future processor swap is a contained rewrite, not a system-wide one.

## Architecture

Three surfaces:

1. **Hosted consumer surface** at pay.bliss.com. The polished payment plan page customers land on when they click a merchant's Bliss link. This is the consumer brand surface.
2. **Merchant dashboard** at app.bliss.com. Merchants sign up, configure their account, create bookings, generate links, view plan status, manage payouts.
3. **Backend services**. Scheduled charge engine, webhook delivery, payout runner, notification system.

## Data model

Full schema in docs/data-model.md. Core entities:

- Merchant: business account holder
- Booking: a specific dated service being sold (e.g. "Sarah & James wedding, Oct 17")
- PaymentPlan: a customer's committed plan against a Booking
- PaymentSchedule: the dated installments within a PaymentPlan
- Customer: end consumer with cards on file
- Payout: merchant disbursement at plan completion

## v1 scope

Full build sequence in docs/v1-build-plan.md.

**In v1:**

- Merchant signup and account configuration
- Merchant onboarding to Stripe Connect Express (handles KYB and payout setup)
- Booking creation flow (price, service name, appointment date, cancellation policy)
- Unique hosted link generation per Booking
- Consumer hosted payment plan page (see docs/hosted-page-spec.md)
- Card capture and vaulting via Stripe (Elements + Customer + Payment Method)
- Scheduled charge engine via Stripe PaymentIntents off-session
- Plan eligibility logic based on time-to-booking (see "Plan eligibility" below)
- Webhook delivery to merchants on key events
- Email and SMS notifications for consumer and merchant
- Merchant dashboard: bookings list, plan status, upcoming payouts
- Merchant payout at plan completion via Stripe Connect transfer

**Out of v1, do not build:**

- JavaScript widget for embedded checkout (v1.5 after merchant feedback)
- Vertical SaaS integrations like Honeybook, Mindbody, Mews (v2)
- Native mobile app for consumers (responsive web only, ever)
- Browser extension (not in B2B model)
- Multi-currency or multi-language
- Affiliate or discovery features (no AI ranking by affiliate rate)
- Apple Pay and Google Pay (v1.5)
- Plan modifications mid-flight (pause, change frequency, add add-ons) (v1.5)
- Custom subdomain per merchant like pay.merchantname.com (v1.5)

## Key user flows

### Merchant onboarding

1. Lands on bliss.com/merchants, signs up with email
2. Verifies email via magic link
3. Enters business name, type, address, EIN, contact
4. Completes Stripe Connect Express onboarding in a Stripe-hosted flow (provides EIN, banking, KYB documentation directly to Stripe)
5. Confirms terms and Bliss fee percentage
6. Lands on dashboard, can create first Booking

### Creating a booking

1. Merchant clicks "New booking" in dashboard
2. Enters service name, customer name (optional), total price, appointment date, cancellation policy
3. System generates unique URL: pay.bliss.com/{merchant_slug}/{booking_token}
4. Merchant copies URL, sends via their own channels (email, contract, Instagram DM, etc.)

Plan options offered to the customer are determined automatically by the system based on time-to-booking, not configured per booking. See "Plan eligibility" below.

### Consumer hosted page flow

1. Customer clicks link, lands on pay.bliss.com/{merchant_slug}/{booking_token}
2. Sees merchant context (logo, business name), service details (name, date, price)
3. Selects payment plan option (3, 6, or 10 payments)
4. Sees schedule visualization with dated installments
5. Clicks "Continue to payment"
6. Enters card via Stripe Elements
7. Confirms plan setup, first charge fires (immediately or on configured start date)
8. Confirmation page with plan details, downloadable PDF schedule
9. Customer account auto-created on first use, magic link login for future access

### Scheduled charge flow

1. Daily job checks for charges due that day
2. Fires a Stripe PaymentIntent off-session against the saved PaymentMethod
3. On success: marks payment paid, sends consumer confirmation, fires merchant webhook
4. On failure: marks payment failed, sends consumer retry notice, retries per policy (3 retries over 7 days), eventually defaults plan if all retries fail

### Plan completion and merchant payout

1. Final scheduled charge succeeds, plan status updates to completed
2. Booking status updates to confirmed
3. Payout queued for total booking amount minus Bliss fee
4. Payout fires via ACH on next business day
5. Merchant receives funds, gets confirmation email and webhook

### Cancellation

1. Consumer requests cancellation via account page
2. Bliss applies merchant's stored cancellation policy
3. Refund calculated on paid amount, processed via Stripe refund
4. Remaining scheduled charges canceled
5. Booking status updates to canceled, merchant webhook fired

## Plan eligibility

The system determines which plan options are available based on the time between today and the booking's appointment date. Plan options are not configured per booking by the merchant.

Rules:

- **Less than 6 weeks** to appointment: no payment plan available. The hosted page shows a message that the booking is too close for a payment plan and prompts the customer to contact the merchant about paying in full.
- **6 to 7 weeks** to appointment: bi-weekly option only.
- **8 to 12 weeks** to appointment: both bi-weekly and monthly offered, customer chooses.
- **13 weeks or more** to appointment: monthly option only.

Bi-weekly means every 14 days. Monthly means every 30 days. First payment fires when the plan is created. The number of payments is calculated as the maximum that fits before the appointment date, with the final payment scheduled at least 3 days before the appointment to allow for retry on failure.

This logic lives in `payments/PlanEligibilityService` on the backend and is mirrored client-side for UX. The backend is the source of truth and must validate plan eligibility on plan creation, not just trust the client.

## Conventions

### Code style

- Java: standard Dropwizard conventions, package by feature not by layer
- TypeScript: strict mode, no implicit any, functional components and hooks
- Database: snake_case for columns, plural for tables, UUID primary keys
- API: REST with JSON, /api/v1/{resource} pattern
- Currency: store as integer cents (Long in Java, number in TS), never floats anywhere
- Dates: store UTC ISO 8601, render in customer's local timezone client-side

### Naming and copy

- Never use "responsible," "healthy," "debt-free alternative," or moralizing framing
- Brand voice: aspirational, desire-driven, warm
- No em dashes anywhere in customer-facing copy
- Use "your" not "the user's"
- "Plan" not "installment plan" in primary copy
- "Bookings" on merchant side, "Plans" on consumer side
- Sentence case throughout, never Title Case or ALL CAPS

### Brand

- Primary: lavender (#534AB7 working token, refine via design pass)
- Secondary: navy
- Accents: cream, dusty blue
- Typography: clean sans-serif, generous whitespace, mobile-first

## Integration points

- **Stripe Elements**: PCI-compliant card capture UI on the hosted payment plan page. Returns a PaymentMethod ID which is attached to the Customer.
- **Stripe Customers and PaymentMethods**: card vaulting. Each Bliss Customer has a corresponding Stripe Customer. Cards stored as PaymentMethods attached to that Customer.
- **Stripe PaymentIntents (off-session)**: scheduled charge execution. Each PaymentSchedule row creates a PaymentIntent when due, with `off_session: true` and the saved PaymentMethod. Stripe handles 3DS challenges (rare on saved cards) and decline retries are managed by Bliss.
- **Stripe Connect Express**: merchant onboarding, KYB, and ACH payouts. Each Merchant has a connected Express account. Payouts at plan completion are Stripe Transfers from the platform balance to the connected account.
- **Stripe Refunds API**: cancellations and partial refunds.
- **Stripe Webhooks (inbound to Bliss)**: payment_intent.succeeded, payment_intent.payment_failed, account.updated, payout.paid. These drive state changes on the Bliss side and trigger merchant webhooks downstream.
- **Postmark**: transactional email.
- **Twilio**: SMS notifications.

No other payment infrastructure in v1. No Plaid, no TabaPay, no Sila, no separate banking sponsor relationship at the application layer.

## Repository structure

```
b2b_bliss/
├── CLAUDE.md (this file)
├── README.md
├── docs/
│   ├── data-model.md
│   ├── v1-build-plan.md
│   └── hosted-page-spec.md
├── backend/                    # Java + Dropwizard
│   ├── src/main/java/com/bliss/b2b/
│   │   ├── api/                # REST resources
│   │   ├── domain/             # entity classes
│   │   ├── service/            # business logic
│   │   ├── persistence/        # DAOs, migrations (Flyway)
│   │   ├── integration/        # Stripe, Postmark, Twilio clients
│   │   └── jobs/               # scheduled runners
│   └── pom.xml
└── frontend/                   # Next.js + TypeScript
    ├── app/
    │   ├── (merchant)/         # app.bliss.com routes
    │   │   ├── dashboard/
    │   │   ├── bookings/
    │   │   ├── settings/
    │   │   └── onboarding/
    │   └── pay/                # pay.bliss.com routes
    │       └── [slug]/[token]/
    ├── components/
    │   ├── consumer/           # hosted page components
    │   └── merchant/           # dashboard components
    ├── lib/
    └── package.json
```

## What good looks like for v1

A real photographer can sign up, create a $4,000 wedding package booking, get a URL, send it to a client, and have that client complete a 6-payment plan that pays out the photographer in full on the wedding date. The hosted page feels as polished as Stripe Checkout. The merchant dashboard feels as clean as Linear or Stripe's own dashboard. The whole loop works without engineering intervention. Bliss takes a small percentage of each completed plan and that fee is transparent on merchant payouts.

## Working agreements for Claude Code

- Build features in the order specified in docs/v1-build-plan.md. Do not jump ahead.
- When in doubt about scope, default to the simpler version. v1 should ship in 12 weeks.
- Do not introduce new dependencies without flagging them.
- All new database schema goes through Flyway migrations. No ad-hoc schema changes.
- All money values stored as integer cents. No floats anywhere in the money path.
- All customer-facing copy reviewed against the naming and copy conventions above.
- If asked to add something on the "out of v1" list, flag it and ask before building.

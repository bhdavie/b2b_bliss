# v1 build plan

Phased sequence for shipping v1 in roughly 12 weeks. Build features in this order. Each phase has a definition of done that must be met before moving to the next.

## Phase 0: Foundation (week 1)

Goal: empty repo to a backend and frontend that boot, talk to a database, and serve a hello-world.

Tasks:

- Initialize backend with Dropwizard 4.x + Java 21
- Initialize frontend with Next.js 15 + TypeScript strict mode + App Router
- Set up PostgreSQL via docker-compose for local dev
- Configure Flyway for migrations, initial migration creates an empty schema
- Set up JWT auth scaffolding for merchant sessions (no UI yet, just the token issuing and verification middleware)
- Configure environment variables via Dropwizard YAML config and Next.js env files
- Set up logging (structured JSON logs, Logback for Java)
- Set up basic CI: lint, test, build on push
- Set up Sentry for error tracking on both backend and frontend
- Deploy preview environments: backend to staging on Fly.io, frontend to Vercel preview branches

Definition of done: developer can run `docker-compose up` and have backend + frontend + PostgreSQL running locally, can sign in (any email accepted for now, no real auth yet), and CI passes on a hello-world commit.

## Phase 1: Merchant onboarding (week 2-3)

Goal: a merchant can sign up, verify email, complete business info, and reach an empty dashboard.

Tasks:

- Migration: `merchants` table per docs/data-model.md
- Backend: POST /api/v1/merchants/signup, magic-link email verification flow via Postmark
- Backend: POST /api/v1/merchants/login (magic link, no password), session via JWT cookie
- Backend: GET/PATCH /api/v1/merchants/me
- Frontend: signup page, magic-link email confirmation page, login page
- Frontend: onboarding wizard pages (business info, contact, EIN, address)
- Frontend: empty dashboard shell at app.bliss.com with sidebar navigation: Dashboard, Bookings, Payouts, Settings
- Email templates: magic link sign in, welcome to Bliss

Definition of done: someone with a fresh email address can sign up, click the magic link, fill in business info, and land on an empty dashboard. The merchant record is fully populated in the database. Sessions persist across browser refresh.

## Phase 2: Stripe Connect onboarding (week 4)

Goal: merchant completes Stripe Connect Express onboarding to enable payouts.

Tasks:

- Backend: POST /api/v1/stripe/connect/account-link (creates an account link for the merchant's Express onboarding flow)
- Backend: webhook handler for `account.updated` events from Stripe, updates `merchants.stripe_connect_status`
- Backend: GET /api/v1/merchants/me/stripe-status (returns current Connect status)
- Frontend: settings page section showing Connect status, "Continue Stripe setup" button when in_progress, account summary when charges_enabled
- Frontend: gate the booking creation flow until `stripe_connect_status = charges_enabled`
- Email template: Stripe onboarding completed confirmation

Definition of done: merchant clicks "Connect with Stripe," completes Express onboarding in a Stripe-hosted flow, returns to the dashboard with charges_enabled status, and can now create bookings. Stripe holds KYB documentation and banking info; Bliss only stores the `stripe_connect_account_id` and status.

## Phase 3: Booking creation (week 5)

Goal: merchant can create a booking and get a shareable URL.

Tasks:

- Migration: `bookings` table
- Backend: POST /api/v1/bookings (validates appointment_date in future, total positive)
- Backend: GET /api/v1/bookings (paginated list for merchant), GET /api/v1/bookings/:id
- Backend: booking token generation (URL-safe random, 16 chars)
- Backend: `PlanEligibilityService` with the time-to-booking rules from CLAUDE.md. Pure function: input = appointment_date and today; output = list of eligible plan frequencies. Unit-tested across all boundary cases (5w, 6w, 7w, 8w, 12w, 13w).
- Frontend: "New booking" form on bookings page with all required fields
- Frontend: booking detail view with shareable URL, "Copy link" button, status badge
- Frontend: bookings list with status badges, sortable by date and status

Definition of done: merchant can create a booking like "Sarah & James wedding, $4000, Oct 17 2026" and immediately see a copyable URL `pay.bliss.com/{slug}/{token}` in the dashboard. Booking status is `sent` once link is generated. Plan options are not configured by the merchant; the system derives them.

## Phase 4: Hosted consumer page, customer side (week 6-8)

Goal: customer lands on the hosted page, picks a plan, enters a card, sees the schedule.

This is the most critical phase. Spec lives in docs/hosted-page-spec.md. Build to that spec exactly.

Tasks:

- Migration: `customers` and `customer_cards` tables
- Backend: GET /api/v1/public/bookings/:slug/:token (returns booking + merchant context + eligible plan options from PlanEligibilityService; no auth required)
- Backend: handle the <6 weeks case by returning empty plan options and an explanatory message field
- Frontend: pay.bliss.com/[slug]/[token] route, polished payment plan page matching spec
- Frontend: handle the <6 weeks state (no plan available message, contact merchant CTA)
- Frontend: plan option selector with live monthly amount calculation
- Frontend: schedule visualization (date pills, count varies based on selected option)
- Frontend: Stripe Elements card capture inline
- Backend: Stripe Customer creation on first use, PaymentMethod attachment from the Elements token
- Backend: POST /api/v1/public/plans (validates eligibility server-side, creates customer if new, attaches Stripe PaymentMethod, creates PaymentPlan, generates PaymentSchedule rows, fires first PaymentIntent off-session)
- Frontend: confirmation page with plan summary, downloadable PDF schedule (generate server-side)
- Email template: plan confirmation for customer with full schedule
- Email template: booking accepted notification for merchant
- Backend: webhook fired to merchant on plan.started

Definition of done: a real test customer can click a merchant's link, complete the entire flow, and end up with a PaymentPlan + PaymentSchedule in the database, a vaulted PaymentMethod on a Stripe Customer, and a confirmation email. Merchant sees the booking move from `sent` to `accepted` in their dashboard. The <6 weeks case shows the correct message.

## Phase 5: Scheduled charge engine (week 9-10)

Goal: payments fire automatically on their due dates and update plan state correctly.

Tasks:

- Backend: ScheduledChargeRunner job, runs every hour, processes PaymentSchedule rows where due_date <= today AND status = scheduled
- Backend: Stripe PaymentIntent creation per scheduled charge, `off_session: true`, `confirm: true`, with the saved PaymentMethod and `customer` set. Idempotency keyed on payment_schedule.id.
- Backend: handle Stripe webhook `payment_intent.succeeded`: update payment_schedule.status to paid, fire payment.succeeded merchant webhook, queue confirmation email and SMS
- Backend: handle Stripe webhook `payment_intent.payment_failed`: increment retry_count, set status to retrying, schedule next attempt per retry policy (24h, 72h, 168h), update last_error from Stripe failure code
- Backend: final failure path: status to failed, plan status to defaulted if any payment finally fails, fire payment.failed and plan.defaulted merchant webhooks
- Backend: plan completion path: when final payment paid, update plan status to completed, booking status to completed, queue payout creation
- Email and SMS templates: payment succeeded, payment failed (action required), plan completed (congrats), plan defaulted
- Frontend: merchant dashboard payment status indicators on bookings list
- Frontend: customer account page at pay.bliss.com/account (magic link login) showing active plans and schedules

Definition of done: a plan with 6 bi-weekly payments can run end-to-end against real Stripe test cards, payments succeed and fail correctly, retries fire on schedule, notifications send, and the plan reaches `completed` status with all hooks fired.

## Phase 6: Merchant payouts (week 11)

Goal: merchant gets paid via Stripe Connect transfer when a plan completes.

Tasks:

- Migration: `payouts` table
- Backend: PayoutInitiator job, runs daily, finds completed bookings without payouts, creates Payout records, initiates Stripe Transfer from platform balance to the merchant's connected account
- Backend: handle Stripe webhook `transfer.created` and `transfer.updated`, update payouts.status accordingly. Also handle `payout.paid` from the Connect account if needed for end-to-end confirmation
- Backend: payout.paid merchant webhook fires on transfer success
- Frontend: payouts page in merchant dashboard, lists pending/processing/paid payouts with gross/fee/net amounts and dates
- Email template: payout paid confirmation for merchant

Definition of done: when a plan completes, a payout is created with the correct gross/fee/net amounts, a Stripe Transfer fires to the merchant's connected account, and the merchant sees the payout move through statuses in their dashboard. Funds settle to the merchant's bank account on Stripe's normal payout schedule.

## Phase 7: Webhooks, cancellations, polish (week 12)

Goal: complete the merchant integration surface and handle the edge cases.

Tasks:

- Migration: `webhook_events` and `merchant_webhook_endpoints` tables
- Backend: webhook delivery service with HMAC signing, retries with exponential backoff
- Backend: POST /api/v1/merchants/webhook-endpoints (CRUD)
- Frontend: webhook configuration page in merchant settings with signing secret display, event type checkboxes, test ping button
- Backend: POST /api/v1/plans/:id/cancel (customer-initiated) and merchant-initiated cancellation endpoint
- Backend: cancellation logic: compute refund per merchant policy, fire Stripe refunds against the original PaymentIntents, cancel remaining scheduled charges, update statuses
- Email templates: cancellation confirmations for customer and merchant
- Frontend: cancel button on customer account page with cancellation policy display and refund preview
- Frontend: cancel option in merchant dashboard for unstarted plans
- Final QA pass: copy review against naming conventions, mobile responsive check, accessibility pass, security review

Definition of done: full v1 loop works end-to-end with a real photographer signed up, a real customer paying via real card, money actually flowing to the merchant on plan completion, and webhooks delivering reliably.

## Cross-cutting concerns to handle throughout

- Idempotency on all write endpoints
- Rate limiting on public endpoints (hosted page POST especially)
- CSRF protection on merchant dashboard
- Audit logging for sensitive operations (login, payout, refund)
- Monitoring: payment success rate, webhook delivery rate, plan completion rate, plan default rate

## Out of v1 reminders

If asked to add any of the following during the build, push back and flag:

- JavaScript widget for embedded merchant checkout
- Vertical SaaS integrations (Honeybook, Mindbody, Mews)
- Native mobile app (responsive web only)
- Apple Pay or Google Pay
- Multi-currency or international
- Plan modifications mid-flight
- Custom subdomains per merchant
- Affiliate or discovery features
- Switching off Stripe in v1

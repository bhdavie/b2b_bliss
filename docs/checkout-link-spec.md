# Checkout link spec

Merchants whose customers complete a booking on the merchant's own checkout
page (hotels, inns, B&Bs, retreats with their own cart UI) can drop a
Bliss link as the "Pay over time" option. The customer lands on a
Bliss-hosted page with the cart details pre-filled, picks a plan, enters a
card, and the booking lands in the merchant's Bliss dashboard for manual
reconciliation against their own system.

This document defines the URL contract.

## URL shape

```
https://pay.bliss.com/checkout/{merchant_slug}?<params>
```

For local development the host is `http://localhost:3000` and the path is
the same.

`{merchant_slug}` is the merchant's stable slug (visible at the bottom of
their Bliss dashboard under Account). It identifies the merchant and is
the only piece of the URL that's not derived from the customer's cart.

## Query parameters

| name          | required | type        | notes |
|---------------|----------|-------------|-------|
| `total`       | yes      | integer     | Total booking price in **cents**. `180000` = $1,800.00 USD. Must be > 0.
| `checkin`     | yes      | ISO date    | `yyyy-MM-dd`. The appointment / check-in date. For a hotel stay this is the arrival date. For single-appointment bookings (photo session, salon) this is the appointment date.
| `checkout`    | no       | ISO date    | `yyyy-MM-dd`. The end-of-stay date for multi-day bookings (hotels, retreats). Omit for single-appointment bookings.
| `name`        | no       | string      | Full name of the customer. Splits into first/last server-side. Shown to the merchant in the dashboard before the customer enters their email on the payment step.
| `email`       | no       | string      | Customer email. Used to look up an existing Bliss customer record (returning guests get matched by email). Also pre-fills the card-capture step.
| `phone`       | no       | string      | Customer phone. Surfaced to the merchant in the booking detail page for reconciliation.
| `description` | no       | string      | Free-text label for what was booked ("3 nights, King Suite"). Shown to the merchant in the booking detail page as **What the customer booked**. URL-encoded.

If `total` or `checkin` are missing the page renders an explanatory
"missing required details" state and asks the customer to contact the
merchant for a fresh link.

## Server-side validation

The frontend reads the URL params and the backend re-validates everything:

- `total` must be a positive integer.
- `checkin` must be a valid `yyyy-MM-dd` date in the future.
- `checkout` (if present) must be `yyyy-MM-dd` and on or after `checkin`.
- The merchant's actual `MerchantPlanRules` (lead time, allowed
  frequencies, amount caps, deposit config, payment-due deadline) are
  loaded server-side. The client cannot lie about eligibility — if the
  customer picks a frequency that isn't eligible under the merchant's
  real rules, the request is rejected.

The customer never sees the merchant's full rule config — only the
relevant policy summary (refund policy, cancellation fee, payment
deadline, failed-payment behavior) rendered as trust signals below the
schedule.

## Template-variable pattern

Merchants generate links from their own checkout page by interpolating
their booking variables into the URL template. For example, a hotel
template engine that exposes a `booking` object might render:

```
https://pay.bliss.com/checkout/the-cretch-hotel
  ?total={{ booking.total_cents }}
  &checkin={{ booking.checkin_date }}
  &checkout={{ booking.checkout_date }}
  &name={{ booking.guest_name | url_encode }}
  &email={{ booking.guest_email | url_encode }}
  &phone={{ booking.guest_phone | url_encode }}
  &description={{ booking.summary | url_encode }}
```

A booking engine using Mustache / Handlebars / Liquid uses the same
shape; replace the variable names with whatever the engine exposes. The
template should always:

1. Pass `total` in cents (multiply dollars × 100 in the template if the
   underlying field is dollars).
2. Pass dates in `yyyy-MM-dd`. ISO 8601 timestamps with a time component
   (e.g. `2026-08-15T15:00:00Z`) are not accepted.
3. URL-encode string fields. Names and descriptions often contain
   spaces, commas, and apostrophes that break the URL otherwise.

## Example

A guest booking 3 nights at $600/night ($1,800 total) at "The Cretch
Hotel":

```
https://pay.bliss.com/checkout/the-cretch-hotel?total=180000&checkin=2026-08-15&checkout=2026-08-18&name=John%20Doe&email=john%40example.com&phone=%2B14155551234&description=3%20nights%2C%20King%20Suite
```

## What lands in the merchant dashboard

A booking row appears immediately on a successful customer flow, with:

- `source = customer_initiated`
- A "From checkout link" badge on the Bookings list
- The customer's name, email, and phone from the URL
- The `description` shown as **What the customer booked** in the detail
  view
- Both `checkin` and `checkout` dates if the URL provided them

The merchant manually mirrors the booking into their own back-office
system off-platform. There is no "approve / reject" gate — the booking
is final the moment the customer's first payment clears.

## Future work

The following are deliberately out of scope for the initial cut and are
tracked separately:

- Signed URL verification (HMAC over the params with the merchant's
  signing secret). Deferred until merchants start generating links at
  scale and we see abuse vectors.
- Merchant confirmation / rejection UI before the booking goes live.
- Customer-side account page for post-booking management (Phase 5).
- Email / SMS notifications on booking creation (Phase 5/7).

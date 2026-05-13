# Hosted page spec

The consumer-facing payment plan page at `pay.bliss.com/{merchant_slug}/{booking_token}`. This is the single most important surface in v1. It is the consumer brand experience and the conversion moment.

## Design principles

- **Mobile-first.** 80%+ of traffic will be on mobile. Design for 360px width, then scale up.
- **Feels like a checkout, not a marketing page.** Stripe Checkout, Linear's quote acceptance page, Affirm's plan setup. Calm, premium, transactional.
- **Merchant context preserved throughout.** Customer always knows who they're booking with. Bliss is the rail, not the destination.
- **Concrete commitment.** The dated schedule is what makes "save toward a goal" feel real. Show the actual dates.
- **Trust signals at the moment of decision.** No interest, no credit check, cancel anytime. These three carry the entire "this isn't BNPL" message.

## Brand and copy

- Primary color: lavender, working hex `#534AB7`
- Light variant for selected states and accents: `#EEEDFE`
- Dark variant for primary text on light backgrounds: `#3C3489`
- Typography: clean sans-serif, system font stack acceptable for v1
- Sentence case everywhere
- Never use: "responsible," "healthy," "debt-free," "smart way to pay," moralizing or financial-literacy framing
- Never use em dashes in any copy

## Page sections, top to bottom

### 1. Header (sticky on scroll)

- "bliss" wordmark, 20px, left-aligned, weight 500, letter-spacing -0.5px
- Right side: small lock icon + "Secure checkout" text in 11px secondary color

### 2. Merchant context block

Top of body content. Two-column flex layout:

- Left: 38px square with rounded corners (`border-radius: 10px`), background `#EEEDFE`, merchant initials or logo centered in `#3C3489` weight 500
- Right: "Reserving with" label in 12px secondary, business name in 14px weight 500 directly below

### 3. Service summary card

Filled card with `background: var(--color-background-secondary)`, padding 16px, radius `var(--border-radius-md)`.

- Service name in 14px weight 500
- Appointment date in 12px secondary (format: "Saturday, October 17, 2026")
- Empty space, then a row with "Total" label (12px secondary) on the left and total amount in 24px weight 500 on the right

### 4. Plan selector

Section header: "Choose your plan" in 11px uppercase, weight 500, letter-spacing 0.6px, secondary color, margin-bottom 10px.

Plan options are determined by the system based on time between today and `appointment_date`. The page receives a list of eligible options from the backend; the client does not compute eligibility independently.

Eligibility rules (mirrored in `PlanEligibilityService` on the backend, which is authoritative):

- Less than 6 weeks to appointment: zero options. Render the "too close to appointment" state, not the plan selector. See edge cases below.
- 6 to 7 weeks: one option, bi-weekly only.
- 8 to 12 weeks: two options, bi-weekly and monthly. Mark monthly as "Recommended" because it has fewer, larger payments and is the more common preference.
- 13 weeks or more: one option, monthly only.

Each option renders as a card. Flex row with left side (plan name + cadence text) and right side (per-payment amount).

- Default state: 0.5px border-tertiary, transparent background
- Selected state (and the only-option state when there's just one): 2px solid `#534AB7`, background `#FAFAFD`, text colors shift to `#3C3489` / `#534AB7`
- Recommended state: same as selected plus a "Recommended" pill positioned absolute at top: -9px, left: 14px, `#534AB7` background, white text, 10px font, padding 2px 8px, border-radius 10px, uppercase, letter-spacing 0.3px

Per-option labels:

- Bi-weekly: name "Every 2 weeks", cadence text "{N} payments through {final date}"
- Monthly: name "Monthly", cadence text "{N} payments through {final date}"

Per-payment amount: total divided by number of payments, rounded with remainder distributed to first payments. Display the higher value (e.g. "$667/payment"). If the math creates a slightly smaller final payment, the schedule visualization and the disclosure on the card capture step both show this explicitly.

When only one option is eligible, render it pre-selected. The customer can't deselect; they can only continue or abandon. Do not show a single greyed-out alternative as a teaser.

### 5. Schedule visualization

Section header same style as plan selector: "Your schedule" 11px uppercase secondary.

Horizontal flex row of date pills, gap 5px. Each pill flex: 1 to fill width. The number of pills equals the number of payments in the selected plan, derived from time-to-appointment divided by frequency. Typical counts:

- Bi-weekly: 3 to 6 pills (6 weeks at 2-week cadence = 3 payments, 12 weeks = 6)
- Monthly: 2 to 12 pills (8 weeks = 2 payments, 12 months = 12)

If the count exceeds what fits comfortably on mobile (more than 8 pills), wrap to two rows rather than shrinking pills below readable size.

Each pill: padding 9px 4px, text-align center, background `var(--color-background-secondary)`, border-radius 6px. Two lines:

- Date label: 9px uppercase, letter-spacing 0.5px, weight 500, tertiary color (e.g. "MAY 1")
- Amount: 11px weight 500, primary color (e.g. "$667")

The final pill (the one closest to the appointment date) is highlighted: background `#EEEDFE`, date label in `#534AB7`, amount in `#26215C`. A small "Final" label can appear above the highlighted pill if space allows.

### 6. Primary CTA

Full-width button, padding 14px, background `#534AB7`, white text, font-size 15px, weight 500, border-radius `var(--border-radius-md)`, no border.

Label: "Continue to payment"

On click: transitions to card capture step (in-page, no navigation).

### 7. Trust signals row

Centered flex row, gap 14px, font-size 11px, tertiary color. Three items, each with an icon + label:

- Lock icon + "No interest"
- Card-off icon + "No credit check"
- Refresh icon + "Cancel anytime"

## Card capture step (after Continue clicked)

The page does not navigate. The plan selector and schedule lock visually (slight opacity drop or moved off-screen), and a Stripe Elements card form appears in its place.

Layout:

- Section header: "Payment method" 11px uppercase secondary
- Stripe Elements card input
- Email field if customer is new (we detect this from the booking token, ask only if needed)
- "Confirm plan" button, same style as primary CTA, label changes contextually

Below the button, a fine-print disclosure: "Your card will be charged ${first_payment} today. {N-1} additional payments of ${amount} will be charged on the schedule above. You can cancel anytime."

## Confirmation step (after successful plan setup)

Same page, content replaced with confirmation:

- Large lavender check icon
- Headline: "You're booked"
- Subhead: "Your plan with {merchant_name} is set"
- Plan summary box with all the dates and amounts
- "Download schedule" button (generates PDF)
- "Manage your plan anytime at bliss.com/account" with magic-link sign-in CTA

Email and SMS fire simultaneously.

## "Too close to appointment" state

When the time between today and `appointment_date` is less than 6 weeks, the system returns zero eligible plan options. The page renders a distinct state instead of the plan selector.

Layout:

- Header and merchant context block render normally
- Service summary card renders normally with full price
- In place of the plan selector and schedule, a centered card with:
  - Icon (calendar with an exclamation) in lavender
  - Headline: "This booking is too close for a payment plan"
  - Body: "Payment plans are available 6 weeks or more before the booking date. Reach out to {merchant_name} directly to arrange payment."
  - Secondary CTA: "Email {merchant_business_email}" (mailto link if available, otherwise omit)
- Trust signals row hidden in this state

No card capture, no plan creation possible from this state. The page is informational only.

## Edge cases to handle

- Booking token invalid or expired: show "This link is no longer active. Contact {merchant_name} for a new one."
- Booking already accepted: show "This booking has already been accepted. Sign in to manage your plan."
- Booking canceled by merchant: show "{merchant_name} has canceled this booking. Contact them directly with questions."
- Customer card declines: stay on card step, show inline error, allow retry
- Total amount doesn't divide evenly: show per-payment amount as the higher of the two values, with a small footnote like "Final payment: ${slightly_smaller_amount}"

## Accessibility

- All interactive elements keyboard-navigable
- Form fields have labels (visible or screen-reader)
- Color contrast meets WCAG AA on all text
- Page is screen-reader-friendly: logical heading hierarchy, descriptive button labels
- Focus states visible on all interactive elements
- No essential information conveyed by color alone

## Performance

- First contentful paint under 1s on 4G
- Total page weight under 200KB excluding Stripe Elements
- No client-side data fetching for the initial render: SSR the booking + merchant data from the URL token
- Image optimization: merchant logos served via Next.js Image with proper sizing

## Analytics events to track

- `hosted_page.viewed` with merchant_id, booking_id, weeks_to_appointment
- `hosted_page.too_close_shown` when the no-plan state renders
- `hosted_page.plan_selected` with plan option (bi-weekly or monthly)
- `hosted_page.continue_clicked`
- `hosted_page.card_submitted`
- `hosted_page.card_failed` with error code
- `hosted_page.plan_created` with plan details
- `hosted_page.confirmation_viewed`

Use these to track funnel conversion and identify drop-off points. The too-close event in particular tells you how often merchants are sending links late and might inform a merchant-side warning at booking creation time.

# Configurable property spec

Status: draft for review. No code yet.
Owner: Brad. Last updated 2026-10-01 (second revision).

Bliss today runs one way for every Mews property: the guest books a Bliss rate
in the hotel's Mews booking engine, Mews takes the upfront charge, and Bliss
charges the remaining installments through the hotel's own Mews Payments. This
spec makes Bliss configurable per property along five axes:

1. **Payout mode**: pay as you go (today) or hold (Stripe Connect holds the
   guest's money until a release point, then pays the hotel by ACH).
2. **Booking types**: refundable and non-refundable Bliss rates, with
   cancellation outcomes that mirror the hotel's own policy.
3. **Defaults**: Bliss works the moment a hotel switches it on.
4. **Auto-sync**: rates, cancellation policies, currency and reservation
   changes come from Mews, so hotels never configure anything twice. The Bliss
   fee is its own folio line.
5. **Onboarding communication**: what the hotel sees and receives, in plain
   language.

Decided and not reopened here:

- Hold mode runs on Stripe Connect. Stripe is the licensed party holding the
  funds; Bliss only controls payout timing. Payouts reach the hotel by ACH, and
  the hotel never holds refundable money.
- On Mews, the held payout posts to the reservation's folio as a ledger-only
  payment.
- The guest experience: the Bliss pop-up only lets the guest pick a plan, then
  the guest checks out in the Mews booking engine as normal. There is no Bliss
  checkout page.
- Hold-mode charges are made `on_behalf_of` the hotel (D2), on Express connected
  accounts (D6).
- The card reaches Stripe by forwarding the card Mews already holds (D1 option
  A, the target), with a card step on the Mews confirmation page (option C) as
  the fallback if A proves impossible.
- The Bliss fee is a labeled folio fee line, not a tax.

Decisions needed from Brad are collected in [Open decisions](#open-decisions)
and referenced inline as **D1**, **D2**, and so on.

---

## 1. Where we start from

What the code does today, so the spec builds on it rather than around it.

| Area | Today | Gap this spec closes |
|---|---|---|
| Mews charging | `MewsLinkService` links a Bliss-rate reservation once Mews has taken an upfront card charge; `InstallmentChargeService` charges the rest with `creditCards/charge` | Only one payout mode |
| Bliss rates | Two columns on `merchant_mews_connections` (`bliss_monthly_rate_id`, `bliss_biweekly_rate_id`) | No booking type, no policy |
| Cancellation | `CancellationService`: Stripe plans are refunded in Stripe (fixed in `f9f4b1c`; until then the refund was only computed and logged); Mews plans get a future-stay credit (V32), never cash | No Mews refunds; no non-refundable handling |
| Plan rules | `MerchantPlanRules`, hand-configured per property, defaults in `MerchantPlanRules.DEFAULTS` | Rules duplicate what Mews already knows |
| Bliss fee | Added to the installments; the Mews bill is overpaid by the fee (logged warning in `createFromMewsReservation`) | Fee is invisible on the folio |
| Stripe | Destination charges to a Connect Standard account with `application_fee_amount`; `account.updated` applied from the live account (fixed in `f9f4b1c`) | No held funds, no payouts |
| Currency, zone, locale | From Mews `configuration/get` (V36), snapshotted per booking | Already done; reused here |
| Payouts | None. `Payout` exists in CLAUDE.md's model but has no table | New |

---

## 2. Payout modes

A property has exactly one payout mode at a time. Every booking snapshots the
mode it was made under, so switching modes never changes a booking in flight.

### 2.1 Pay as you go (default)

Today's behavior, unchanged in shape:

- The guest books a Bliss rate in Mews; the rate's Mews payment policy takes the
  upfront charge through the hotel's Mews Payments.
- Bliss links the reservation and charges each installment with
  `creditCards/charge` on the card Mews holds, against the reservation.
- Money lands with the hotel at each charge. The hotel holds refundable money
  in this mode; that is the trade-off for zero Stripe setup.
- New in this spec: the Bliss fee posts as its own folio line (section 6), so the
  folio balances to the total the guest pays instead of being overpaid.

### 2.2 Hold mode (Aparium)

Funds are collected by Stripe and stay in Stripe until a release point. Bliss
decides when each amount is released; the hotel receives it by ACH. Mews only
sees ledger entries.

**Money flow**

1. **The card has to reach Stripe.** Payments are charged by Stripe, so the
   guest's card must be vaulted there, and the Bliss rate in Mews must not take
   a Mews Payments charge. The guest still checks out in the Mews booking
   engine as normal. D1 is decided: forward the card Mews holds (option A),
   falling back to a card step on the confirmation page (option C). See 2.5.
2. **Charges on the platform, on behalf of the hotel.** Each payment (deposit
   and installments) is a Stripe PaymentIntent on the Bliss platform account
   with `on_behalf_of` the hotel's connected account and a `transfer_group` of
   the booking id ("separate charges and transfers"). The hotel is the merchant
   of record: its name is on the guest's statement and disputes are its own
   (D2, decided). It is not a destination charge, so the money never reaches
   the hotel's Stripe balance on its own.
3. **Held.** Collected funds sit in the platform's Stripe balance. Bliss's own
   payout schedule must keep them there (manual platform payouts, or a balance
   reserve), so held guest money never reaches Bliss's bank (**D3**).
4. **Release.** At a release point (2.3), Bliss creates a Stripe `Transfer` to
   the hotel's connected account for the releasable amount, less the Bliss fee,
   with the same `transfer_group`.
5. **Payout.** The connected account's automatic payout schedule sends it to the
   hotel's bank by ACH. Bliss records `payout.paid` / `payout.failed`.
6. **Folio.** On release, Bliss posts a ledger-only payment to the reservation's
   folio in Mews (`payments/addExternal`, section 8.1) for the released amount,
   so the hotel's Mews balance reflects money it now has.

**Why this satisfies "the hotel never holds refundable money":** a release
point is, by definition, a moment after which the released amount is no longer
refundable under the booking's policy. Refunds before release come out of the
platform balance; the hotel's balance is never touched.

### 2.3 Release points (proposed)

A release point is when an amount stops being refundable to the guest. Each
booking gets a release schedule computed at link time from its snapshotted
cancellation policy, and recomputed only if the reservation's dates change.

| Release point | Releases | Use when |
|---|---|---|
| **End of free cancellation** (proposed default) | Everything collected so far, at the deadline; later installments as each one settles | The rate has a free cancellation window |
| **Penalty tiers** | At each step of a tiered policy, the amount that step makes non-refundable | The policy has more than one step, such as 50% at 14 days and 100% at 2 days |
| **On collection** | Each payment a few days after it settles (chargeback buffer, **D4**) | Non-refundable rates |
| **At check-in** | Everything, on arrival day in the property's zone, or when Mews marks the reservation Started | Hotels that want maximum guest protection |
| **At check-out** | Everything after departure | Not proposed as a default; slowest for the hotel |

Proposed default: **end of free cancellation for refundable rates, on
collection for non-refundable rates**, with check-in as an option the hotel
can choose. Release times are calendar instants in the property's zone, the
same way due dates work today.

The release runner is a new scheduled pass, alongside the charge pass, with the
same rules: each release holds the booking's plan lock, re-checks state under
it, and is idempotent on `(booking, release step)`.

### 2.4 Hold mode constraints to confirm with Stripe

These do not change the decided architecture, but each one shapes it:

- **How long funds may stay in the platform balance.** Stays can be booked
  a year out (**D3**).
- **Card refund window.** Card networks generally allow refunds up to about 180
  days after the charge. A refund owed on a payment collected earlier than that
  may fail and need another route, such as a bank transfer or credit (**D5**).
- **Connect account type.** Hold-mode properties onboard to **Express**
  accounts (D6, decided). Today's Standard accounts stay for the existing
  Stripe rail; a property moving to hold mode onboards a new Express account.
- **ACH means US banks.** Hold mode starts US only. Properties elsewhere use pay
  as you go until local payout rails are added.

### 2.5 Getting the card to Stripe without a Bliss checkout (D1)

**Decision:** option A is the target. Option C is the fallback, built only if
Mews will not grant card access or Stripe will not accept the forwarded card.
Option B is not pursued; option D remains a recovery path for a guest who
leaves the confirmation step without adding a card under C. The options as
weighed:

The constraint: the pop-up only picks a plan, and the guest completes checkout
in the Mews booking engine as normal. Whatever card the guest gives Mews stays
in Mews (Mews Payments is the hotel's processor), and Bliss cannot charge it
through Stripe. So each option either moves the card from Mews to Stripe, or
asks the guest for it once more in a Bliss element on the Mews booking engine.
In every option the Bliss rate in Mews takes no Mews Payments charge; it either
requires a card guarantee only, or nothing.

**Option A. Forward the card Mews already holds to Stripe.**
The guest experience is identical to today: one card entry, in Mews checkout.
The Bliss rate's Mews policy is a card guarantee with no charge. After the
reservation appears, Bliss asks Mews for the card through Mews's PCI
tokenization (Mews uses PCI Proxy) and forwards it to Stripe, vault to vault,
so the raw card number never touches Bliss's servers. Bliss then charges the
deposit and installments in Stripe.

- For: exactly the settled UX; one card entry; nothing for the guest to do later.
- Against: depends on Mews granting our integration card access and on a
  forwarding route (PCI Proxy to Stripe) that Stripe accepts. Feasibility is
  unknown until both are asked; this has the longest lead time. Stripe never
  saw the card at booking, so the first charge is off-session on a card it
  never authenticated: fine in the US, more 3DS friction in Europe.

**Option B. Card field in the pop-up, at plan pick.**
When the guest picks a plan, the pop-up also shows a Stripe card field
(Elements) and saves the card with a SetupIntent; nothing is charged. The guest
then checks out in Mews as normal (card guarantee or no card, per the rate).
Bliss matches the Mews reservation to the pop-up session (guest email, rate and
dates within a short window) and charges the deposit in Stripe once linked.

- For: no dependency on Mews card access; Stripe authenticates the card itself
  (3DS handled up front); buildable now.
- Against: the pop-up does more than pick a plan (one card field). Two card
  entries if the rate also asks for a guarantee card. Matching a pop-up session
  to a reservation is a heuristic: a guest who changes email or dates in Mews
  breaks the match and needs a fallback (Option D). A guest who abandons Mews
  checkout leaves a saved card that is never charged.

**Option C. Card step on the Mews confirmation page.**
The guest checks out in Mews as normal. On the booking engine's confirmation
step, where the pop-up already runs, it shows "Add the card for your payment
plan" with a Stripe card field. The Bliss rate books the reservation as Optional
in Mews; Bliss confirms it once the deposit succeeds, and Mews releases it if
the card is never added.

- For: plan pick and Mews checkout stay exactly as settled; the reservation is
  known before the card is asked for, so there is no matching heuristic.
- Against: an extra step after the guest believes they're done, so expect
  drop-off. Two card entries if the rate asks for a guarantee card. Relies on
  the pop-up running on the confirmation step and on Optional reservations and
  their expiry being set up on the Bliss rate.

**Option D. Activation link by email or SMS (fallback only).**
After the reservation appears, Bliss sends the guest a link to add their card.

- For: works whatever the booking engine allows; good as the fallback for B and
  C.
- Against: the card form is a Bliss page (not a checkout, but close to one).
  Highest drop-off; the reservation waits unpaid.

| | A. Forward Mews card | B. Card at plan pick | C. Card on confirmation | D. Link |
|---|---|---|---|---|
| Guest card entries | 1 | 1 or 2 | 1 or 2 | 2 |
| Pop-up does only plan pick | Yes | No | Yes, until after checkout | Yes |
| Depends on Mews granting card access | Yes | No | No | No |
| Reservation to card matching | Exact | Heuristic | Exact | Exact |
| Drop-off risk | Lowest | Low | Medium | High |
| Buildable now | No (needs Mews and Stripe answers) | Yes | Yes | Yes |

---

## 3. Booking types

### 3.1 Types

- **Refundable**: the guest can cancel and get money back up to a deadline,
  then a penalty applies.
- **Non-refundable**: nothing is refunded once booked. Paid amounts are kept,
  or credited if the hotel prefers credit.

A booking's type comes from the **Bliss rate** the guest booked, and the rate's
type comes from its Mews cancellation policy (section 5). Hotels can override a
rate's type in Bliss settings. With no override, Bliss follows Mews. A hotel
may offer refundable rates, non-refundable rates, or both.

Each booking snapshots, at link time:

- type (`refundable` | `non_refundable`)
- the cancellation policy steps (deadline relative to arrival, penalty as a
  percentage, nights, or a fixed amount)
- payout mode and release schedule

Later policy edits in Mews apply to new bookings only, as currency does.

### 3.2 What a cancellation does

"Collected" is what the guest has paid so far. "Penalty" is what the hotel's
policy keeps at the moment of cancellation, capped at the amount collected.
Remaining installments are always cancelled; Bliss never charges after a
cancellation unless **D7** says otherwise.

| | Pay as you go (money is with the hotel) | Hold mode (money is in Stripe) |
|---|---|---|
| **Refundable, before the free cancellation deadline** | Full refund of collected. Bliss issues it through Mews if the API allows (**D8**); otherwise future-stay credit, or the hotel refunds by hand following a Bliss task | Full refund from the platform balance. Nothing has been released. Nothing posts to the folio |
| **Refundable, after the deadline** | Penalty is kept; the rest is refunded as above | The penalty is released to the hotel (and posted to the folio as ledger); the rest is refunded from the platform balance |
| **Non-refundable** | Collected is kept by the hotel (forfeit), or future-stay credit if the hotel chose credit | Collected is released to the hotel (forfeit). Most of it was already released on collection |
| **Plan defaulted** (retries exhausted, `treat_as_cancellation`) | As the matching row above, at the moment of default | Same |
| **Hotel cancels** (overbooking, closure) | Full refund regardless of type | Full refund regardless of type; anything released is pulled back by transfer reversal |

**The Bliss fee on cancellation (D9).** Proposed: refunded whenever the guest
gets a full refund, and kept otherwise. In hold mode it is retained from the
penalty that is released; in pay as you go mode it is part of what the hotel's
policy keeps.

**Future-stay credit** (V32) stays available in both modes as a hotel choice:
"Instead of refunds, give guests credit toward a future stay". In hold mode,
choosing credit means the would-be refund is released to the hotel, and the
credit is recorded and emailed as today.

---

## 4. Default settings

When a hotel switches Bliss on, every setting below has a value. A hotel can
take bookings without opening Settings. Defaults marked "from Mews" are read by
auto-sync and shown, not asked.

| Setting | Default | Notes |
|---|---|---|
| Payout mode | Pay as you go | Hold mode needs Express onboarding first |
| Currency, time zone, language | From Mews `configuration/get` | Already in place (V36) |
| Bliss rates | None until the hotel picks them. Bliss suggests rates whose name contains "Bliss" | Linking stays off until at least one is chosen |
| Booking type per Bliss rate | From the rate's Mews cancellation policy | Override available |
| Cancellation policy | From Mews | Never typed into Bliss |
| Upfront payment (deposit) | Pay as you go: whatever the Mews rate charges at booking. Hold mode: 20% of the stay, collected by Bliss (**D10**) | |
| Payment schedules offered | Both every 2 weeks and monthly; recommended: monthly | `AllowedFrequencies.BOTH` |
| Minimum lead time | 6 weeks | Matches today's `DEFAULTS` |
| Final payment due | 3 days before check-in (the retry buffer) | Today `AT_APPOINTMENT` plus the 3-day buffer |
| Failed payment retries | 3 tries, 3 days apart | Today's default |
| After the last retry fails | Treat as a cancellation (section 3.2 applies) | Today's default |
| Release point (hold mode) | End of free cancellation for refundable rates; on collection, plus the chargeback buffer, for non-refundable | Section 2.3 |
| Refunds or credit | Refunds, following the hotel's policy | Credit is opt-in |
| Bliss fee | Per the property's fee rate (falls back to 5%); shown on the folio as "Bliss service fee" | Section 6 |
| Guest emails | All on (confirmation, receipts, reminders, failure, completion) | |
| Hotel emails | Flags, weekly summary, and in hold mode, releases and payouts | |
| Guest allowlist | Empty (no restriction) for real properties | Demo properties only (V37) |
| Plan discount | None | |

---

## 5. Auto-sync with Mews

### 5.1 What Bliss reads

| Data | Mews call | When | Used for |
|---|---|---|---|
| Currency, zone, language, address | `configuration/get` | On connect; daily; on "Resync" | Formatting, due dates (V36) |
| Services and rates | `services/getAll`, `rates/getAll` | On connect; daily; on "Resync" | Bliss rate picker; renamed or disabled rates |
| Rate groups | `rateGroups/getAll` | Same | Cancellation policies hang off rate groups |
| Cancellation policies | `cancellationPolicies/getAll` (by rate group) | Same | Booking type, penalty steps, release points |
| Rate payment policy (upfront charge) | From the rate or rate group setup, if exposed (**D11**) | Same | Pay as you go deposit display; hold mode check that the Bliss rate takes **no** Mews charge |
| Reservations | `reservations/getAll/2023-06-06` by `UpdatedUtc` | Every 2 minutes (today) | Linking; date changes; cancellations in Mews |
| Payments | `payments/getAll` | Linking, reconciliation (today) | Deposit; settlement |

Mews webhooks (General Webhooks / integration events) could replace polling for
reservations later; polling stays for v1 of this spec.

All Mews endpoint names above need confirming against the current Connector
API reference before build; `rateGroups/getAll` and
`cancellationPolicies/getAll` are not called today.

### 5.2 How changes flow

- **Rates and policies:** a sync stores a snapshot (section 7) and diffs it
  against the last one. Material changes are emailed to the hotel and shown in
  Settings, for example "Your Bliss rate 'Bliss monthly' now has a 14 day free
  cancellation window. New bookings follow it; existing bookings keep their
  terms." Bookings already made keep their snapshot.
- **A Bliss rate disabled or deleted in Mews:** linking for that rate stops; the
  hotel is told; existing plans continue.
- **Currency changes:** as today (V36): new bookings take the new currency; the
  charge pass holds old-currency plans rather than charging the wrong amount.
- **Reservation changes:** today's flags (dates changed, cancelled in Mews) stay.
  New: a cancellation in Mews on a linked booking runs the section 3.2 matrix
  for that booking's type and mode, instead of only flagging. Whether a
  Mews-side cancellation acts automatically or waits for hotel confirmation is
  **D12**.

### 5.3 What hotels no longer configure in Bliss

`MerchantPlanRules` fields that duplicate Mews become read-only, sourced from
the sync: refund policy, cancellation fee, and the deposit in pay as you go
mode. Bliss-only settings stay editable: payment schedules offered, lead time,
retries, after-retries action, credit instead of refund, discount, and blackout
dates.

---

## 6. Bliss fee on the folio

Decided: the Bliss fee is its own clearly labeled folio line, alongside other
fees, not in taxes.

- **Posting:** when a plan is created, Bliss adds an order item to the
  reservation, "Bliss service fee", for the fee amount in the booking's
  currency (`orders/add` linked to the reservation, or a product configured
  for Bliss, **D13**). It is posted once, idempotently, keyed on the plan.
- **Accounting category:** a "Bliss fees" category the hotel maps in Mews, so it
  reports with other fees, not taxes.
- **Tax treatment:** Mews requires a tax code on every item. Whether the fee
  carries VAT or sales tax depends on jurisdiction and on who supplies the
  service (**D14**). The spec assumes an explicit, configurable tax code per
  property, not a guess.
- **Pay as you go:** with the fee on the folio, the folio total equals what Bliss
  charges in total, so the guest's installments no longer overpay the bill. This
  removes today's "fee overpays the Mews bill" warning.
- **Hold mode:** the fee is retained by Bliss at release, not transferred to
  the hotel. It still posts to the folio as a line so the guest's total matches;
  the ledger payment posted at release covers the stay, and Bliss posts a
  matching ledger payment for the fee so the folio closes at zero (**D15**).
- **On cancellation:** if the fee is refunded (D9), the folio line is reversed
  (a negative item, or the order cancelled, per what the API supports).

---

## 7. Data model

All changes through Flyway, starting at V38. Money stays integer minor units of
the booking's currency.

### 7.1 New and changed tables

**`property_bliss_settings`** (one row per merchant; created with defaults when
Bliss is switched on)

| column | type | notes |
|---|---|---|
| merchant_id | uuid PK FK | |
| payout_mode | varchar | `pay_as_you_go` (default) or `hold` |
| release_policy | varchar | `cancellation_deadline` (default), `check_in`, `on_collection` |
| chargeback_buffer_days | int | default per D4 |
| cancellation_outcome | varchar | `refund` (default) or `credit` |
| fee_tax_code | varchar | Mews tax code for the fee line (D14) |
| fee_accounting_category_id | varchar | Mews accounting category |
| bliss_enabled_at | timestamptz | |
| updated_at | timestamptz | |

**`merchant_bliss_rates`** replaces the two rate columns on
`merchant_mews_connections` (data migrated):

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| merchant_id | uuid FK | |
| mews_rate_id | varchar | unique per merchant |
| frequency | varchar | `monthly` or `biweekly` |
| booking_type_override | varchar null | null means follow Mews |
| active | boolean | false when disabled in Mews |
| synced_rate_name | varchar | |
| synced_rate_group_id | varchar | |

**`mews_cancellation_policies`** (latest synced snapshot; the history lives in
booking snapshots)

| column | type | notes |
|---|---|---|
| merchant_id, rate_group_id | composite key | |
| steps | jsonb | ordered `[{offset_from_arrival, fee_type, fee_value}]` |
| derived_type | varchar | `refundable` or `non_refundable` |
| synced_at | timestamptz | |

**`mews_sync_runs`**: merchant, started and finished times, what changed
(jsonb), error. This feeds the "Last synced" display and change emails.

**`bookings`** (add): `booking_type`, `payout_mode`, `cancellation_terms`
(jsonb snapshot; the existing `cancellation_policy` column is a merchant's free
text and is kept), `free_cancellation_until` (timestamptz, property zone
resolved).

**`payment_plans.payment_rail`**: allow `stripe_hold` (CHECK constraint update).
A hold-mode plan charges through Stripe on the platform and mirrors to Mews as
ledger entries.

**`payout_releases`** (hold mode)

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| booking_id | uuid FK | |
| step | varchar | `cancellation_deadline`, `penalty_tier_n`, `on_collection:{schedule_id}`, `check_in`, `cancellation` |
| release_at | timestamptz | |
| amount_minor | bigint | released to hotel (excluding fee) |
| fee_minor | bigint | retained by Bliss |
| status | varchar | `scheduled`, `released`, `reversed`, `canceled` |
| stripe_transfer_id | varchar | |
| mews_external_payment_id | varchar | ledger posting |
| released_at | timestamptz | |
| unique (booking_id, step) | | idempotency |

**`payouts`**: mirrors Stripe payouts on connected accounts (id, merchant,
stripe_payout_id, amount, currency, arrival_date, status). Fed by webhooks.

**`refunds`**: (plan, schedule rows covered, amount, rail, stripe_refund_id or
mews reference, status, reason). Needed in both modes because refunds will
execute for the first time.

**`folio_postings`**: (booking, kind `fee_line`, `ledger_payment`, `reversal`,
mews id, amount, idempotency key). This guarantees each Mews write happens
once.

### 7.2 Domain and code shape

- `payments/` package grows `PayoutMode`, `BookingType`, `CancellationPolicy`
  (steps, `penaltyAt(instant)`, `freeCancellationUntil()`), and
  `ReleaseSchedule`.
- `service/CancellationService` becomes the single place the section 3.2 matrix
  runs, and it executes the money movement (it computes it today).
- `service/ReleaseService` (new) runs releases on a schedule, under the plan
  lock.
- `integration/pms/MewsAdapter` adds the read calls in 5.1 plus
  `addExternalPayment` and `addOrderItem`.
- `integration/StripePaymentsService` adds platform charges with
  `transfer_group`, transfers, transfer reversals and refunds. All Stripe code
  stays in the payments and integration seams per CLAUDE.md.

---

## 8. Touchpoints

### 8.1 Mews

| Purpose | Call | Mode | New? |
|---|---|---|---|
| Property config | `configuration/get` | Both | Existing |
| Rates, services | `rates/getAll`, `services/getAll` | Both | Existing |
| Rate groups, cancellation policies | `rateGroups/getAll`, `cancellationPolicies/getAll` | Both | **New** |
| Reservations, changes | `reservations/getAll/2023-06-06` | Both | Existing |
| Upfront payment, settlement | `payments/getAll` | Pay as you go | Existing |
| Installment charge | `creditCards/charge` | Pay as you go | Existing |
| Refund | Refund endpoint if available to our integration (D8) | Pay as you go | **New**, if possible |
| Bliss fee line | `orders/add` (linked to reservation) or product order | Both | **New** |
| Ledger payment at release | `payments/addExternal` with an agreed external payment type and Bliss references in notes (D16) | Hold | **New** |
| Cancel stay | `reservations/cancel` | Both | Existing |

Certification: every new write call needs Mews partner approval for our
integration; `payments/addExternal` and order posting should be raised with
Mews early.

### 8.2 Stripe

| Purpose | Object or event | Mode | New? |
|---|---|---|---|
| Card vaulting | SetupIntent, PaymentMethod, Customer | Hold | Existing (Stripe rail) |
| Charges | PaymentIntent on platform, `on_behalf_of` the hotel (D2), `transfer_group` = booking id | Hold | **New** shape (today: destination charges) |
| Release | `Transfer` to connected account | Hold | **New** |
| Pull back a release | `TransferReversal` | Hold | **New** |
| Refund | `Refund` on the PaymentIntent | Hold, and today's Stripe rail | Executed on the Stripe rail as of `f9f4b1c`; hold mode reuses it |
| Payout to hotel | Connected account automatic payouts, ACH | Hold | **New** to Bliss (Stripe does it) |
| Onboarding | Express connected account plus AccountLink | Hold | **New** (Express, D6); Standard stays for the existing Stripe rail |
| Webhooks | `payment_intent.*`, `charge.refunded`, `charge.dispute.*`, `transfer.*`, `payout.paid`, `payout.failed`, `account.updated` | Hold | Mostly **new**. `account.updated` is applied as of `f9f4b1c` |

---

## 9. API changes

All under `/api/v1`, merchant-authenticated unless noted.

| Method and path | Purpose |
|---|---|
| `GET /merchants/me/bliss-settings` | All section 4 settings with values, source (`default`, `mews`, `hotel`) and whether editable |
| `PUT /merchants/me/bliss-settings` | Update editable settings. Switching payout mode to `hold` returns 409 until Stripe onboarding is complete |
| `POST /merchants/me/bliss/enable` | Switch Bliss on: creates the settings row with defaults, runs the first sync |
| `GET /merchants/me/mews-sync` | Last sync, synced rates with derived booking types and policies, pending changes |
| `POST /merchants/me/mews-sync` | "Resync now" |
| `PUT /merchants/me/bliss-rates` | Choose Bliss rates, frequency and booking type override |
| `GET /merchants/me/releases?status=` | Hold mode: scheduled and past releases with amounts and dates |
| `GET /merchants/me/payouts` | Hold mode: payouts and arrival dates |
| `GET /public/plans/{token}` (public) | Adds `bookingType`, `cancellation` (`freeUntil`, steps in plain language) so the guest portal shows the terms |
| `GET /public/merchants/{slug}/plan-rules` (public, overlay) | Adds per-rate booking type and free cancellation terms for the pop-up |
| Admin: `GET/POST /admin/properties/{id}/releases` | Inspect and, if needed, hold or force a release |

Existing `PUT .../plan-rules` keeps working for Bliss-only fields; fields now
sourced from Mews return 409 with a message pointing to Mews.

---

## 10. Onboarding communication

Plain language, sentence case, no em dashes, "your" not "the hotel's".

### 10.1 In-app setup (after Mews is connected)

**Screen 1. "Turn on Bliss"**
"Bliss lets your guests pay for their stay over time, interest free. We've read
your setup from Mews, so there's nothing to type. Review it on the next screens
and switch Bliss on when you're ready."

**Screen 2. "Your Bliss rates"**
A list of Mews rates. Ones named like "Bliss" are preselected. Each row shows
its schedule (monthly or every 2 weeks) and, read from Mews, "Free cancellation
until 14 days before arrival" or "Non-refundable".
Help text: "Guests choose a payment plan by booking one of these rates. Their
cancellation terms come from Mews, so if you change them there, Bliss follows."

**Screen 3. "How you get paid"**
- *Pay as you go (recommended to start).* "Each payment goes straight to you
  through Mews Payments, like any other card payment. Nothing to set up."
- *Hold until it's yours.* "Bliss holds each payment safely with Stripe until
  it can no longer be refunded, then sends it to your bank by ACH. You never hold
  money you might have to give back. Needs a short Stripe setup."
  Shows the release point: "We'll send you each booking's money when its free
  cancellation ends, or as each payment clears for non-refundable rates."

**Screen 4. "Everything else is set"**
A compact list of the section 4 defaults in plain words, for example "Payments
are retried 3 times, 3 days apart", "The last payment is due 3 days before
arrival", "Guests can start a plan 6 weeks or more before arrival", "The Bliss
fee shows on the folio as 'Bliss service fee'". Each line has "Change".

**Screen 5. "Add Bliss to your booking page"**
The existing install step (pop-up snippet).

**Settings, afterwards:** one page with three groups: "Synced from Mews"
(read-only, last synced time, "Resync now"), "Your Bliss choices" (editable),
and "Payouts" (hold mode only: upcoming releases, recent payouts).

### 10.2 Emails to the hotel

| Email | When | Gist |
|---|---|---|
| "Bliss is on" | Bliss switched on | What's live, the rates, how they're paid, link to settings |
| "We noticed a change in Mews" | Sync finds a material rate or policy change | What changed; new bookings follow it; existing ones keep their terms |
| "A Bliss rate was switched off" | Bliss rate disabled in Mews | Linking paused for that rate |
| "Money on its way" (hold) | Each release | Amount, reservation number, expected arrival date |
| "Payout sent" or "Payout failed" (hold) | Stripe payout events | Arrival date, or what to fix |
| Weekly summary | Mondays | New plans, payments collected, upcoming releases, any flags |
| Existing flags | Today's triggers | Unchanged |

### 10.3 What guests see

- The pop-up and portal show the booking type and terms in one line:
  "Free cancellation until 3 March" or "Non-refundable".
- Cancellation in the portal states the outcome before confirming: "You'll get
  £450.00 back" or "Your £450.00 becomes credit for a future stay" or "This
  booking is non-refundable".
- In hold mode, receipts read the same as today. Guests don't need to know where
  the money is held.

---

## 11. Build order

Each phase ships on its own and leaves production consistent.

**Phase 0: prerequisites**
- Done: `account.updated` is applied, and Stripe-rail cancellations refund
  (`f9f4b1c`).
- Answer D3 (hold mode cannot start without it).
- D1 option A: ask Mews for card access for our integration (PCI Proxy
  tokenization) and Stripe whether it accepts the card forwarded vault to vault.
  If either says no, Phase 5a builds option C instead.
- Confirm the new Mews calls exist and are available to our integration (D8,
  D11, D13, D16).

**Phase 1: settings and defaults, no behavior change**
- V38: `property_bliss_settings`, `merchant_bliss_rates` (migrated from the
  connection columns), booking snapshot columns.
- Settings API, read-only in the UI. Every property gets defaults equal to
  today's behavior.

**Phase 2: auto-sync, read only**
- Rate groups and cancellation policies synced and snapshotted; sync runs and
  change detection; "Synced from Mews" in Settings; change emails.
- Bookings start snapshotting booking type and policy (informational only).

**Phase 3: Bliss fee folio line (pay as you go)**
- `orders/add` fee posting, idempotent; tax code and category settings.
- Removes the overpay. Pilot on the Gross UK demo, then Cranberry.

**Phase 4: booking types and real cancellations (pay as you go)**
- Section 3.2 matrix for pay as you go; Mews refunds if D8 allows, else
  credit or a hotel task. Portal shows terms and outcomes.
- Stripe rail refunds execute (today they are only computed).

**Phase 5: hold mode**
- 5a: Express onboarding for hold-mode properties; the card path from D1
  (option A, or option C if A is not available);
  platform charges `on_behalf_of` the hotel with `transfer_group`; plan rail
  `stripe_hold`.
- 5b: release schedule, `ReleaseService`, transfers, `payments/addExternal`
  ledger posting, payout webhooks.
- 5c: hold mode cancellations: refunds from the platform balance, transfer
  reversals, fee handling.
- 5d: hotel payout views and emails.
- Pilot with Aparium in Stripe test mode on a dedicated Mews demo property, then
  live.

**Phase 6: onboarding flow**
- The section 10 screens replace today's Mews booking setup step; "Bliss is on"
  email; weekly summary.

Phases 1 and 2 can start immediately. Phase 3 needs D13 and D14. Phase 5 needs
the D1 answers from Mews and Stripe, plus D3, D4, D5 and D10.

---

## 12. Open decisions

Decided: **D1**, forward the card Mews holds to Stripe (option A), with the
confirmation-page card step (option C) as the fallback (section 2.5). **D2**,
hold-mode charges are made `on_behalf_of` the hotel, so the hotel is the
merchant of record. **D6**, hold-mode properties use Express
connected accounts; Standard stays for the existing Stripe rail.

Still open:

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D3** | How long Stripe allows held funds to stay in the platform balance before release | Stripe's limit for separate charges and transfers | Confirm the maximum with Stripe; stays can be booked a year out. Held funds stay in the platform balance with Bliss's own payouts set so they are not swept |
| **D4** | Chargeback buffer before "on collection" releases | 0, 3, 7 days | 3 days |
| **D5** | Refunds past the card refund window | Bank transfer; future-stay credit; disallow long holds | Credit, with a hotel-approved manual refund path |
| **D7** | Non-refundable cancellation: keep collecting the remaining installments, or stop | Stop and forfeit what's paid; keep charging to the full price | Stop and forfeit. Friendlier, and fewer failed charges. The hotel's policy may say otherwise, so make it a setting |
| **D8** | Pay as you go refunds through Mews | Mews refund API; credit only; hotel refunds by hand | Use the API if our integration may; otherwise credit by default |
| **D9** | Bliss fee on cancellation | Refund with a full refund; always keep; never keep | Refund with a full refund, otherwise keep |
| **D10** | Hold mode deposit | 0%; 20%; follow the Mews rate | 20%, editable |
| **D11** | Reading a rate's upfront payment policy from Mews | Via API if exposed; hotel confirms in Bliss | API if available; otherwise a one-time confirmation in setup |
| **D12** | Cancellation made in Mews on a linked booking | Act automatically; flag and wait for the hotel | Act automatically for refundable bookings before the deadline; flag otherwise |
| **D13** | Fee line mechanism | Ad hoc order item; a "Bliss service fee" product created per property | A product, so hotels' reports group it |
| **D14** | Tax on the Bliss fee | No tax; hotel's standard rate; per jurisdiction | Needs an accountant's view per market; spec assumes a configurable tax code |
| **D15** | Folio closing in hold mode | Ledger payment for stay only; plus a matching ledger payment for the fee | Both, so the folio closes at zero |
| **D16** | External payment type for ledger postings | One of Mews's external types (for example Prepayment), chosen with Aparium's accounting | Agree with Aparium before Phase 5 |

---

## 13. Risks

- **Hold period.** If Stripe's maximum hold is shorter than a booking's lead
  time, releases or the charge schedule must fit inside it (D3).
- **Long holds and refunds.** Card refund windows are shorter than booking lead
  times (D5).
- **Mews certification.** New write calls (`payments/addExternal`, orders) need
  approval. We should start the conversation now, ideally alongside a dedicated
  demo enterprise request.
- **Dispute exposure.** With `on_behalf_of` the hotel absorbs disputes, but a
  dispute on money still held comes out of the platform balance first, and
  released funds may need to be pulled back by transfer reversal.
- **Two systems of record.** Every Mews write is idempotent and recorded in
  `folio_postings`. Reconciliation should compare Bliss releases with Mews
  ledger payments nightly.

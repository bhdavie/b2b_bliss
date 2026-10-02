# Card disputes

Status: built and tested on the `disputes` branch, **not deployed** (awaiting review).

## Scope: which payments can be disputed here

Only payments Bliss charges through **Stripe** raise these disputes: plans on
the Stripe rail (properties without a booking system, paying through Bliss's
hosted checkout) and hold mode. A Mews property in pay as you go charges every
payment through **the hotel's own Mews Payments** (`creditCards/charge`, plan
rail `mews`), so a chargeback there happens in Mews, never reaches Stripe, and
none of this fires. Cranberry Trail Inn on Mews pay as you go is therefore not
covered by this spec; see "Mews chargebacks" below.

So this is needed before the first Stripe-rail property takes live payments,
or before any property uses hold mode, not before Cranberry goes live on Mews
pay as you go.

## Why a second webhook endpoint

Bliss makes every card charge on its own platform account: destination
charges in pay as you go, `on_behalf_of` charges in hold mode. Stripe raises a
dispute on the account that made the charge, so `charge.dispute.*` events are
**platform account events**. They are never sent to the existing Connect
endpoint, which only receives events about the properties' connected accounts.

Stripe gives each endpoint its own signing secret, and the backend verifies
each endpoint with its own, so an event signed for one endpoint is refused by
the other.

| | Connect endpoint (exists) | Platform endpoint (new) |
|---|---|---|
| URL | `https://api.bliss-payments.com/api/v1/stripe/webhooks` | `https://api.bliss-payments.com/api/v1/stripe/platform-webhooks` |
| Listens to | Events on connected accounts | Events on your account |
| Events | `account.updated`, `payout.paid`, `payout.failed` | `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` |
| Signing secret env var | `STRIPE_WEBHOOK_SECRET` | `STRIPE_PLATFORM_WEBHOOK_SECRET` |

Other events sent to either endpoint are acknowledged (200) and ignored.

## What happens

On `charge.dispute.created`:

1. **Attach.** The dispute's PaymentIntent is matched to the payment it paid
   (`payment_schedule.stripe_payment_intent_id`), and through it the plan,
   booking and property. A pay off shares one intent across rows; the dispute
   attaches to the first. Recorded in `plan_disputes` (V45) with amount,
   currency, reason, Stripe status, evidence deadline and live or test mode.
2. **Unmatched disputes are kept.** A charge Bliss didn't record against a plan
   is still stored, with no plan, and the email says it wasn't matched.
3. **Hotel view.** The plan appears in the hotel's "Needs attention" card
   ("Card dispute open: $300.00") and its plan page shows a "Card dispute open"
   panel with the amount, reason and status.
4. **Admin view.** The property's admin page lists its disputes, each linking to
   the dispute in the Stripe dashboard.
5. **Email to Bliss operations**, once per dispute, to `BLISS_OPS_EMAIL`:
   amount, reason, status, evidence deadline, property, stay, plan, and the
   Stripe dashboard link. No email when the variable is blank (logged instead).
6. **Email to the hotel**, once per dispute matched to one of its plans: the
   same facts as its plan page (amount, stay, reason, status), and that Bliss
   will be in touch about evidence.
7. **Hold mode:** a payment with an open dispute is not released to the hotel
   while the dispute is open; it goes out on the next release pass after the
   dispute closes (`won`, `lost` or `warning_closed`), if it is still due.
8. **Payments paused.** While a plan has a dispute that is open, the scheduled
   charge pass skips the plan's payments (and a payment already picked up is
   stopped under the plan lock). The guest can't pay early or pay off either:
   the portal answers "Payments on this plan are paused. Please contact the
   property." The pause shows on the hotel's plan page and "Needs attention"
   card, on the admin property page, and in both emails.
   - **Won** (or closed as a warning): payments resume on their own; a payment
     whose date passed meanwhile is charged on the next pass.
   - **Lost:** payments stay paused until an admin presses "Resume payments" on
     the property's admin page (`POST /api/v1/admin/disputes/{id}/resume-payments`,
     recorded with who and when). Cancelling the plan is the other way out.

On `charge.dispute.updated` and `charge.dispute.closed`, the status, amount and
deadline are refreshed. A closed dispute (`won`, `lost`, `warning_closed`) gets
`closed_at`, drops off "Needs attention", and its panel reads "Card dispute
closed". Only the opening is emailed.

**Idempotent.** The dispute id is unique; a retried `created` event changes
nothing and sends nothing. **Never lost.** If recording fails, the endpoint
answers 500 so Stripe retries. Without its secret the endpoint answers 503.

## Environment variables

| Variable | Value |
|---|---|
| `STRIPE_PLATFORM_WEBHOOK_SECRET` | The new platform endpoint's signing secret (`whsec_…`) |
| `BLISS_OPS_EMAIL` | Where dispute emails go. Already set in production (`brad@bliss-payments.com`), shared with new-signup alerts |

## Dashboard steps (live mode)

1. Developers (Workbench) → Webhooks → Add destination.
2. Events from: **Your account** (not connected accounts).
3. Events: `charge.dispute.created`, `charge.dispute.updated`,
   `charge.dispute.closed`.
4. Endpoint URL: `https://api.bliss-payments.com/api/v1/stripe/platform-webhooks`.
5. Name it, for example `bliss-production-platform`, save, and copy its signing
   secret.
6. After this change is deployed, set it yourself:
   `heroku config:set STRIPE_PLATFORM_WEBHOOK_SECRET=… -a bliss-b2b-api`.
   Setting it before the deploy is harmless; nothing reads it yet.

## Decided

- **Hotel email:** yes, when a dispute opens, with the same facts as the plan
  page (built, point 6).
- **Hold mode:** a disputed payment's release stays held until the dispute
  closes (built, point 7).
- **Evidence:** submitted by hand in the Stripe dashboard for now.

## Why the guest can't pay early during a dispute

Recommended and built: block it. The card is being disputed, so taking more
from it adds to what the bank may claw back and to the account's dispute rate,
and a guest who is disputing a charge is better served by talking to the
property than by a payment button. A legitimate guest who wants to pay can be
helped by the property once the dispute is resolved. If you'd rather allow it,
it is one check in `PlanPortalService.refuseIfPaused`.

## Open

- **Who bears a dispute in pay as you go.** Decided before Cranberry Trail Inn
  goes live. See below.

## Not built

- **Who bears a dispute in pay as you go.** On a destination charge the
  platform's balance is debited for the disputed amount and Stripe's fee. Bliss
  could recover it from the hotel by reversing that payment's transfer. Not
  done automatically; for now operations decides per dispute.
- **Evidence collection.** Bliss stores the deadline but doesn't collect
  evidence; it is submitted by hand in Stripe.
- **Releases already made.** A dispute on a payment already released in hold
  mode doesn't pull it back; that falls under who bears the dispute.
- **`charge.dispute.funds_withdrawn` / `funds_reinstated`.** Not needed: the
  `updated` and `closed` events carry the status changes Bliss shows.

## Mews chargebacks (research, not built)

The Mews Connector API does expose chargebacks, but only as payments:

- A payment's `Kind` is `Payment`, `Refund`, `Chargeback` or
  `ChargebackReversal`, filled only for payments processed by Mews Payments.
- `payments/getAll` filters by `UpdatedUtc`, `ChargedUtc`, `States` and
  `SettlementUtc`; there is no filter by kind.
- A chargeback payment carries `AccountId`, `ReservationId`, `BillId`,
  `PaymentRequestId` and, as a card payment, `Data.CreditCard.CreditCardId`. The
  documentation shows no field linking it to the payment it reverses (only
  ghost payments carry an `OriginalPaymentId`).
- General webhooks include `PaymentUpdated` (no payment-added event and no
  chargeback event).

How Bliss could detect one on a Mews-charged installment: add a step to the
reconciliation pass that, per property, reads `payments/getAll` by
`UpdatedUtc` since its last run, keeps `Kind = Chargeback` (and
`ChargebackReversal`), and matches each to a plan by `ReservationId` (every
linked plan stores its reservation) and the card, then to the installment by
amount and timing, since there is no direct link. The same `plan_disputes`
record, pause and emails would then apply, with "Mews" as the source. Unverified
on a real chargeback: the sandbox can't produce one, and whether a chargeback
amount is negative and on the same reservation needs confirming with Mews or on
the first real one. `PaymentUpdated` webhooks could replace polling later.

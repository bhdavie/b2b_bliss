# Card disputes

Status: built and tested locally, **not deployed** (awaiting review).
Needed before Cranberry Trail Inn takes live payments.

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
| `BLISS_OPS_EMAIL` | Where dispute emails go, for example `bhdavie@gmail.com` |

## Dashboard steps (live mode)

1. Developers (Workbench) → Webhooks → Add destination.
2. Events from: **Your account** (not connected accounts).
3. Events: `charge.dispute.created`, `charge.dispute.updated`,
   `charge.dispute.closed`.
4. Endpoint URL: `https://api.bliss-payments.com/api/v1/stripe/platform-webhooks`.
5. Name it, for example `bliss-production-platform`, save, and copy its signing
   secret.
6. After this change is deployed, set it yourself:
   `heroku config:set STRIPE_PLATFORM_WEBHOOK_SECRET=… BLISS_OPS_EMAIL=… -a bliss-b2b-api`.
   Setting it before the deploy is harmless; nothing reads it yet.

## Not built (decisions for later)

- **Who bears a dispute in pay as you go.** On a destination charge the
  platform's balance is debited for the disputed amount and Stripe's fee. Bliss
  could recover it from the hotel by reversing that payment's transfer. Not
  done automatically; for now operations decides per dispute.
- **Evidence.** Submitted by hand in the Stripe dashboard; Bliss stores the
  deadline but doesn't collect evidence.
- **Hold mode.** A disputed payment that hasn't been released should probably
  not be released while the dispute is open. Hold mode is off; to do with D3.
- **Emailing the hotel.** Today the hotel sees the dispute in its dashboard
  only. Its copy says Bliss will be in touch.
- **`charge.dispute.funds_withdrawn` / `funds_reinstated`.** Not needed: the
  `updated` and `closed` events carry the status changes Bliss shows.

package com.bliss.b2b.integration;

import com.bliss.b2b.BlissConfiguration.StripeConfig;
import com.bliss.b2b.domain.Customer;
import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import com.stripe.model.PaymentMethod;
import com.stripe.model.Refund;
import com.stripe.model.Transfer;
import com.stripe.model.TransferReversal;
import com.stripe.param.TransferCreateParams;
import com.stripe.param.TransferReversalCollectionCreateParams;
import com.stripe.net.RequestOptions;
import com.stripe.model.SetupIntent;
import com.stripe.param.CustomerCreateParams;
import com.stripe.param.PaymentIntentCreateParams;
import com.stripe.param.PaymentMethodAttachParams;
import com.stripe.param.RefundCreateParams;
import com.stripe.param.SetupIntentCreateParams;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Card vaulting and charging via Stripe. Inert when STRIPE_SECRET_KEY is blank —
 * every call throws {@link StripeNotConfiguredException} and the public plans
 * endpoint returns 503 with an explanatory message. Same pattern as
 * {@link StripeConnectService}.
 *
 * <p>Every object here lives on the PLATFORM account. Customers, PaymentMethods
 * and PaymentIntents are never created with a Stripe-Account header, because the
 * guest's card has to be vaulted platform-side to be reusable for installments
 * 2..N off-session; a card vaulted on a connected account is siloed to that one
 * property.
 *
 * <p>The property is paid via *destination charges*: the PaymentIntent carries
 * {@code transfer_data.destination} (the connected account, resolved per
 * property by {@link StripeConnectResolver}) plus {@code application_fee_amount}
 * for the Bliss cut. A null destination means a plain platform charge with no
 * transfer and no fee.
 */
public class StripePaymentsService {

    private static final Logger log = LoggerFactory.getLogger(StripePaymentsService.class);

    private final StripeConfig config;
    /** Demo charge cap in cents; &lt;= 0 disables clamping. See BLISS_CHARGE_CAP_CENTS. */
    private final long chargeCapCents;

    public StripePaymentsService(StripeConfig config) {
        this(config, 0);
    }

    public StripePaymentsService(StripeConfig config, long chargeCapCents) {
        this.config = config;
        this.chargeCapCents = chargeCapCents;
        if (config.isConfigured()) {
            // Stripe.apiKey is a static set in StripeConnectService too; the
            // last writer wins, but both services use the same key.
            com.stripe.Stripe.apiKey = config.getSecretKey();
        }
    }

    public boolean isConfigured() {
        return config.isConfigured();
    }

    private StripeDemoPolicy demoPolicy = StripeDemoPolicy.NONE;

    /** Which properties always stay in demo mode, whatever keys are set. */
    public StripePaymentsService withDemoPolicy(StripeDemoPolicy policy) {
        this.demoPolicy = policy == null ? StripeDemoPolicy.NONE : policy;
        return this;
    }

    /**
     * Whether Stripe is real for this property: keys are set and it isn't a
     * demo property. Every merchant-scoped choice between Stripe and demo mode
     * asks this, not {@link #isConfigured()}.
     */
    public boolean isLiveFor(com.bliss.b2b.domain.Merchant merchant) {
        return isConfigured() && !demoPolicy.isDemo(merchant);
    }

    public String publishableKey() {
        return config.getPublishableKey();
    }

    /**
     * Creates a Stripe Customer for the given Bliss customer on the platform.
     * Caller is responsible for persisting the returned id.
     */
    public String createStripeCustomer(Customer customer) throws StripeException {
        requireConfigured();
        CustomerCreateParams params = CustomerCreateParams.builder()
                .setEmail(customer.email())
                .setName(joinName(customer.firstName(), customer.lastName()))
                .setMetadata(Map.of("bliss_customer_id", customer.id().toString()))
                .build();
        com.stripe.model.Customer stripeCustomer = com.stripe.model.Customer.create(params);
        log.info("Created Stripe Customer {} for bliss customer {}",
                stripeCustomer.getId(), customer.id());
        return stripeCustomer.getId();
    }

    /**
     * Attaches a PaymentMethod (collected client-side via Stripe Elements against
     * the platform publishable key) to the given platform Stripe Customer.
     * Returns the up-to-date PaymentMethod so the caller can read brand/last4/exp.
     */
    public PaymentMethod attachPaymentMethod(String paymentMethodId, String stripeCustomerId)
            throws StripeException {
        requireConfigured();
        refuseDemoIds(paymentMethodId, stripeCustomerId);
        PaymentMethod pm = PaymentMethod.retrieve(paymentMethodId);
        if (pm.getCustomer() == null || !pm.getCustomer().equals(stripeCustomerId)) {
            pm = pm.attach(PaymentMethodAttachParams.builder()
                    .setCustomer(stripeCustomerId)
                    .build());
        }
        return pm;
    }

    /**
     * Charges a payment on the platform account, optionally routing the funds to
     * a property's connected account as a destination charge. Throws on Stripe
     * error including card decline (CardException). Caller wraps in a transaction
     * so a decline rolls back the plan.
     *
     * <p>{@code currency} is the booking's ISO code and is required: there is
     * no default currency.
     *
     * <p>{@code idempotencyKey} should be the PaymentSchedule row id so a retry
     * on the same row does not double-charge.
     *
     * <p>{@code sessionMode} picks between the two mutually exclusive Stripe
     * flags: the checkout charge vaults the card with {@code setup_future_usage},
     * every later installment charges it with {@code off_session=true}. Stripe
     * rejects the two together, which is why this is a choice and not both.
     */
    public PaymentIntent firePaymentOffSession(
            long amountCents,
            String currency,
            String stripeCustomerId,
            String paymentMethodId,
            String idempotencyKey,
            Map<String, String> metadata,
            Destination destination,
            SessionMode sessionMode
    ) throws StripeException {
        requireConfigured();
        refuseDemoIds(stripeCustomerId, paymentMethodId);
        if (destination != null) {
            refuseDemoAccount(destination.accountId());
            refuseDemoAccount(destination.onBehalfOf());
        }
        // Demo cap: clamp only the amount sent to Stripe. The schedule row, plan
        // math, and the returned PaymentIntent metadata keep the real amount.
        long chargeAmount = capCharge(amountCents);
        PaymentIntentCreateParams.Builder params = PaymentIntentCreateParams.builder()
                .setAmount(chargeAmount)
                // The booking's currency; amountCents is in its minor units,
                // which is what Stripe expects (whole yen for JPY).
                .setCurrency(com.bliss.b2b.payments.Money.code(currency).toLowerCase(java.util.Locale.ROOT))
                .setCustomer(stripeCustomerId)
                .setPaymentMethod(paymentMethodId)
                .setConfirm(true)
                .setAutomaticPaymentMethods(
                        PaymentIntentCreateParams.AutomaticPaymentMethods.builder()
                                .setEnabled(true)
                                .setAllowRedirects(
                                        PaymentIntentCreateParams.AutomaticPaymentMethods
                                                .AllowRedirects.NEVER)
                                .build())
                .putAllMetadata(metadata);
        if (sessionMode == SessionMode.OFF_SESSION) {
            params.setOffSession(true);
        } else {
            params.setSetupFutureUsage(PaymentIntentCreateParams.SetupFutureUsage.OFF_SESSION);
        }
        route(params, destination, chargeAmount);
        RequestOptions opts = RequestOptions.builder()
                .setIdempotencyKey(idempotencyKey)
                .build();
        return PaymentIntent.create(params.build(), opts);
    }

    /**
     * Bliss's cut of a charge, in whole cents, rounded half-up. Computed from the
     * amount actually sent to Stripe (post demo cap) so the fee can never exceed
     * the charge; clamped to the charge amount as a final guard, since Stripe
     * rejects an application fee larger than the payment.
     */
    public static long applicationFeeCents(long chargeAmountCents, BigDecimal feeFraction) {
        if (feeFraction == null || feeFraction.signum() <= 0 || chargeAmountCents <= 0) {
            return 0;
        }
        long fee = BigDecimal.valueOf(chargeAmountCents)
                .multiply(feeFraction)
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();
        return Math.min(fee, chargeAmountCents);
    }

    /**
     * Routes a charge. Pay as you go: a destination charge, the funds
     * transferred to the property at once less Bliss's application fee. Hold
     * mode: a charge on the platform {@code on_behalf_of} the property (so it is
     * the merchant of record, D2) with the booking as {@code transfer_group};
     * nothing is transferred and no fee is taken, because the money stays in the
     * platform balance until a release transfers it, less the fee (spec 2.2).
     */
    static void route(PaymentIntentCreateParams.Builder params, Destination destination, long chargeAmount) {
        if (destination == null) {
            return;
        }
        if (destination.isHold()) {
            params.setOnBehalfOf(destination.onBehalfOf());
            params.setTransferGroup(destination.transferGroup());
            return;
        }
        if (destination.hasAccount()) {
            params.setTransferData(PaymentIntentCreateParams.TransferData.builder()
                    .setDestination(destination.accountId())
                    .build());
            long fee = applicationFeeCents(chargeAmount, destination.feeFraction());
            if (fee > 0) {
                params.setApplicationFeeAmount(fee);
            }
        }
    }

    /**
     * Backstop for demo properties: a synthetic customer or card id means a
     * demo property's plan reached a real Stripe call, which must never charge.
     */
    static void refuseDemoIds(String... ids) {
        for (String id : ids) {
            if (StripeDemoPolicy.isDemoId(id)) {
                throw new IllegalStateException("demo id " + id + " never reaches Stripe");
            }
        }
    }

    static void refuseDemoAccount(String accountId) {
        if (StripeDemoPolicy.isDemoAccount(accountId)) {
            throw new IllegalStateException("demo account " + accountId + " never reaches Stripe");
        }
    }

    /**
     * Where a charge's funds go and what Bliss keeps. {@code accountId} is the
     * property's connected Standard account; {@code feeFraction} is its
     * {@code bliss_fee_percentage} (0.03 = 3%). A null Destination, or one with a
     * blank account, means a plain platform charge with no transfer and no fee.
     *
     * <p>A hold-mode booking instead carries {@code onBehalfOf} (the property's
     * Express account, D6) and {@code transferGroup} (the booking id); see
     * {@link #route}.
     */
    public record Destination(String accountId, BigDecimal feeFraction, String onBehalfOf, String transferGroup) {
        public Destination(String accountId, BigDecimal feeFraction) {
            this(accountId, feeFraction, null, null);
        }

        /** A hold-mode charge for the property's Express account. */
        public static Destination hold(String expressAccountId, BigDecimal feeFraction, java.util.UUID bookingId) {
            if (expressAccountId == null || expressAccountId.isBlank()) {
                throw new IllegalStateException("hold mode needs the property's Express account");
            }
            return new Destination(null, feeFraction, expressAccountId, "booking_" + bookingId);
        }

        public boolean hasAccount() {
            return accountId != null && !accountId.isBlank();
        }

        public boolean isHold() {
            return onBehalfOf != null && !onBehalfOf.isBlank();
        }
    }

    /**
     * Hold mode release: transfers {@code amountMinor} from the platform
     * balance to the property's connected account. {@code idempotencyKey} is
     * the release row, so a retried release never transfers twice.
     */
    public Transfer transferToProperty(String accountId, long amountMinor, String currency, String transferGroup,
            String idempotencyKey, Map<String, String> metadata) throws StripeException {
        requireConfigured();
        refuseDemoAccount(accountId);
        TransferCreateParams params = TransferCreateParams.builder()
                .setAmount(capCharge(amountMinor))
                .setCurrency(currency.toLowerCase(java.util.Locale.ROOT))
                .setDestination(accountId)
                .setTransferGroup(transferGroup)
                .putAllMetadata(metadata)
                .build();
        return Transfer.create(params, RequestOptions.builder().setIdempotencyKey(idempotencyKey).build());
    }

    /**
     * Hold mode, D9: Bliss never gives its fee back, so when a refund leaves
     * less than the fee the property funds the rest. An account debit: a
     * transfer made on the property's Express account to the platform. Stripe
     * draws it from the account's balance; Bliss's Express accounts have
     * {@code debit_negative_balances} on, so a balance it takes below zero is
     * pulled from the hotel's bank. If Stripe still refuses, ReleaseService
     * logs it for an admin to collect by hand.
     */
    public Transfer debitPropertyAccount(String accountId, long amountMinor, String currency, String idempotencyKey)
            throws StripeException {
        requireConfigured();
        refuseDemoAccount(accountId);
        String platform = com.stripe.model.Account.retrieve().getId();
        TransferCreateParams params = TransferCreateParams.builder()
                .setAmount(amountMinor)
                .setCurrency(currency.toLowerCase(java.util.Locale.ROOT))
                .setDestination(platform)
                .putMetadata("bliss_source", "fee_on_refund")
                .build();
        return Transfer.create(params, RequestOptions.builder()
                .setStripeAccount(accountId).setIdempotencyKey(idempotencyKey).build());
    }

    /**
     * Hold mode cancellation: pulls {@code amountMinor} of a release back from
     * the property into the platform balance, so the guest's refund is funded.
     */
    public TransferReversal reverseTransfer(String transferId, long amountMinor, String idempotencyKey)
            throws StripeException {
        requireConfigured();
        Transfer transfer = Transfer.retrieve(transferId);
        TransferReversalCollectionCreateParams params = TransferReversalCollectionCreateParams.builder()
                .setAmount(amountMinor)
                .putMetadata("bliss_source", "plan_cancellation")
                .build();
        return transfer.getReversals().create(params,
                RequestOptions.builder().setIdempotencyKey(idempotencyKey).build());
    }

    /** Whether the cardholder is present, which decides the Stripe flag used. */
    public enum SessionMode {
        /** Guest is completing checkout now; vault the card for later installments. */
        ON_SESSION_VAULT,
        /** No guest present; charge the already-vaulted card. */
        OFF_SESSION
    }

    /**
     * Creates a SetupIntent on the platform the frontend can confirm with Stripe
     * Elements to vault a new card for off-session future charges. Used by the
     * portal's Update-card flow. Demo mode never calls this — see
     * PlanPortalService.
     */
    public SetupIntent createSetupIntent(String stripeCustomerId) throws StripeException {
        requireConfigured();
        refuseDemoIds(stripeCustomerId);
        SetupIntentCreateParams params = SetupIntentCreateParams.builder()
                .setCustomer(stripeCustomerId)
                .setUsage(SetupIntentCreateParams.Usage.OFF_SESSION)
                .addPaymentMethodType("card")
                .build();
        return SetupIntent.create(params);
    }

    public static CardSummary summarize(PaymentMethod pm) {
        PaymentMethod.Card card = pm.getCard();
        if (card == null) {
            return new CardSummary("", 0, 0, "card");
        }
        return new CardSummary(
                card.getLast4() == null ? "" : card.getLast4(),
                card.getExpMonth() == null ? 0 : card.getExpMonth().intValue(),
                card.getExpYear() == null ? 0 : card.getExpYear().intValue(),
                card.getBrand() == null ? "card" : card.getBrand());
    }

    private static String joinName(String first, String last) {
        StringBuilder sb = new StringBuilder();
        if (first != null && !first.isBlank()) sb.append(first.trim());
        if (last != null && !last.isBlank()) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(last.trim());
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    private void requireConfigured() {
        if (!isConfigured()) {
            throw new StripeNotConfiguredException();
        }
    }

    /** Clamps to the demo charge cap when one is set; logs a single line on clamp. */
    private long capCharge(long amountCents) {
        if (chargeCapCents > 0 && amountCents > chargeCapCents) {
            log.info("charge capped: {} -> {}", amountCents, chargeCapCents);
            return chargeCapCents;
        }
        return amountCents;
    }

    public record CardSummary(String lastFour, int expMonth, int expYear, String brand) {}

    /**
     * Refunds up to {@code amountMinor} of a PaymentIntent, in its own
     * currency's minor units, never more than the intent actually collected
     * (the demo charge cap can collect less than the schedule row says).
     *
     * <p>Bliss keeps its fee on refunds. On a destination charge the refund
     * reverses the transfer, taking the refunded amount back from the
     * property's connected account, and does not refund Bliss's application
     * fee; so the property, not Bliss, funds the part of the refund that was
     * Bliss's fee.
     *
     * <p>{@code idempotencyKey} makes a repeated cancellation return the same
     * refund instead of refunding twice. Returns the refund Stripe created.
     */
    public Refund refundPaymentIntent(String paymentIntentId, long amountMinor, String idempotencyKey)
            throws StripeException {
        requireConfigured();
        refuseDemoIds(paymentIntentId);
        PaymentIntent intent = PaymentIntent.retrieve(paymentIntentId);
        long collected = intent.getAmountReceived() == null ? 0L : intent.getAmountReceived();
        RefundCreateParams params = refundParams(
                paymentIntentId, amountMinor, collected, intent.getTransferData() != null);
        return Refund.create(params, RequestOptions.builder().setIdempotencyKey(idempotencyKey).build());
    }

    /** The refund request {@link #refundPaymentIntent} sends; separate so its terms are testable. */
    static RefundCreateParams refundParams(
            String paymentIntentId, long amountMinor, long collectedMinor, boolean destinationCharge) {
        RefundCreateParams.Builder params = RefundCreateParams.builder()
                .setPaymentIntent(paymentIntentId)
                .setAmount(Math.min(amountMinor, collectedMinor))
                .putMetadata("bliss_source", "plan_cancellation");
        if (destinationCharge) {
            params.setReverseTransfer(true).setRefundApplicationFee(false);
        }
        return params.build();
    }
}

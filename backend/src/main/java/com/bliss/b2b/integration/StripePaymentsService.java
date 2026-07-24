package com.bliss.b2b.integration;

import com.bliss.b2b.BlissConfiguration.StripeConfig;
import com.bliss.b2b.domain.Customer;
import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import com.stripe.model.PaymentMethod;
import com.stripe.net.RequestOptions;
import com.stripe.model.SetupIntent;
import com.stripe.param.CustomerCreateParams;
import com.stripe.param.PaymentIntentCreateParams;
import com.stripe.param.PaymentMethodAttachParams;
import com.stripe.param.SetupIntentCreateParams;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Card vaulting and charging via Stripe. Inert when STRIPE_SECRET_KEY is blank —
 * every call throws {@link StripeNotConfiguredException} and the public plans
 * endpoint returns 503 with an explanatory message. Same pattern as
 * {@link StripeConnectService}.
 *
 * <p>Every operation optionally targets a Connect *Standard* connected account:
 * pass a non-null {@code connectedAccountId} and the call runs on that account
 * (Stripe-Account header), so it becomes a direct charge / account-scoped object
 * with the property as merchant of record. Pass {@code null} (the legacy
 * signatures do) and the call runs on the platform exactly as before. The
 * connected account is resolved per property by {@link StripeConnectResolver}.
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

    public String publishableKey() {
        return config.getPublishableKey();
    }

    /**
     * Creates a Stripe Customer for the given Bliss customer on the platform.
     * Caller is responsible for persisting the returned id.
     */
    public String createStripeCustomer(Customer customer) throws StripeException {
        return createStripeCustomer(customer, null);
    }

    /**
     * Creates a Stripe Customer for the given Bliss customer. When
     * {@code connectedAccountId} is non-null the Customer is created on that
     * connected Standard account (so it can be charged there via direct charges);
     * otherwise it is created on the platform (legacy behavior).
     */
    public String createStripeCustomer(Customer customer, String connectedAccountId) throws StripeException {
        requireConfigured();
        CustomerCreateParams params = CustomerCreateParams.builder()
                .setEmail(customer.email())
                .setName(joinName(customer.firstName(), customer.lastName()))
                .setMetadata(Map.of("bliss_customer_id", customer.id().toString()))
                .build();
        com.stripe.model.Customer stripeCustomer =
                com.stripe.model.Customer.create(params, accountOptions(connectedAccountId));
        log.info("Created Stripe Customer {} for bliss customer {}{}",
                stripeCustomer.getId(), customer.id(),
                connectedAccountId == null ? "" : " on account " + connectedAccountId);
        return stripeCustomer.getId();
    }

    /**
     * Attaches a PaymentMethod (collected client-side via Stripe Elements) to
     * the given Stripe Customer on the platform. Returns the up-to-date
     * PaymentMethod so the caller can read brand/last4/exp.
     */
    public PaymentMethod attachPaymentMethod(String paymentMethodId, String stripeCustomerId)
            throws StripeException {
        return attachPaymentMethod(paymentMethodId, stripeCustomerId, null);
    }

    /**
     * Attaches a PaymentMethod to the given Stripe Customer. When
     * {@code connectedAccountId} is non-null both the retrieve and the attach run
     * on that connected Standard account, so the PaymentMethod (collected against
     * the same account client-side) is attached where it will be charged.
     */
    public PaymentMethod attachPaymentMethod(
            String paymentMethodId, String stripeCustomerId, String connectedAccountId)
            throws StripeException {
        requireConfigured();
        RequestOptions opts = accountOptions(connectedAccountId);
        PaymentMethod pm = PaymentMethod.retrieve(paymentMethodId, opts);
        if (pm.getCustomer() == null || !pm.getCustomer().equals(stripeCustomerId)) {
            pm = pm.attach(PaymentMethodAttachParams.builder()
                    .setCustomer(stripeCustomerId)
                    .build(), opts);
        }
        return pm;
    }

    /**
     * Fires the initial deposit payment on-session (the customer is actively
     * completing the checkout form) and vaults the PaymentMethod for future
     * off-session installment charges via {@code setup_future_usage}. Returns
     * the resulting PaymentIntent. Throws on Stripe error including card
     * decline (CardException). Caller wraps in a transaction so a decline rolls
     * back the plan.
     *
     * <p>{@code idempotencyKey} should be the PaymentSchedule row id so a
     * retry on the same row does not double-charge.
     *
     * <p>Stripe rejects {@code off_session=true} combined with
     * {@code setup_future_usage}, so we omit off_session here. A separate
     * code path (future scheduled-charges job) handles off-session
     * installments against the saved PaymentMethod.
     */
    public PaymentIntent firePaymentOffSession(
            long amountCents,
            String stripeCustomerId,
            String paymentMethodId,
            String idempotencyKey,
            Map<String, String> metadata
    ) throws StripeException {
        return firePaymentOffSession(amountCents, stripeCustomerId, paymentMethodId,
                idempotencyKey, metadata, null);
    }

    /**
     * Charges a payment against the saved PaymentMethod. When
     * {@code connectedAccountId} is non-null the PaymentIntent is created on that
     * connected Standard account, making it a direct charge with the property as
     * merchant of record; otherwise it runs on the platform (legacy behavior).
     */
    public PaymentIntent firePaymentOffSession(
            long amountCents,
            String stripeCustomerId,
            String paymentMethodId,
            String idempotencyKey,
            Map<String, String> metadata,
            String connectedAccountId
    ) throws StripeException {
        requireConfigured();
        // Demo cap: clamp only the amount sent to Stripe. The schedule row, plan
        // math, and the returned PaymentIntent metadata keep the real amount.
        long chargeAmount = capCharge(amountCents);
        PaymentIntentCreateParams params = PaymentIntentCreateParams.builder()
                .setAmount(chargeAmount)
                .setCurrency("usd")
                .setCustomer(stripeCustomerId)
                .setPaymentMethod(paymentMethodId)
                .setConfirm(true)
                .setSetupFutureUsage(PaymentIntentCreateParams.SetupFutureUsage.OFF_SESSION)
                .setAutomaticPaymentMethods(
                        PaymentIntentCreateParams.AutomaticPaymentMethods.builder()
                                .setEnabled(true)
                                .setAllowRedirects(
                                        PaymentIntentCreateParams.AutomaticPaymentMethods
                                                .AllowRedirects.NEVER)
                                .build())
                .putAllMetadata(metadata)
                .build();
        RequestOptions.RequestOptionsBuilder optsBuilder = RequestOptions.builder()
                .setIdempotencyKey(idempotencyKey);
        if (connectedAccountId != null && !connectedAccountId.isBlank()) {
            optsBuilder.setStripeAccount(connectedAccountId);
        }
        return PaymentIntent.create(params, optsBuilder.build());
    }

    /**
     * Creates a SetupIntent the frontend can confirm with Stripe Elements to
     * vault a new card for off-session future charges. Used by the portal's
     * Update-card flow. Demo mode never calls this — see PlanPortalService.
     */
    public SetupIntent createSetupIntent(String stripeCustomerId) throws StripeException {
        return createSetupIntent(stripeCustomerId, null);
    }

    /**
     * Creates a SetupIntent on the platform, or on {@code connectedAccountId}
     * when non-null so the vaulted card lands on the account it will be charged
     * against.
     */
    public SetupIntent createSetupIntent(String stripeCustomerId, String connectedAccountId)
            throws StripeException {
        requireConfigured();
        SetupIntentCreateParams params = SetupIntentCreateParams.builder()
                .setCustomer(stripeCustomerId)
                .setUsage(SetupIntentCreateParams.Usage.OFF_SESSION)
                .addPaymentMethodType("card")
                .build();
        return SetupIntent.create(params, accountOptions(connectedAccountId));
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

    /**
     * RequestOptions targeting a connected Standard account, or null when
     * {@code connectedAccountId} is null/blank (platform call). A null return
     * makes Stripe's {@code (params)} and {@code (params, null)} calls identical,
     * so the platform path is byte-for-byte the legacy behavior.
     */
    private static RequestOptions accountOptions(String connectedAccountId) {
        if (connectedAccountId == null || connectedAccountId.isBlank()) {
            return null;
        }
        return RequestOptions.builder().setStripeAccount(connectedAccountId).build();
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
}

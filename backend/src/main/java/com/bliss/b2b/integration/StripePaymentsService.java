package com.bliss.b2b.integration;

import com.bliss.b2b.BlissConfiguration.StripeConfig;
import com.bliss.b2b.domain.Customer;
import com.stripe.exception.StripeException;
import com.stripe.model.PaymentIntent;
import com.stripe.model.PaymentMethod;
import com.stripe.net.RequestOptions;
import com.stripe.param.CustomerCreateParams;
import com.stripe.param.PaymentIntentCreateParams;
import com.stripe.param.PaymentMethodAttachParams;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Card vaulting and charging via Stripe (not Connect; this is the platform
 * side). Inert when STRIPE_SECRET_KEY is blank — every call throws
 * {@link StripeNotConfiguredException} and the public plans endpoint returns
 * 503 with an explanatory message. Same pattern as {@link StripeConnectService}.
 */
public class StripePaymentsService {

    private static final Logger log = LoggerFactory.getLogger(StripePaymentsService.class);

    private final StripeConfig config;

    public StripePaymentsService(StripeConfig config) {
        this.config = config;
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
     * Creates a Stripe Customer for the given Bliss customer. Caller is
     * responsible for persisting the returned id.
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
     * Attaches a PaymentMethod (collected client-side via Stripe Elements) to
     * the given Stripe Customer. Returns the up-to-date PaymentMethod so the
     * caller can read brand/last4/exp.
     */
    public PaymentMethod attachPaymentMethod(String paymentMethodId, String stripeCustomerId)
            throws StripeException {
        requireConfigured();
        PaymentMethod pm = PaymentMethod.retrieve(paymentMethodId);
        if (pm.getCustomer() == null || !pm.getCustomer().equals(stripeCustomerId)) {
            pm = pm.attach(PaymentMethodAttachParams.builder()
                    .setCustomer(stripeCustomerId)
                    .build());
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
        requireConfigured();
        PaymentIntentCreateParams params = PaymentIntentCreateParams.builder()
                .setAmount(amountCents)
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
        RequestOptions opts = RequestOptions.builder()
                .setIdempotencyKey(idempotencyKey)
                .build();
        return PaymentIntent.create(params, opts);
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

    public record CardSummary(String lastFour, int expMonth, int expYear, String brand) {}
}

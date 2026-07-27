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
            String stripeCustomerId,
            String paymentMethodId,
            String idempotencyKey,
            Map<String, String> metadata,
            Destination destination,
            SessionMode sessionMode
    ) throws StripeException {
        requireConfigured();
        // Demo cap: clamp only the amount sent to Stripe. The schedule row, plan
        // math, and the returned PaymentIntent metadata keep the real amount.
        long chargeAmount = capCharge(amountCents);
        PaymentIntentCreateParams.Builder params = PaymentIntentCreateParams.builder()
                .setAmount(chargeAmount)
                .setCurrency("usd")
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
        if (destination != null && destination.hasAccount()) {
            params.setTransferData(PaymentIntentCreateParams.TransferData.builder()
                    .setDestination(destination.accountId())
                    .build());
            long fee = applicationFeeCents(chargeAmount, destination.feeFraction());
            if (fee > 0) {
                params.setApplicationFeeAmount(fee);
            }
        }
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
    static long applicationFeeCents(long chargeAmountCents, BigDecimal feeFraction) {
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
     * Where a charge's funds go and what Bliss keeps. {@code accountId} is the
     * property's connected Standard account; {@code feeFraction} is its
     * {@code bliss_fee_percentage} (0.03 = 3%). A null Destination, or one with a
     * blank account, means a plain platform charge with no transfer and no fee.
     */
    public record Destination(String accountId, BigDecimal feeFraction) {
        public boolean hasAccount() {
            return accountId != null && !accountId.isBlank();
        }
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
}

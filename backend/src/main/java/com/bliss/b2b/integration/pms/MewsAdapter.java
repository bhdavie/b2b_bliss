package com.bliss.b2b.integration.pms;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
import com.bliss.b2b.payments.Money;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * {@link PmsAdapter} over the Mews Connector API. Built on the JDK
 * {@link HttpClient} + Jackson so it adds no dependency. It covers the PMS
 * payment rail (configuration, customers, stored cards) and does not touch any
 * Stripe code.
 *
 * <p>All Mews calls are POST with {@code ClientToken}, {@code AccessToken} and
 * {@code Client} in the JSON body. The {@code Client} string is
 * {@value #CLIENT}.
 *
 * <p>Money moves through {@link #chargeStoredCard} only. The reservation
 * calls never attach a card, so Mews itself never charges one.
 */
public class MewsAdapter implements PmsAdapter {

    private static final Logger log = LoggerFactory.getLogger(MewsAdapter.class);

    /**
     * Sent as {@code Client} on every call. Mews asks for "Name Version" and a
     * name unique to the integration: certification reviews demo traffic by
     * this string, so keep it in one place and bump the version on releases.
     */
    static final String CLIENT = "Bliss Payments 1.0.0";

    private static final String CONFIGURATION_GET = "/api/connector/v1/configuration/get";
    private static final String CUSTOMERS_GET_ALL = "/api/connector/v1/customers/getAll";
    private static final String CREDIT_CARDS_GET_ALL = "/api/connector/v1/creditCards/getAll";
    private static final String CREDIT_CARDS_CHARGE = "/api/connector/v1/creditCards/charge";
    private static final String PAYMENTS_GET_ALL = "/api/connector/v1/payments/getAll";
    private static final String SERVICES_GET_ALL = "/api/connector/v1/services/getAll";
    private static final String RATES_GET_ALL = "/api/connector/v1/rates/getAll";
    private static final String RESERVATIONS_CANCEL = "/api/connector/v1/reservations/cancel";
    private static final String RESERVATIONS_GET_ALL = "/api/connector/v1/reservations/getAll/2023-06-06";
    private static final String ORDER_ITEMS_GET_ALL = "/api/connector/v1/orderItems/getAll";
    private static final String CANCELLATION_POLICIES_GET_ALL = "/api/connector/v1/cancellationPolicies/getAll";
    private static final String ORDERS_ADD = "/api/connector/v1/orders/add";
    private static final String PAYMENTS_ADD_EXTERNAL = "/api/connector/v1/payments/addExternal";

    /** Pages followed per catalogue list call; a small property never gets near it. */
    private static final int MAX_PAGES = 10;

    /** Cap on rows pulled per list call; a demo property holds far fewer. */
    private static final int PAGE_LIMIT = 100;


    private final MewsPmsConfig config;
    private final HttpClient http;
    private final ObjectMapper mapper;
    /** Demo charge cap in cents; &lt;= 0 disables clamping. See BLISS_CHARGE_CAP_CENTS. */
    private final long chargeCapCents;

    public MewsAdapter(MewsPmsConfig config) {
        this(config, 0);
    }

    public MewsAdapter(MewsPmsConfig config, long chargeCapCents) {
        this(config,
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build(),
                // Decimals as BigDecimal, never double: prices from
                // reservations/price go straight into plan totals.
                new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS),
                chargeCapCents);
    }

    MewsAdapter(MewsPmsConfig config, HttpClient http, ObjectMapper mapper) {
        this(config, http, mapper, 0);
    }

    MewsAdapter(MewsPmsConfig config, HttpClient http, ObjectMapper mapper, long chargeCapCents) {
        this.config = config;
        this.http = http;
        this.mapper = mapper;
        this.chargeCapCents = chargeCapCents;
    }

    @Override
    public PmsPropertyConfiguration getPropertyConfiguration() {
        JsonNode root = post(CONFIGURATION_GET, auth());
        JsonNode enterprise = root.path("Enterprise");
        JsonNode address = enterprise.path("Address");
        return new PmsPropertyConfiguration(
                textOrNull(enterprise, "Id"),
                textOrNull(enterprise, "Name"),
                defaultCurrency(enterprise.path("Currencies")),
                textOrNull(address, "CountryCode"),
                textOrNull(enterprise, "Pricing"),
                textOrNull(enterprise, "TimeZoneIdentifier"),
                textOrNull(enterprise, "DefaultLanguageCode"));
    }

    @Override
    public PmsCustomer findOrCreateCustomer(PmsCustomerRef ref) {
        // Search only: the name is kept for the PmsAdapter contract.
        if (ref == null || ref.email() == null || ref.email().isBlank()) {
            throw new PmsAdapterException("findOrCreateCustomer requires an email to search on");
        }

        Map<String, Object> searchBody = auth();
        searchBody.put("Extent", Map.of("Customers", true));
        searchBody.put("Emails", List.of(ref.email()));
        searchBody.put("Limitation", Map.of("Count", PAGE_LIMIT));

        JsonNode found = post(CUSTOMERS_GET_ALL, searchBody).path("Customers");
        if (found.isArray()) {
            for (JsonNode c : found) {
                if (ref.email().equalsIgnoreCase(textOrNull(c, "Email"))) {
                    log.info("Mews customer match for {} -> {}", ref.email(), textOrNull(c, "Id"));
                    return toCustomer(c);
                }
            }
        }

        // Bliss no longer creates Mews customers: the guest's profile is made
        // by the booking engine. Search only.
        throw new PmsNotSupportedException(
                "No Mews customer with email " + ref.email() + "; Bliss does not create Mews customers");
    }

    @Override
    public List<PmsStoredCard> getStoredCards(String pmsCustomerId) {
        if (pmsCustomerId == null || pmsCustomerId.isBlank()) {
            throw new PmsAdapterException("getStoredCards requires a customer id");
        }
        Map<String, Object> body = auth();
        body.put("CustomerIds", List.of(pmsCustomerId));
        body.put("Limitation", Map.of("Count", PAGE_LIMIT));

        JsonNode cards = post(CREDIT_CARDS_GET_ALL, body).path("CreditCards");
        List<PmsStoredCard> out = new ArrayList<>();
        if (cards.isArray()) {
            for (JsonNode card : cards) {
                out.add(toCard(card));
            }
        }
        return out;
    }

    @Override
    public PmsChargeResult chargeStoredCard(
            String pmsCustomerId,
            String pmsCardId,
            long amountMinorUnits,
            String currency,
            String reservationRef,
            String notes) {
        if (pmsCustomerId == null || pmsCustomerId.isBlank()) {
            throw new PmsAdapterException("chargeStoredCard requires a customer id");
        }
        if (pmsCardId == null || pmsCardId.isBlank()) {
            throw new PmsAdapterException("chargeStoredCard requires a card id");
        }
        if (amountMinorUnits <= 0) {
            throw new PmsAdapterException("chargeStoredCard requires a positive amount");
        }
        if (currency == null || currency.isBlank()) {
            throw new PmsAdapterException("chargeStoredCard requires a currency");
        }

        // Demo cap: clamp only the amount actually charged. The returned
        // PmsChargeResult echoes the real amountMinorUnits below.
        long chargeAmount = amountMinorUnits;
        if (chargeCapCents > 0 && chargeAmount > chargeCapCents) {
            log.info("charge capped: {} -> {}", chargeAmount, chargeCapCents);
            chargeAmount = chargeCapCents;
        }

        Map<String, Object> body = auth();
        body.put("CreditCardId", pmsCardId);
        body.put("Amount", Map.of(
                "Currency", currency,
                "GrossValue", toGrossValue(chargeAmount, currency)));
        if (reservationRef != null && !reservationRef.isBlank()) {
            body.put("ReservationId", reservationRef);
        }
        if (notes != null && !notes.isBlank()) {
            body.put("Notes", notes);
        }

        // Mews reports a charge the gateway will not take as HTTP 403, not as a
        // Failed payment: "Transaction was declined (Refused)." for a refusal,
        // "Credit card payment failed." when the gateway cannot process it at
        // all. Every 403 from this call is treated as a decline and returned
        // as one, so callers apply their decline handling (release the
        // checkout hold, count a retry). Mews's own wording is kept in
        // rawState for logs and schedule notes, never shown to a guest.
        // Other non-2xx responses (5xx, timeouts) still throw: they say
        // nothing about the card, so nothing is recorded against it.
        JsonNode charge;
        try {
            charge = post(CREDIT_CARDS_CHARGE, body);
        } catch (PmsAdapterException e) {
            if (!isDecline(e)) {
                throw e;
            }
            String reason = declineReason(e.pmsMessage());
            log.warn("Mews charge of {} {} on card {} (reservation {}) refused: {}",
                    toGrossValue(chargeAmount, currency), currency, pmsCardId, reservationRef, e.getMessage());
            return new PmsChargeResult(null, PmsChargeStatus.FAILED, reason, amountMinorUnits, currency);
        }
        String paymentId = textOrNull(charge, "PaymentId");
        if (paymentId == null || paymentId.isBlank()) {
            throw new PmsAdapterException(
                    "Mews accepted the charge but returned no PaymentId for card " + pmsCardId);
        }
        log.info("Charged Mews card {} -> payment {}", pmsCardId, paymentId);

        // The charge response carries no state; read it back so a Failed/Canceled
        // settlement surfaces as a status rather than looking like a success.
        String rawState = readPaymentState(paymentId);
        PmsChargeStatus status = PmsChargeStatus.fromMewsState(rawState);
        log.info("Mews payment {} state={} ({})", paymentId, rawState, status);
        return new PmsChargeResult(paymentId, status, rawState, amountMinorUnits, currency);
    }

    /**
     * Reads the current settlement state for a batch of Mews payments via
     * payments/getAll, returning each found payment's id mapped to its
     * {@link PmsChargeStatus}. Ids Mews does not return (unknown to the property)
     * are omitted, so the caller can leave those rows in flight rather than
     * guessing. States fold to the same enum {@link #chargeStoredCard} uses, so
     * downstream mapping is shared: Charged -&gt; charged/paid, Failed/Canceled
     * -&gt; failed, Pending/Verifying/unknown -&gt; still pending.
     *
     * <p>This is a read-only query; it moves no money. Pass at most
     * {@value #PAGE_LIMIT} ids per call — the reconciliation service chunks
     * larger sets.
     */
    public Map<String, PmsChargeStatus> getPayments(List<String> paymentIds) {
        if (paymentIds == null || paymentIds.isEmpty()) {
            return Map.of();
        }
        Map<String, Object> body = auth();
        body.put("PaymentIds", List.copyOf(paymentIds));
        body.put("Limitation", Map.of("Count", Math.max(paymentIds.size(), 1)));

        JsonNode payments = post(PAYMENTS_GET_ALL, body).path("Payments");
        Map<String, PmsChargeStatus> out = new LinkedHashMap<>();
        if (payments.isArray()) {
            for (JsonNode p : payments) {
                String id = textOrNull(p, "Id");
                if (id == null) {
                    continue;
                }
                out.put(id, PmsChargeStatus.fromMewsState(textOrNull(p, "State")));
            }
        }
        return out;
    }

    /** Any HTTP 403 from creditCards/charge: the gateway would not take the charge. */
    static boolean isDecline(PmsAdapterException e) {
        return e.httpStatus() == 403;
    }

    /**
     * A short reason for logs and schedule notes: the gateway's refusal code
     * when Mews gives one ("Transaction was declined (Refused)." -> "Refused"),
     * otherwise Mews's message, otherwise "Declined".
     */
    static String declineReason(String pmsMessage) {
        if (pmsMessage == null || pmsMessage.isBlank()) {
            return "Declined";
        }
        int open = pmsMessage.indexOf('(');
        int close = pmsMessage.indexOf(')', open + 1);
        if (open >= 0 && close > open + 1) {
            return pmsMessage.substring(open + 1, close).trim();
        }
        return pmsMessage.trim();
    }

    /** The {@code Message} field of a Mews error body, or null if it has none. */
    private String errorMessage(String body) {
        try {
            JsonNode node = mapper.readTree(body == null ? "" : body);
            return node == null ? null : textOrNull(node, "Message");
        } catch (IOException e) {
            return null;
        }
    }

    /** Reads a single payment's {@code State} via payments/getAll, or null. */
    private String readPaymentState(String paymentId) {
        Map<String, Object> body = auth();
        body.put("PaymentIds", List.of(paymentId));
        body.put("Limitation", Map.of("Count", 1));

        JsonNode payments = post(PAYMENTS_GET_ALL, body).path("Payments");
        if (payments.isArray()) {
            for (JsonNode p : payments) {
                if (paymentId.equals(textOrNull(p, "Id"))) {
                    return textOrNull(p, "State");
                }
            }
        }
        return null;
    }

    // --- Catalogue (booking setup) ------------------------------------------

    /** Every bookable (stay) service on the enterprise, active or not. */
    public List<MewsCatalog.Service> getBookableServices() {
        List<MewsCatalog.Service> out = new ArrayList<>();
        for (JsonNode s : getAllPaged(SERVICES_GET_ALL, auth(), "Services")) {
            JsonNode data = s.path("Data");
            if (!"Bookable".equals(textOrNull(data, "Discriminator"))) {
                continue;
            }
            JsonNode value = data.path("Value");
            out.add(new MewsCatalog.Service(
                    textOrNull(s, "Id"),
                    textOrNull(s, "Name"),
                    s.path("IsActive").asBoolean(false),
                    parseDuration(textOrNull(value, "StartOffset")),
                    parseDuration(textOrNull(value, "EndOffset"))));
        }
        return out;
    }

    /** Every rate on a service. */
    public List<MewsCatalog.Rate> getRates(String serviceId) {
        Map<String, Object> body = auth();
        body.put("ServiceIds", List.of(serviceId));
        List<MewsCatalog.Rate> out = new ArrayList<>();
        for (JsonNode r : getAllPaged(RATES_GET_ALL, body, "Rates")) {
            out.add(new MewsCatalog.Rate(
                    textOrNull(r, "Id"),
                    textOrNull(r, "Name"),
                    textOrNull(r, "Type"),
                    r.path("IsPublic").asBoolean(false),
                    r.path("IsEnabled").asBoolean(false),
                    r.path("IsActive").asBoolean(false),
                    textOrNull(r, "GroupId")));
        }
        return out;
    }

    /** Every additional (orderable) service on the enterprise, active or not. */
    public List<MewsCatalog.AdditionalService> getAdditionalServices() {
        List<MewsCatalog.AdditionalService> out = new ArrayList<>();
        for (JsonNode s : getAllPaged(SERVICES_GET_ALL, auth(), "Services")) {
            if (!"Additional".equals(textOrNull(s.path("Data"), "Discriminator"))) {
                continue;
            }
            out.add(new MewsCatalog.AdditionalService(
                    textOrNull(s, "Id"), textOrNull(s, "Name"), s.path("IsActive").asBoolean(false)));
        }
        return out;
    }

    /**
     * The active cancellation policies of a service's rate groups, by rate
     * group id. A group with no entry has no policy: free cancellation until
     * arrival. Mews requires the service alongside the groups.
     */
    public Map<String, List<com.bliss.b2b.payments.CancellationTerms.Step>> getCancellationPolicies(
            String serviceId, List<String> rateGroupIds) {
        Map<String, List<com.bliss.b2b.payments.CancellationTerms.Step>> out = new java.util.LinkedHashMap<>();
        if (rateGroupIds.isEmpty()) {
            return out;
        }
        Map<String, Object> body = auth();
        body.put("ServiceIds", List.of(serviceId));
        body.put("RateGroupIds", rateGroupIds);
        for (JsonNode p : getAllPaged(CANCELLATION_POLICIES_GET_ALL, body, "CancellationPolicies")) {
            if (!p.path("IsActive").asBoolean(true)) {
                continue;
            }
            JsonNode extent = p.path("FeeExtent");
            String feeExtent = extent.isArray() && extent.size() > 0 ? extent.get(0).asText()
                    : textOrNull(p, "FeeExtent");
            JsonNode absolute = p.path("AbsoluteFee");
            String absoluteCurrency = textOrNull(absolute, "Currency");
            Long absoluteMinor = absolute.path("Value").isNumber() && absoluteCurrency != null
                    ? toMinorUnits(absolute.path("Value").decimalValue(), absoluteCurrency)
                    : null;
            JsonNode relative = p.path("RelativeFee");
            out.computeIfAbsent(textOrNull(p, "RateGroupId"), k -> new ArrayList<>())
                    .add(new com.bliss.b2b.payments.CancellationTerms.Step(
                            textOrNull(p, "Applicability"),
                            textOrNull(p, "ApplicabilityOffset"),
                            feeExtent,
                            relative.isNumber() ? relative.decimalValue() : null,
                            absoluteMinor,
                            absoluteCurrency,
                            p.path("FeeMaximumTimeUnits").isNumber() ? p.path("FeeMaximumTimeUnits").asInt() : null));
        }
        return out;
    }

    /**
     * Posts one custom item to a reservation's bill (orders/add), such as the
     * "Bliss service fee" line, and returns the Mews order id. Mews only takes
     * orders on an additional service. With no {@code taxCode} the item is
     * untaxed; with one, it must be one of the property's own tax rate codes
     * (for example "UK-2022-20%"). {@code externalIdentifier} marks the item as
     * Bliss's in Mews.
     */
    public String addOrderItem(String serviceId, String accountId, String reservationId, String name,
            long amountMinor, String currency, String taxCode, String accountingCategoryId,
            String externalIdentifier, String notes) {
        return addOrderItem(serviceId, accountId, reservationId, name, amountMinor, currency, taxCode,
                accountingCategoryId, externalIdentifier, notes, false);
    }

    /**
     * As above, sending the amount as the property prices: a gross value
     * (tax included) on a gross-pricing property, a net value (tax added on
     * top by Mews) on a net-pricing one. Mews refuses a taxed gross value on a
     * net-pricing property ("Invalid NetValue", verified on the Net Pricing
     * demo). Untaxed, the two are the same amount.
     */
    public String addOrderItem(String serviceId, String accountId, String reservationId, String name,
            long amountMinor, String currency, String taxCode, String accountingCategoryId,
            String externalIdentifier, String notes, boolean netPricing) {
        Map<String, Object> unitAmount = new LinkedHashMap<>();
        unitAmount.put("Currency", currency);
        unitAmount.put(netPricing ? "NetValue" : "GrossValue", toGrossValue(amountMinor, currency));
        if (taxCode != null && !taxCode.isBlank()) {
            unitAmount.put("TaxCodes", List.of(taxCode));
        }
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("Name", name);
        item.put("UnitCount", 1);
        item.put("UnitAmount", unitAmount);
        if (accountingCategoryId != null && !accountingCategoryId.isBlank()) {
            item.put("AccountingCategoryId", accountingCategoryId);
        }
        if (externalIdentifier != null) {
            item.put("ExternalIdentifier", externalIdentifier);
        }
        Map<String, Object> body = auth();
        body.put("ServiceId", serviceId);
        body.put("AccountId", accountId);
        body.put("LinkedReservationId", reservationId);
        body.put("Items", List.of(item));
        if (notes != null) {
            body.put("Notes", notes);
        }
        String orderId = textOrNull(post(ORDERS_ADD, body), "OrderId");
        if (orderId == null || orderId.isBlank()) {
            throw new PmsAdapterException("Mews accepted the order but returned no OrderId");
        }
        return orderId;
    }

    // --- Availability and pricing -------------------------------------------

    // --- Reservations -------------------------------------------------------

    /**
     * A reservation's current state (Optional, Confirmed, Started, Processed,
     * Canceled, Inquired, Requested), or empty if Mews does not return it.
     */
    @Override
    public Optional<String> getReservationState(String reservationId) {
        Map<String, Object> body = auth();
        body.put("ReservationIds", List.of(reservationId));
        body.put("Limitation", Map.of("Count", 1));
        for (JsonNode r : post(RESERVATIONS_GET_ALL, body).path("Reservations")) {
            if (reservationId.equals(textOrNull(r, "Id"))) {
                return Optional.ofNullable(textOrNull(r, "State"));
            }
        }
        return Optional.empty();
    }

    private static Instant parseInstant(String iso) {
        try {
            return iso == null ? null : Instant.parse(iso);
        } catch (java.time.format.DateTimeParseException e) {
            return null;
        }
    }

    /**
     * Cancels a reservation without posting Mews' own cancellation fee: under
     * a Bliss plan the property's plan rules decide what the guest keeps.
     * {@code notes} is required by Mews and shows on the reservation.
     */
    public void cancelReservation(String reservationId, boolean sendEmail, String notes) {
        Map<String, Object> body = auth();
        body.put("ReservationIds", List.of(reservationId));
        body.put("PostCancellationFee", false);
        body.put("SendEmail", sendEmail);
        body.put("Notes", notes);
        post(RESERVATIONS_CANCEL, body);
        log.info("Mews reservation {} canceled (email={})", reservationId, sendEmail);
    }

    // --- Booking-engine reservations (linking) -----------------------------

    /**
     * Every reservation on {@code serviceId} that Mews updated in
     * [{@code fromUtc}, {@code toUtc}). The poller's one read: new bookings,
     * cancellations and date changes all move {@code UpdatedUtc}. Keep the
     * window within Mews' limit for this filter; the caller polls every few
     * minutes, so it is always far inside it.
     */
    public List<MewsReservation> getReservationsUpdated(String serviceId, Instant fromUtc, Instant toUtc) {
        Map<String, Object> body = auth();
        body.put("ServiceIds", List.of(serviceId));
        body.put("UpdatedUtc", Map.of("StartUtc", fromUtc.toString(), "EndUtc", toUtc.toString()));
        List<MewsReservation> out = new ArrayList<>();
        for (JsonNode r : getAllPaged(RESERVATIONS_GET_ALL, body, "Reservations")) {
            out.add(toReservation(r));
        }
        return out;
    }

    /** The reservations with these ids that Mews returns. Missing ids are simply absent. */
    public List<MewsReservation> getReservations(List<String> reservationIds) {
        if (reservationIds == null || reservationIds.isEmpty()) {
            return List.of();
        }
        Map<String, Object> body = auth();
        body.put("ReservationIds", List.copyOf(reservationIds));
        List<MewsReservation> out = new ArrayList<>();
        for (JsonNode r : getAllPaged(RESERVATIONS_GET_ALL, body, "Reservations")) {
            out.add(toReservation(r));
        }
        return out;
    }

    /**
     * The card payments Mews took against {@code reservationId}. This is how
     * Bliss learns which card the guest saved: a booking-engine reservation
     * carries no {@code CreditCardId}, but the upfront charge the Bliss rate
     * takes is a {@code CreditCardPayment} naming both the reservation and the
     * card. Every state is returned (Pending, Charged, Failed, ...), so the
     * caller can tell "not charged yet" from "never will be".
     */
    public List<MewsCardPayment> getReservationCardPayments(String reservationId) {
        Map<String, Object> body = auth();
        body.put("ReservationIds", List.of(reservationId));
        List<MewsCardPayment> out = new ArrayList<>();
        for (JsonNode p : getAllPaged(PAYMENTS_GET_ALL, body, "Payments")) {
            if (!reservationId.equals(textOrNull(p, "ReservationId"))
                    || !"CreditCardPayment".equals(textOrNull(p, "Type"))) {
                continue;
            }
            JsonNode amount = p.path("Amount");
            JsonNode gross = amount.path("GrossValue");
            if (!gross.isNumber()) {
                throw new PmsAdapterException("Mews payment " + textOrNull(p, "Id") + " has no amount");
            }
            String paymentCurrency = textOrNull(amount, "Currency");
            out.add(new MewsCardPayment(
                    textOrNull(p, "Id"),
                    textOrNull(p, "State"),
                    // Mews books a payment as a negative bill entry; Bliss wants what was paid.
                    toMinorUnits(gross.decimalValue().abs(), paymentCurrency),
                    paymentCurrency,
                    textOrNull(p.path("Data").path("CreditCard"), "CreditCardId"),
                    parseInstant(textOrNull(p, "CreatedUtc"))));
        }
        return out;
    }

    /**
     * What the guest owes for the reservation: the sum of its live order items
     * (nights, plus any products added to it). Canceled items are left out.
     * Fails if the items are in more than one currency.
     */
    public StayPrice getReservationTotal(String reservationId) {
        Map<String, Object> body = auth();
        body.put("ServiceOrderIds", List.of(reservationId));
        BigDecimal sum = BigDecimal.ZERO;
        String currency = null;
        int items = 0;
        for (JsonNode item : getAllPaged(ORDER_ITEMS_GET_ALL, body, "OrderItems")) {
            if (textOrNull(item, "CanceledUtc") != null) {
                continue;
            }
            JsonNode amount = item.path("Amount");
            String c = textOrNull(amount, "Currency");
            JsonNode gross = amount.path("GrossValue");
            if (c == null || !gross.isNumber()) {
                throw new PmsAdapterException("Mews order item " + textOrNull(item, "Id") + " has no amount");
            }
            if (currency != null && !currency.equals(c)) {
                throw new PmsAdapterException("Reservation " + reservationId + " is priced in "
                        + currency + " and " + c);
            }
            currency = c;
            sum = sum.add(gross.decimalValue());
            items++;
        }
        if (items == 0) {
            throw new PmsAdapterException("Reservation " + reservationId + " has no order items");
        }
        return new StayPrice(toMinorUnits(sum, currency), currency);
    }

    /**
     * The order an item with this {@code ExternalIdentifier} belongs to, if
     * Mews already has one (not canceled) on {@code serviceId} created in the
     * window. Bliss marks every folio line it posts with its own identifier,
     * so this finds a line that was posted even if Bliss never recorded the
     * reply. Mews returns order items linked to a reservation as their own
     * orders, so the search is by service and creation time, not reservation.
     */
    public Optional<String> findOrderByExternalIdentifier(String serviceId, Instant createdFrom,
            Instant createdTo, String externalIdentifier) {
        Map<String, Object> body = auth();
        body.put("ServiceIds", List.of(serviceId));
        body.put("CreatedUtc", Map.of("StartUtc", createdFrom.toString(), "EndUtc", createdTo.toString()));
        for (JsonNode item : getAllPaged(ORDER_ITEMS_GET_ALL, body, "OrderItems")) {
            if (externalIdentifier.equals(textOrNull(item, "ExternalIdentifier"))
                    && textOrNull(item, "CanceledUtc") == null) {
                return Optional.ofNullable(textOrNull(item, "ServiceOrderId"));
            }
        }
        return Optional.empty();
    }

    /**
     * Hold mode: records money Bliss released to the property as a ledger-only
     * payment on the reservation's folio, so the property's Mews balance shows
     * money it now has. Nothing is charged. {@code type} must be one of the
     * property's enabled external payment types (Mews refuses others: "Enterprise
     * doesn't have the external payment type enabled", verified on Gross UK).
     * Returns the {@code ExternalPaymentId}.
     */
    public String addExternalPayment(String accountId, String reservationId, long amountMinor, String currency,
            String type, String externalIdentifier, String notes) {
        Map<String, Object> body = auth();
        body.put("AccountId", accountId);
        if (reservationId != null) {
            body.put("ReservationId", reservationId);
        }
        body.put("Amount", Map.of("Currency", currency, "GrossValue", toGrossValue(amountMinor, currency)));
        body.put("Type", type);
        body.put("ExternalIdentifier", externalIdentifier);
        if (notes != null) {
            body.put("Notes", notes);
        }
        String id = textOrNull(post(PAYMENTS_ADD_EXTERNAL, body), "ExternalPaymentId");
        if (id == null || id.isBlank()) {
            throw new PmsAdapterException("Mews accepted the external payment but returned no ExternalPaymentId");
        }
        return id;
    }

    /**
     * The id of an external payment Bliss already posted with this identifier
     * to the account in the window, if Mews has one. Mews returns the
     * identifier under {@code Data.External.ExternalIdentifier}.
     */
    public Optional<String> findExternalPayment(String accountId, Instant createdFrom, Instant createdTo,
            String externalIdentifier) {
        Map<String, Object> body = auth();
        body.put("AccountIds", List.of(accountId));
        body.put("CreatedUtc", Map.of("StartUtc", createdFrom.toString(), "EndUtc", createdTo.toString()));
        for (JsonNode p : getAllPaged(PAYMENTS_GET_ALL, body, "Payments")) {
            JsonNode external = p.path("Data").path("External");
            if (externalIdentifier.equals(textOrNull(external, "ExternalIdentifier"))) {
                return Optional.ofNullable(textOrNull(p, "Id"));
            }
        }
        return Optional.empty();
    }

    /** A Mews customer by id, or empty. */
    public Optional<PmsCustomer> getCustomer(String customerId) {
        Map<String, Object> body = auth();
        body.put("CustomerIds", List.of(customerId));
        body.put("Extent", Map.of("Customers", true));
        body.put("Limitation", Map.of("Count", 1));
        for (JsonNode c : post(CUSTOMERS_GET_ALL, body).path("Customers")) {
            if (customerId.equals(textOrNull(c, "Id"))) {
                return Optional.of(toCustomer(c));
            }
        }
        return Optional.empty();
    }

    private static MewsReservation toReservation(JsonNode r) {
        return new MewsReservation(
                textOrNull(r, "Id"),
                textOrNull(r, "Number"),
                textOrNull(r, "State"),
                textOrNull(r, "ServiceId"),
                textOrNull(r, "RateId"),
                textOrNull(r, "AccountId"),
                textOrNull(r, "RequestedResourceCategoryId"),
                textOrNull(r, "Origin"),
                parseInstant(textOrNull(r, "ScheduledStartUtc")),
                parseInstant(textOrNull(r, "ScheduledEndUtc")),
                parseInstant(textOrNull(r, "CreatedUtc")),
                parseInstant(textOrNull(r, "UpdatedUtc")));
    }

    /**
     * The fields of a Mews reservation Bliss reads. Start and end are the
     * scheduled stay, which is what a date change moves.
     */
    public record MewsReservation(
            String id,
            String number,
            String state,
            String serviceId,
            String rateId,
            String accountId,
            String categoryId,
            String origin,
            Instant startUtc,
            Instant endUtc,
            Instant createdUtc,
            Instant updatedUtc) {
    }

    /** A card payment Mews recorded against a reservation. {@code amountMinorUnits} is positive. */
    public record MewsCardPayment(
            String id,
            String state,
            long amountMinorUnits,
            String currency,
            String creditCardId,
            Instant createdUtc) {
    }

    /** A stay total in integer minor units, with its currency. */
    public record StayPrice(long totalMinorUnits, String currency) {
    }

    /**
     * Follows Mews' cursor paging for a getAll call and returns every item in
     * {@code arrayField}. Stops at {@link #MAX_PAGES} rather than looping on a
     * cursor that never ends.
     */
    private List<JsonNode> getAllPaged(String path, Map<String, Object> baseBody, String arrayField) {
        List<JsonNode> out = new ArrayList<>();
        String cursor = null;
        for (int page = 0; page < MAX_PAGES; page++) {
            Map<String, Object> body = new LinkedHashMap<>(baseBody);
            Map<String, Object> limitation = new LinkedHashMap<>();
            limitation.put("Count", PAGE_LIMIT);
            if (cursor != null) {
                limitation.put("Cursor", cursor);
            }
            body.put("Limitation", limitation);
            JsonNode root = post(path, body);
            JsonNode items = root.path(arrayField);
            int n = 0;
            if (items.isArray()) {
                for (JsonNode item : items) {
                    out.add(item);
                    n++;
                }
            }
            cursor = textOrNull(root, "Cursor");
            if (n < PAGE_LIMIT || cursor == null) {
                break;
            }
        }
        return out;
    }

    /** en-US, else en-GB, else any name Mews has. */
    private static String localized(JsonNode names) {
        for (String lang : List.of("en-US", "en-GB")) {
            String v = textOrNull(names, lang);
            if (v != null && !v.isBlank()) {
                return v;
            }
        }
        Iterator<JsonNode> it = names.elements();
        return it.hasNext() ? it.next().asText() : null;
    }

    /** Mews offsets are ISO-8601 periods such as {@code P0M0DT15H0M0S}; months and days are always zero here. */
    static Duration parseDuration(String iso) {
        if (iso == null || iso.isBlank()) {
            return null;
        }
        int t = iso.indexOf('T');
        String time = t < 0 ? "PT0S" : "PT" + iso.substring(t + 1);
        String datePart = t < 0 ? iso.substring(1) : iso.substring(1, t);
        long days = 0;
        Matcher m = Pattern.compile("(-?\\d+)D").matcher(datePart);
        if (m.find()) {
            days = Long.parseLong(m.group(1));
        }
        return Duration.parse(time).plusDays(days);
    }

    // --- Mews wire helpers -------------------------------------------------

    /** Fresh mutable body seeded with the three auth fields every call needs. */
    private Map<String, Object> auth() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ClientToken", config.getClientToken());
        body.put("AccessToken", config.getAccessToken());
        body.put("Client", CLIENT);
        return body;
    }

    private JsonNode post(String path, Map<String, Object> body) {
        if (!config.isConfigured()) {
            throw new PmsAdapterException(
                    "Mews PMS credentials not configured (set pms.mews.clientToken / .accessToken)");
        }

        String json;
        try {
            json = mapper.writeValueAsString(body);
        } catch (IOException e) {
            throw new PmsAdapterException("Could not build Mews request body: " + e.getMessage(), e);
        }

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(platformUrl() + path))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new PmsAdapterException("Failed to reach Mews: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new PmsAdapterException("Interrupted while calling Mews", e);
        }

        if (response.statusCode() / 100 != 2) {
            throw new PmsAdapterException(
                    "Mews returned HTTP " + response.statusCode() + " for " + path
                            + ": " + truncate(response.body()),
                    response.statusCode(), errorMessage(response.body()));
        }

        try {
            return mapper.readTree(response.body());
        } catch (IOException e) {
            throw new PmsAdapterException("Could not parse Mews response for " + path
                    + ": " + e.getMessage(), e);
        }
    }

    private String platformUrl() {
        String url = config.getPlatformUrl();
        if (url == null || url.isBlank()) {
            throw new PmsAdapterException("Mews platform URL is not configured");
        }
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    private static PmsCustomer toCustomer(JsonNode c) {
        return new PmsCustomer(
                textOrNull(c, "Id"),
                textOrNull(c, "FirstName"),
                textOrNull(c, "LastName"),
                textOrNull(c, "Email"));
    }

    private static PmsStoredCard toCard(JsonNode card) {
        int[] exp = parseExpiration(textOrNull(card, "Expiration"));
        return new PmsStoredCard(
                textOrNull(card, "Id"),
                textOrNull(card, "CustomerId"),
                textOrNull(card, "ObfuscatedNumber"),
                textOrNull(card, "Kind"),
                textOrNull(card, "State"),
                exp == null ? null : exp[0],
                exp == null ? null : exp[1],
                card.path("IsActive").asBoolean(false));
    }

    /** Picks the default enabled currency out of the Currencies array. */
    private static String defaultCurrency(JsonNode currencies) {
        if (currencies == null || !currencies.isArray()) {
            return null;
        }
        String firstEnabled = null;
        for (JsonNode cur : currencies) {
            String code = textOrNull(cur, "Currency");
            if (code == null) {
                continue;
            }
            if (cur.path("IsDefault").asBoolean(false)) {
                return code;
            }
            if (firstEnabled == null && cur.path("IsEnabled").asBoolean(true)) {
                firstEnabled = code;
            }
        }
        return firstEnabled;
    }

    /**
     * Converts integer minor units to the decimal major-unit value Mews expects
     * in {@code Amount.GrossValue}, at the currency's own scale: 1050 GBP is
     * 10.50, 1050 JPY is 1050, 1050 KWD is 1.050. Kept as a {@link BigDecimal}
     * so no float ever enters the money path.
     */
    static BigDecimal toGrossValue(long amountMinorUnits, String currency) {
        try {
            return Money.toMajor(amountMinorUnits, currency);
        } catch (IllegalArgumentException e) {
            throw new PmsAdapterException("Cannot charge in currency '" + currency + "': " + e.getMessage());
        }
    }

    /**
     * Inverse of {@link #toGrossValue}. Exact: a price with more decimals than
     * the currency has is an error, never silently rounded.
     */
    static long toMinorUnits(BigDecimal majorUnits, String currency) {
        try {
            return Money.toMinor(majorUnits, currency);
        } catch (IllegalArgumentException e) {
            throw new PmsAdapterException("Mews price " + majorUnits + " " + currency + ": " + e.getMessage());
        }
    }

    /** Parses a Mews "YYYY-MM" expiration into {year, month}, or null. */
    private static int[] parseExpiration(String expiration) {
        if (expiration == null || expiration.isBlank()) {
            return null;
        }
        String[] parts = expiration.split("-");
        if (parts.length < 2) {
            return null;
        }
        try {
            return new int[] {Integer.parseInt(parts[0].trim()), Integer.parseInt(parts[1].trim())};
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() ? null : value.asText();
    }

    private static String truncate(String body) {
        if (body == null) {
            return "";
        }
        return body.length() > 500 ? body.substring(0, 500) + "..." : body;
    }
}

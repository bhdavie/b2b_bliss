package com.bliss.b2b.integration.pms;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
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
import java.util.Locale;
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
    private static final String CUSTOMERS_ADD = "/api/connector/v1/customers/add";
    private static final String CREDIT_CARDS_GET_ALL = "/api/connector/v1/creditCards/getAll";
    private static final String PAYMENT_METHOD_REQUESTS_ADD =
            "/api/connector/v1/paymentMethodRequests/add";
    private static final String CREDIT_CARDS_CHARGE = "/api/connector/v1/creditCards/charge";
    private static final String PAYMENTS_GET_ALL = "/api/connector/v1/payments/getAll";
    private static final String SERVICES_GET_ALL = "/api/connector/v1/services/getAll";
    private static final String RATES_GET_ALL = "/api/connector/v1/rates/getAll";
    private static final String RESOURCE_CATEGORIES_GET_ALL = "/api/connector/v1/resourceCategories/getAll";
    private static final String AGE_CATEGORIES_GET_ALL = "/api/connector/v1/ageCategories/getAll";
    private static final String SERVICES_GET_AVAILABILITY = "/api/connector/v1/services/getAvailability/2024-01-22";
    private static final String RESERVATIONS_PRICE = "/api/connector/v1/reservations/price";
    private static final String RESERVATIONS_ADD = "/api/connector/v1/reservations/add";
    private static final String RESERVATIONS_CONFIRM = "/api/connector/v1/reservations/confirm";
    private static final String RESERVATIONS_CANCEL = "/api/connector/v1/reservations/cancel";
    private static final String RESERVATIONS_GET_ALL = "/api/connector/v1/reservations/getAll/2023-06-06";

    /** Pages followed per catalogue list call; a small property never gets near it. */
    private static final int MAX_PAGES = 10;

    /** Cap on rows pulled per list call; a demo property holds far fewer. */
    private static final int PAGE_LIMIT = 100;

    /**
     * Minor-unit exponent used to convert Bliss integer amounts to Mews'
     * decimal {@code GrossValue}. Fixed at 2 (GBP/USD/EUR); zero-decimal
     * currencies such as JPY are out of scope for the demo.
     */
    private static final int MINOR_UNIT_SCALE = 2;

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
                textOrNull(enterprise, "TimeZoneIdentifier"));
    }

    @Override
    public PmsCustomer findOrCreateCustomer(PmsCustomerRef ref) {
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

        if (ref.lastName() == null || ref.lastName().isBlank()) {
            throw new PmsAdapterException(
                    "Mews requires LastName to create a customer; none supplied for " + ref.email());
        }
        Map<String, Object> addBody = auth();
        addBody.put("LastName", ref.lastName());
        if (ref.firstName() != null && !ref.firstName().isBlank()) {
            addBody.put("FirstName", ref.firstName());
        }
        addBody.put("Email", ref.email());
        addBody.put("OverwriteExisting", false);

        // customers/add returns the Customer at the top level; tolerate a
        // "Customer" wrapper too in case a demo API version nests it.
        JsonNode addResponse = post(CUSTOMERS_ADD, addBody);
        JsonNode created = addResponse.has("Customer") ? addResponse.path("Customer") : addResponse;
        log.info("Created Mews customer for {} -> {}", ref.email(), textOrNull(created, "Id"));
        return toCustomer(created);
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
    public PmsCardCollectionRequest createCardCollectionRequest(
            String pmsCustomerId, Instant expiration, String description) {
        if (pmsCustomerId == null || pmsCustomerId.isBlank()) {
            throw new PmsAdapterException("createCardCollectionRequest requires a customer id");
        }
        if (expiration == null) {
            throw new PmsAdapterException("createCardCollectionRequest requires an expiration");
        }
        if (description == null || description.isBlank()) {
            throw new PmsAdapterException("createCardCollectionRequest requires a description");
        }

        Map<String, Object> body = auth();
        body.put("AccountId", pmsCustomerId);
        body.put("ExpirationUtc", expiration.toString());
        body.put("Description", description);
        // Collect a payment card only, and suppress Mews' own guest emails: the
        // request is fulfilled through Payments Checkout, not an emailed link.
        body.put("PaymentMethods", List.of("PaymentCard"));
        body.put("EmailsToSend", List.of());

        JsonNode response = post(PAYMENT_METHOD_REQUESTS_ADD, body);
        String requestId = textOrNull(response, "PaymentMethodRequestId");
        if (requestId == null || requestId.isBlank()) {
            throw new PmsAdapterException(
                    "Mews did not return a PaymentMethodRequestId for customer " + pmsCustomerId);
        }
        log.info("Created Mews payment method request {} for customer {}", requestId, pmsCustomerId);
        return new PmsCardCollectionRequest(requestId, expiration, description);
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
                "GrossValue", toGrossValue(chargeAmount)));
        if (reservationRef != null && !reservationRef.isBlank()) {
            body.put("ReservationId", reservationRef);
        }
        if (notes != null && !notes.isBlank()) {
            body.put("Notes", notes);
        }

        // Mews reports a card the gateway refuses as HTTP 403 "Transaction was
        // declined (Refused)", not as a Failed payment. That is a decline, and
        // is returned as one so callers apply their decline handling (release
        // the checkout hold, count a retry). Any other non-2xx still throws:
        // it says nothing about the card, so nothing is recorded against it.
        JsonNode charge;
        try {
            charge = post(CREDIT_CARDS_CHARGE, body);
        } catch (PmsAdapterException e) {
            if (!isDecline(e)) {
                throw e;
            }
            String reason = declineReason(e.pmsMessage());
            log.info("Mews card {} declined by the gateway ({})", pmsCardId, reason);
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

    /** A gateway refusal: HTTP 403 whose Mews message says the transaction was declined. */
    static boolean isDecline(PmsAdapterException e) {
        return e.httpStatus() == 403 && e.pmsMessage() != null
                && e.pmsMessage().toLowerCase(Locale.ROOT).contains("declined");
    }

    /** "Transaction was declined (Refused)." -> "Refused"; anything else -> "Declined". */
    static String declineReason(String pmsMessage) {
        if (pmsMessage != null) {
            int open = pmsMessage.indexOf('(');
            int close = pmsMessage.indexOf(')', open + 1);
            if (open >= 0 && close > open + 1) {
                return pmsMessage.substring(open + 1, close).trim();
            }
        }
        return "Declined";
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
                    r.path("IsActive").asBoolean(false)));
        }
        return out;
    }

    /** Every room category on a service, with its capacity. */
    public List<MewsCatalog.ResourceCategory> getResourceCategories(String serviceId) {
        Map<String, Object> body = auth();
        body.put("ServiceIds", List.of(serviceId));
        List<MewsCatalog.ResourceCategory> out = new ArrayList<>();
        for (JsonNode c : getAllPaged(RESOURCE_CATEGORIES_GET_ALL, body, "ResourceCategories")) {
            out.add(new MewsCatalog.ResourceCategory(
                    textOrNull(c, "Id"),
                    localized(c.path("Names")),
                    c.path("IsActive").asBoolean(false),
                    c.path("Capacity").asInt(0),
                    c.path("ExtraCapacity").asInt(0)));
        }
        return out;
    }

    /** The service's active adult age category, which PersonCounts are counted in. */
    public Optional<String> getAdultAgeCategoryId(String serviceId) {
        Map<String, Object> body = auth();
        body.put("ServiceIds", List.of(serviceId));
        for (JsonNode a : getAllPaged(AGE_CATEGORIES_GET_ALL, body, "AgeCategories")) {
            if ("Adult".equals(textOrNull(a, "Classification")) && a.path("IsActive").asBoolean(false)) {
                return Optional.ofNullable(textOrNull(a, "Id"));
            }
        }
        return Optional.empty();
    }

    // --- Availability and pricing -------------------------------------------

    /**
     * Free rooms per category for each night from {@code firstNightUtc} to
     * {@code lastNightUtc} inclusive, as usable rooms minus occupied ones.
     * Both instants must be local midnight of a night, in UTC, which is the
     * time-unit boundary Mews requires. "Usable" already leaves out rooms that
     * are out of order.
     */
    public Map<String, int[]> getFreeRoomsPerNight(String serviceId, Instant firstNightUtc, Instant lastNightUtc) {
        Map<String, Object> body = auth();
        body.put("ServiceId", serviceId);
        body.put("FirstTimeUnitStartUtc", firstNightUtc.toString());
        body.put("LastTimeUnitStartUtc", lastNightUtc.toString());
        body.put("Metrics", List.of("UsableResources", "Occupied"));
        JsonNode root = post(SERVICES_GET_AVAILABILITY, body);
        Map<String, int[]> out = new LinkedHashMap<>();
        for (JsonNode c : root.path("ResourceCategoryAvailabilities")) {
            JsonNode usable = c.path("Metrics").path("UsableResources");
            JsonNode occupied = c.path("Metrics").path("Occupied");
            int[] free = new int[usable.size()];
            for (int i = 0; i < free.length; i++) {
                free[i] = usable.path(i).asInt(0) - occupied.path(i).asInt(0);
            }
            out.put(textOrNull(c, "ResourceCategoryId"), free);
        }
        return out;
    }

    /**
     * The tax-inclusive total Mews would charge for one stay, from
     * reservations/price. This, not anything the browser sends, is what a
     * Bliss plan is written against.
     */
    public StayPrice priceStay(String serviceId, String categoryId, String rateId,
            String adultAgeCategoryId, int adults, Instant startUtc, Instant endUtc) {
        Map<String, Object> reservation = new LinkedHashMap<>();
        reservation.put("Identifier", "quote");
        reservation.put("StartUtc", startUtc.toString());
        reservation.put("EndUtc", endUtc.toString());
        reservation.put("RequestedCategoryId", categoryId);
        reservation.put("RateId", rateId);
        reservation.put("PersonCounts", List.of(Map.of("AgeCategoryId", adultAgeCategoryId, "Count", adults)));
        Map<String, Object> body = auth();
        body.put("ServiceId", serviceId);
        body.put("Reservations", List.of(reservation));

        JsonNode prices = post(RESERVATIONS_PRICE, body).path("ReservationPrices");
        JsonNode total = prices.path(0).path("TotalAmount");
        String currency = textOrNull(total, "Currency");
        JsonNode gross = total.path("GrossValue");
        if (currency == null || !gross.isNumber()) {
            throw new PmsAdapterException("Mews returned no price for the stay");
        }
        return new StayPrice(toMinorUnits(gross.decimalValue()), currency);
    }

    // --- Reservations -------------------------------------------------------

    /**
     * Creates the stay as an {@code Optional} reservation: the room is held,
     * but Mews sends nothing to the guest yet. {@link #confirmReservation}
     * turns it into a booking once the first installment is taken.
     *
     * <p>{@code CheckRateApplicability} is off because the Bliss rate is
     * private, and Mews would otherwise refuse it without a voucher code.
     * Overbooking is still checked, so a room sold since the quote is refused
     * here rather than double-booked. No {@code CreditCardId} is passed: with
     * a card attached, Mews charges it under the rate's payment policy.
     *
     * @param releasedUtc when Mews may release the hold if it is never confirmed
     * @return the new reservation id
     */
    public String addOptionalReservation(String serviceId, String customerId, String categoryId,
            String rateId, String adultAgeCategoryId, int adults, Instant startUtc, Instant endUtc,
            Instant releasedUtc, String identifier, String notes) {
        Map<String, Object> reservation = new LinkedHashMap<>();
        reservation.put("Identifier", identifier);
        reservation.put("State", "Optional");
        reservation.put("StartUtc", startUtc.toString());
        reservation.put("EndUtc", endUtc.toString());
        reservation.put("ReleasedUtc", releasedUtc.toString());
        reservation.put("CustomerId", customerId);
        reservation.put("RequestedCategoryId", categoryId);
        reservation.put("RateId", rateId);
        reservation.put("PersonCounts", List.of(Map.of("AgeCategoryId", adultAgeCategoryId, "Count", adults)));
        if (notes != null && !notes.isBlank()) {
            reservation.put("Notes", notes);
        }
        Map<String, Object> body = auth();
        body.put("ServiceId", serviceId);
        body.put("SendConfirmationEmail", false);
        body.put("CheckRateApplicability", false);
        body.put("CheckOverbooking", true);
        body.put("Reservations", List.of(reservation));

        String id = textOrNull(post(RESERVATIONS_ADD, body).path("Reservations").path(0).path("Reservation"), "Id");
        if (id == null || id.isBlank()) {
            throw new PmsAdapterException("Mews created no reservation for " + identifier);
        }
        log.info("Mews optional reservation {} held for {}", id, identifier);
        return id;
    }

    /**
     * A reservation on this customer's account for exactly this service, room
     * category and stay, in one of {@code states}. Used before creating a hold,
     * so a hold whose creation response was lost is found and reused rather
     * than duplicated. Mews has no idempotency key for reservations/add.
     */
    public Optional<String> findReservation(String serviceId, String customerId, String categoryId,
            Instant startUtc, Instant endUtc, List<String> states) {
        Map<String, Object> body = auth();
        body.put("AccountIds", List.of(customerId));
        body.put("ServiceIds", List.of(serviceId));
        body.put("States", states);
        for (JsonNode r : getAllPaged(RESERVATIONS_GET_ALL, body, "Reservations")) {
            if (categoryId.equals(textOrNull(r, "RequestedResourceCategoryId"))
                    && startUtc.equals(parseInstant(textOrNull(r, "StartUtc")))
                    && endUtc.equals(parseInstant(textOrNull(r, "EndUtc")))) {
                return Optional.ofNullable(textOrNull(r, "Id"));
            }
        }
        return Optional.empty();
    }

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

    /** Confirms an {@code Optional} reservation. With {@code sendEmail}, Mews sends its confirmation. */
    public void confirmReservation(String reservationId, boolean sendEmail) {
        Map<String, Object> body = auth();
        body.put("ReservationIds", List.of(reservationId));
        body.put("SendConfirmationEmail", sendEmail);
        post(RESERVATIONS_CONFIRM, body);
        log.info("Mews reservation {} confirmed (email={})", reservationId, sendEmail);
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
     * Converts integer minor units (e.g. 1050 pence) to the decimal major-unit
     * value Mews expects in {@code Amount.GrossValue} (e.g. 10.50). Kept as a
     * {@link BigDecimal} so no float ever enters the money path.
     */
    private static BigDecimal toGrossValue(long amountMinorUnits) {
        return BigDecimal.valueOf(amountMinorUnits)
                .movePointLeft(MINOR_UNIT_SCALE)
                .setScale(MINOR_UNIT_SCALE, RoundingMode.UNNECESSARY);
    }

    /**
     * Inverse of {@link #toGrossValue}. Exact: a price with more than two
     * decimals is an error, never silently rounded.
     */
    static long toMinorUnits(BigDecimal majorUnits) {
        try {
            return majorUnits.setScale(MINOR_UNIT_SCALE, RoundingMode.UNNECESSARY)
                    .movePointRight(MINOR_UNIT_SCALE)
                    .longValueExact();
        } catch (ArithmeticException e) {
            throw new PmsAdapterException("Mews price " + majorUnits + " is not a whole number of cents");
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

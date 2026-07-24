package com.bliss.b2b.integration.pms;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * {@link PmsAdapter} over the Mews Connector API. Built on the JDK
 * {@link HttpClient} + Jackson so it adds no dependency, matching the existing
 * {@link com.bliss.b2b.integration.MewsApiClient} (reservation sync). This is a
 * separate surface: it covers the PMS payment rail (configuration, customers,
 * stored cards) and does not touch the sync path or any Stripe code.
 *
 * <p>All Mews calls are POST with {@code ClientToken}, {@code AccessToken} and
 * {@code Client} in the JSON body. The {@code Client} string is
 * {@value #CLIENT}.
 *
 * <p>Charging is out of scope here by design; no operation moves money.
 */
public class MewsAdapter implements PmsAdapter {

    private static final Logger log = LoggerFactory.getLogger(MewsAdapter.class);

    private static final String CLIENT = "Bliss Payments";

    private static final String CONFIGURATION_GET = "/api/connector/v1/configuration/get";
    private static final String CUSTOMERS_GET_ALL = "/api/connector/v1/customers/getAll";
    private static final String CUSTOMERS_ADD = "/api/connector/v1/customers/add";
    private static final String CREDIT_CARDS_GET_ALL = "/api/connector/v1/creditCards/getAll";
    private static final String PAYMENT_METHOD_REQUESTS_ADD =
            "/api/connector/v1/paymentMethodRequests/add";
    private static final String CREDIT_CARDS_CHARGE = "/api/connector/v1/creditCards/charge";
    private static final String PAYMENTS_GET_ALL = "/api/connector/v1/payments/getAll";

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
                new ObjectMapper(),
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

        // A non-2xx here (bad card id, gateway rejection surfaced as an HTTP
        // error, etc.) throws from post(); only an accepted charge continues.
        JsonNode charge = post(CREDIT_CARDS_CHARGE, body);
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
                            + ": " + truncate(response.body()));
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

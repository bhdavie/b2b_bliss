package com.bliss.b2b.integration.pms;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * {@link PmsAdapter} over the Cloudbeds API, bound to one property's OAuth access
 * token and {@code propertyID}. Same shape and HTTP style as
 * {@link MewsAdapter} (JDK HttpClient + Jackson, no extra dependency), but auth
 * is an OAuth {@code Authorization: Bearer <accessToken>} header rather than
 * Mews' client/access token pair.
 *
 * <p><b>Skeleton.</b> The charge path ({@link #chargeStoredCard} via postCharge)
 * and property identification ({@link #getPropertyConfiguration} via getHotels)
 * are shaped for the documented API; exact field names are best-effort per the
 * docs diagnostic and flagged where uncertain. Card capture
 * ({@link #createCardCollectionRequest}) throws {@link PmsNotSupportedException}
 * because Cloudbeds tokenizes cards through its client SDK / vault, not a
 * server-issued hosted request — that is the guest-checkout seam, built later.
 *
 * <p>Amounts: Cloudbeds uses decimal major units (e.g. {@code 100.50}) plus a
 * currency, not integer minor units; {@link #toDecimal} does the conversion so
 * no float enters the money path.
 */
public class CloudbedsAdapter implements PmsAdapter {

    private static final Logger log = LoggerFactory.getLogger(CloudbedsAdapter.class);

    private static final int MINOR_UNIT_SCALE = 2;
    private static final int PAGE_LIMIT = 100;

    private final String apiBaseUrl;
    private final String accessToken;
    private final String propertyId;
    /** Demo charge cap in cents; &lt;= 0 disables clamping. See BLISS_CHARGE_CAP_CENTS. */
    private final long chargeCapCents;
    private final HttpClient http;
    private final ObjectMapper mapper;

    public CloudbedsAdapter(String apiBaseUrl, String accessToken, String propertyId, long chargeCapCents) {
        this(apiBaseUrl, accessToken, propertyId, chargeCapCents,
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build(),
                new ObjectMapper());
    }

    CloudbedsAdapter(String apiBaseUrl, String accessToken, String propertyId, long chargeCapCents,
            HttpClient http, ObjectMapper mapper) {
        this.apiBaseUrl = trimTrailingSlash(apiBaseUrl);
        this.accessToken = accessToken;
        this.propertyId = propertyId;
        this.chargeCapCents = chargeCapCents;
        this.http = http;
        this.mapper = mapper;
    }

    @Override
    public PmsPropertyConfiguration getPropertyConfiguration() {
        // getHotels returns the property/-ies this token can access. When bound to
        // a propertyId we filter to it; during OAuth identification (no propertyId
        // yet) we omit the filter and take the first accessible property.
        Map<String, String> query = new LinkedHashMap<>();
        if (propertyId != null && !propertyId.isBlank()) {
            query.put("propertyID", propertyId);
        }
        JsonNode root = get("/getHotels", query);
        JsonNode hotel = firstOf(root.path("data"));
        return new PmsPropertyConfiguration(
                textOrNull(hotel, "propertyID", "id"),
                textOrNull(hotel, "propertyName", "name"),
                textOrNull(hotel, "propertyCurrency", "currencyCode", "currency"),
                textOrNull(hotel, "propertyCountry", "country"),
                null, // pricing model n/a
                textOrNull(hotel, "propertyTimezone", "timezone"));
    }

    @Override
    public PmsCustomer findOrCreateCustomer(PmsCustomerRef ref) {
        if (ref == null || ref.email() == null || ref.email().isBlank()) {
            throw new PmsAdapterException("findOrCreateCustomer requires an email to search on");
        }
        // Search-first (like MewsAdapter). NOTE: Cloudbeds guests are typically
        // reservation-coupled; a standalone guest search/create may need a
        // reservation or house-account context. Shaped here, flagged for the seam.
        JsonNode found = get("/getGuestList", Map.of(
                "propertyID", propertyId,
                "email", ref.email())).path("data");
        if (found.isArray()) {
            for (JsonNode g : found) {
                if (ref.email().equalsIgnoreCase(textOrNull(g, "email"))) {
                    return toCustomer(g);
                }
            }
        }
        if (ref.lastName() == null || ref.lastName().isBlank()) {
            throw new PmsAdapterException(
                    "Cloudbeds requires a last name to create a guest; none for " + ref.email());
        }
        Map<String, String> body = new LinkedHashMap<>();
        body.put("propertyID", propertyId);
        body.put("guestFirstName", ref.firstName() == null ? "" : ref.firstName());
        body.put("guestLastName", ref.lastName());
        body.put("guestEmail", ref.email());
        JsonNode created = post("/postGuest", body);
        String id = textOrNull(created, "guestID", "id");
        if (id == null) {
            throw new PmsAdapterException("Cloudbeds postGuest returned no guest id for " + ref.email());
        }
        return new PmsCustomer(id, ref.firstName(), ref.lastName(), ref.email());
    }

    @Override
    public List<PmsStoredCard> getStoredCards(String pmsCustomerId) {
        // Cloudbeds stores cards against reservations, not a standalone customer,
        // and exposes no clean "cards by guest" listing. Returned empty until the
        // guest-checkout seam vaults a card and records its token directly.
        log.debug("Cloudbeds getStoredCards not wired (cards are reservation-scoped); returning empty");
        return new ArrayList<>();
    }

    @Override
    public PmsCardCollectionRequest createCardCollectionRequest(
            String pmsCustomerId, Instant expiration, String description) {
        // No server-issued hosted card-entry request. Cloudbeds tokenizes cards
        // via its client SDK / vault endpoint; the guest checkout seam wires that.
        throw new PmsNotSupportedException(
                "Cloudbeds has no server-issued hosted card-collection request. Card entry must go "
                        + "through the Cloudbeds client SDK / vault tokenizer (guest checkout seam, not built).");
    }

    @Override
    public PmsChargeResult chargeStoredCard(
            String pmsCustomerId,
            String pmsCardId,
            long amountMinorUnits,
            String currency,
            String reservationRef,
            String notes) {
        if (pmsCardId == null || pmsCardId.isBlank()) {
            throw new PmsAdapterException("chargeStoredCard requires a payment method / card id");
        }
        if (amountMinorUnits <= 0) {
            throw new PmsAdapterException("chargeStoredCard requires a positive amount");
        }
        if (currency == null || currency.isBlank()) {
            throw new PmsAdapterException("chargeStoredCard requires a currency");
        }

        // Demo cap: clamp only the amount actually charged; the result echoes the
        // real amountMinorUnits, like MewsAdapter.
        long chargeAmount = amountMinorUnits;
        if (chargeCapCents > 0 && chargeAmount > chargeCapCents) {
            log.info("charge capped: {} -> {}", chargeAmount, chargeCapCents);
            chargeAmount = chargeCapCents;
        }

        Map<String, String> body = new LinkedHashMap<>();
        body.put("propertyID", propertyId);
        body.put("paymentMethodID", pmsCardId);
        body.put("amount", toDecimal(chargeAmount));
        body.put("currency", currency);
        if (reservationRef != null && !reservationRef.isBlank()) {
            body.put("reservationID", reservationRef);
        }
        if (notes != null && !notes.isBlank()) {
            body.put("description", notes);
        }

        // A non-2xx (bad token, hard gateway error) throws from post(); an accepted
        // charge continues and its paymentStatus decides the settlement state.
        JsonNode charge = post("/postCharge", body);
        JsonNode data = charge.has("data") ? charge.path("data") : charge;
        String paymentId = textOrNull(data, "paymentID", "transactionID", "id");
        String rawState = textOrNull(data, "paymentStatus", "status");
        PmsChargeStatus status = fromCloudbedsState(rawState);
        log.info("Cloudbeds charge card {} -> payment {} state={} ({})",
                pmsCardId, paymentId, rawState, status);
        // Declines (failed/canceled) are returned as a status, not thrown.
        return new PmsChargeResult(paymentId, status, rawState, amountMinorUnits, currency);
    }

    /**
     * Maps a Cloudbeds {@code paymentStatus} to {@link PmsChargeStatus}. The pass
     * then folds this to the schedule status via the shared
     * {@code InstallmentChargeService.mapChargeStatus}, so Cloudbeds settles
     * through the same machinery as Mews.
     */
    static PmsChargeStatus fromCloudbedsState(String state) {
        if (state == null) {
            return PmsChargeStatus.UNKNOWN;
        }
        return switch (state.toLowerCase()) {
            case "successful", "success", "charged", "paid" -> PmsChargeStatus.CHARGED;
            case "pending", "processing" -> PmsChargeStatus.PENDING;
            case "unconfirmed" -> PmsChargeStatus.VERIFYING;
            case "failed", "declined", "error" -> PmsChargeStatus.FAILED;
            case "canceled", "cancelled", "voided" -> PmsChargeStatus.CANCELED;
            default -> PmsChargeStatus.UNKNOWN;
        };
    }

    // --- HTTP helpers ------------------------------------------------------

    private JsonNode get(String path, Map<String, String> query) {
        return send("GET", path + "?" + formEncode(query), null);
    }

    private JsonNode post(String path, Map<String, String> form) {
        return send("POST", path, formEncode(form));
    }

    private JsonNode send(String method, String path, String body) {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(apiBaseUrl + path))
                .timeout(Duration.ofSeconds(30))
                .header("Authorization", "Bearer " + accessToken)
                .header("Accept", "application/json");
        if ("POST".equals(method)) {
            builder.header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(body == null ? "" : body));
        } else {
            builder.GET();
        }
        HttpResponse<String> response;
        try {
            response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new PmsAdapterException("Failed to reach Cloudbeds: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new PmsAdapterException("Interrupted while calling Cloudbeds", e);
        }
        if (response.statusCode() / 100 != 2) {
            throw new PmsAdapterException(
                    "Cloudbeds returned HTTP " + response.statusCode() + " for " + path
                            + ": " + truncate(response.body()));
        }
        try {
            return mapper.readTree(response.body());
        } catch (IOException e) {
            throw new PmsAdapterException("Could not parse Cloudbeds response for " + path
                    + ": " + e.getMessage(), e);
        }
    }

    private static PmsCustomer toCustomer(JsonNode g) {
        return new PmsCustomer(
                textOrNull(g, "guestID", "id"),
                textOrNull(g, "guestFirstName", "firstName"),
                textOrNull(g, "guestLastName", "lastName"),
                textOrNull(g, "guestEmail", "email"));
    }

    /** Converts integer minor units to the decimal major-unit string Cloudbeds expects. */
    static String toDecimal(long amountMinorUnits) {
        return BigDecimal.valueOf(amountMinorUnits)
                .movePointLeft(MINOR_UNIT_SCALE)
                .setScale(MINOR_UNIT_SCALE, RoundingMode.UNNECESSARY)
                .toPlainString();
    }

    private static JsonNode firstOf(JsonNode maybeArray) {
        if (maybeArray != null && maybeArray.isArray() && maybeArray.size() > 0) {
            return maybeArray.get(0);
        }
        return maybeArray == null ? com.fasterxml.jackson.databind.node.MissingNode.getInstance() : maybeArray;
    }

    /** Returns the first non-null text among the given field names. */
    private static String textOrNull(JsonNode node, String... fields) {
        for (String field : fields) {
            JsonNode v = node.path(field);
            if (!v.isMissingNode() && !v.isNull()) {
                return v.asText();
            }
        }
        return null;
    }

    private static String formEncode(Map<String, String> params) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : params.entrySet()) {
            if (sb.length() > 0) sb.append('&');
            sb.append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8))
                    .append('=')
                    .append(URLEncoder.encode(e.getValue() == null ? "" : e.getValue(), StandardCharsets.UTF_8));
        }
        return sb.toString();
    }

    private static String trimTrailingSlash(String url) {
        if (url == null || url.isBlank()) {
            throw new PmsAdapterException("Cloudbeds apiBaseUrl is not configured");
        }
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    private static String truncate(String body) {
        if (body == null) return "";
        return body.length() > 500 ? body.substring(0, 500) + "..." : body;
    }
}

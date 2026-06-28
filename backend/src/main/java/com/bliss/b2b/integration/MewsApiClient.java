package com.bliss.b2b.integration;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Thin HTTP client over the Mews Connector API. Built on the JDK's
 * {@link HttpClient} (Java 21) so it adds no dependency.
 *
 * <p>Reservations are fetched from {@code reservations/getAll} with
 * {@code TimeFilter: Start}, so each call returns reservations whose arrival
 * (check-in) falls inside the {@code StartUtc}/{@code EndUtc} window. The
 * Connector API authenticates via the JSON body (ClientToken + AccessToken),
 * not headers, and caps a single window at ~100 hours.
 *
 * <p>Because one ~4-day window only catches a reservation or two, and because
 * Bliss plan eligibility requires at least 6 weeks to the appointment,
 * {@link #fetchBookings()} sweeps a series of consecutive windows starting
 * {@link #WINDOW_LEAD} ahead of "now" (past the eligibility floor) and dedupes
 * by reservation id. It stops once it has {@link #TARGET_RESERVATIONS} or runs
 * out of {@link #MAX_WINDOWS}. This keeps the demo from depending on the exact
 * run date landing on a single dense window.
 *
 * <p>Demo-only integration (Mews is on the v2 list).
 */
public class MewsApiClient {

    private static final Logger log = LoggerFactory.getLogger(MewsApiClient.class);

    private static final String RESERVATIONS_PATH = "/api/connector/v1/reservations/getAll";

    /** How far ahead of "now" the first window starts (clears the 6-week eligibility floor). */
    private static final Duration WINDOW_LEAD = Duration.ofDays(42);

    /** Width of each window. Mews caps the interval at ~100h; stay safely under it. */
    private static final Duration WINDOW_SPAN = Duration.ofDays(4);

    /** Consecutive windows to sweep at most — {@value} * 4 days ≈ 4 months of coverage. */
    private static final int MAX_WINDOWS = 30;

    /**
     * Stop sweeping early once this many unique reservations are gathered. Set
     * above the size of any single import batch so that, on a re-run, the sweep
     * reaches past already-imported reservations into fresh ones (the sync layer
     * dedupes by reservation id, so repeats are skipped, not duplicated).
     */
    private static final int TARGET_RESERVATIONS = 24;

    private final MewsConfig config;
    private final HttpClient http;
    private final ObjectMapper mapper;
    private final Clock clock;

    public MewsApiClient(MewsConfig config) {
        this(config,
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build(),
                new ObjectMapper(),
                Clock.systemUTC());
    }

    MewsApiClient(MewsConfig config, HttpClient http, ObjectMapper mapper, Clock clock) {
        this.config = config;
        this.http = http;
        this.mapper = mapper;
        this.clock = clock;
    }

    /**
     * Sweeps consecutive arrival windows from {@link #WINDOW_LEAD} ahead of now,
     * deduping reservations by id, until {@link #TARGET_RESERVATIONS} are
     * gathered or {@link #MAX_WINDOWS} are exhausted. Returns an empty list if
     * Mews reports none across the whole sweep.
     *
     * @throws MewsApiException if credentials are missing, a call fails, or
     *                          Mews responds with a non-2xx status
     */
    public List<MewsBookingDTO> fetchBookings() {
        if (!config.isConfigured()) {
            throw new MewsApiException("Mews credentials not configured (set MEWS_CLIENT_TOKEN and MEWS_ACCESS_TOKEN)");
        }

        Instant base = Instant.now(clock).truncatedTo(ChronoUnit.SECONDS).plus(WINDOW_LEAD);
        // LinkedHashMap so the returned order is stable (earliest window first);
        // putIfAbsent keeps the first sighting when adjacent windows overlap.
        LinkedHashMap<String, MewsBookingDTO> unique = new LinkedHashMap<>();

        int windowsQueried = 0;
        for (int i = 0; i < MAX_WINDOWS && unique.size() < TARGET_RESERVATIONS; i++) {
            Instant start = base.plus(WINDOW_SPAN.multipliedBy(i));
            Instant end = start.plus(WINDOW_SPAN);
            for (MewsBookingDTO r : fetchWindow(start, end)) {
                if (r.id() != null) {
                    unique.putIfAbsent(r.id(), r);
                }
            }
            windowsQueried++;
        }

        log.info("Fetched {} unique reservation(s) from Mews across {} window(s) starting {}",
                unique.size(), windowsQueried, base);
        return List.copyOf(unique.values());
    }

    /** One {@code reservations/getAll} call over a single arrival window. */
    private List<MewsBookingDTO> fetchWindow(Instant start, Instant end) {
        String body;
        try {
            body = mapper.writeValueAsString(Map.of(
                    "ClientToken", config.clientToken(),
                    "AccessToken", config.accessToken(),
                    "Client", "Bliss B2B 1.0.0",
                    "StartUtc", start.toString(),
                    "EndUtc", end.toString(),
                    "TimeFilter", "Start"));
        } catch (IOException e) {
            throw new MewsApiException("Could not build Mews request body: " + e.getMessage(), e);
        }

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(config.platformUrl() + RESERVATIONS_PATH))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new MewsApiException("Failed to reach Mews: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new MewsApiException("Interrupted while calling Mews", e);
        }

        if (response.statusCode() / 100 != 2) {
            throw new MewsApiException(
                    "Mews returned HTTP " + response.statusCode() + ": " + truncate(response.body()));
        }

        try {
            ReservationsEnvelope envelope = mapper.readValue(response.body(), ReservationsEnvelope.class);
            List<MewsBookingDTO> reservations = envelope.reservations();
            return reservations == null ? new ArrayList<>() : reservations;
        } catch (IOException e) {
            throw new MewsApiException("Could not parse Mews response: " + e.getMessage(), e);
        }
    }

    /**
     * Reads the connected enterprise's identity from {@code configuration/get}.
     * Used by the simulated Mews Marketplace install to prove the .env
     * credentials really resolve to a live Mews property. Read-only and wholly
     * separate from the reservation sweep above — it does not touch the sync.
     *
     * @throws MewsApiException on missing credentials, transport failure, or a
     *                          non-2xx response
     */
    public ConnectionInfo fetchConnectionInfo() {
        if (!config.isConfigured()) {
            throw new MewsApiException("Mews credentials not configured (set MEWS_CLIENT_TOKEN and MEWS_ACCESS_TOKEN)");
        }

        String body;
        try {
            body = mapper.writeValueAsString(Map.of(
                    "ClientToken", config.clientToken(),
                    "AccessToken", config.accessToken(),
                    "Client", "Bliss B2B 1.0.0"));
        } catch (IOException e) {
            throw new MewsApiException("Could not build Mews request body: " + e.getMessage(), e);
        }

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(config.platformUrl() + "/api/connector/v1/configuration/get"))
                .timeout(Duration.ofSeconds(15))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new MewsApiException("Failed to reach Mews: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new MewsApiException("Interrupted while calling Mews", e);
        }

        if (response.statusCode() / 100 != 2) {
            throw new MewsApiException(
                    "Mews returned HTTP " + response.statusCode() + ": " + truncate(response.body()));
        }

        try {
            ConfigurationEnvelope env = mapper.readValue(response.body(), ConfigurationEnvelope.class);
            Enterprise e = env.enterprise();
            Address addr = e == null ? null : e.address();
            return new ConnectionInfo(
                    e == null ? null : e.name(),
                    addr == null ? null : addr.city(),
                    addr == null ? null : addr.countryCode());
        } catch (IOException e) {
            throw new MewsApiException("Could not parse Mews configuration: " + e.getMessage(), e);
        }
    }

    /** Identity of the connected Mews enterprise. */
    public record ConnectionInfo(String enterpriseName, String city, String countryCode) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ConfigurationEnvelope(@JsonProperty("Enterprise") Enterprise enterprise) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Enterprise(
            @JsonProperty("Name") String name,
            @JsonProperty("Address") Address address) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Address(
            @JsonProperty("City") String city,
            @JsonProperty("CountryCode") String countryCode) {}

    private static String truncate(String body) {
        if (body == null) {
            return "";
        }
        return body.length() > 500 ? body.substring(0, 500) + "..." : body;
    }

    /** Mews wraps the array under {@code Reservations}; tolerate {@code Bookings} too. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record ReservationsEnvelope(
            @JsonAlias({"Reservations", "Bookings"}) List<MewsBookingDTO> reservations) {
    }
}

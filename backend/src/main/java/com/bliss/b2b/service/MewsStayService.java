package com.bliss.b2b.service;

import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MewsConnection;
import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.MewsAdapter.StayPrice;
import com.bliss.b2b.integration.pms.MewsAdapterFactory;
import com.bliss.b2b.integration.pms.MewsCatalog;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantMewsConnectionDao;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Prices a stay at a Mews property against its own Mews: which rooms exist,
 * whether the chosen one is free every night, and what the Bliss rate costs
 * for those dates and adults. The quote is the only source of a Mews plan's
 * total; the amount in the checkout URL is a display hint and is never used.
 *
 * <p>Two caches, both short. The catalogue (services and room categories)
 * changes rarely and is kept five minutes. Quotes are kept sixty seconds, the
 * window Mews' best practices ask integrations to cache availability and
 * pricing for, so a guest changing the adult count back and forth does not
 * hammer the property's rate limit.
 */
public class MewsStayService {

    private static final Logger log = LoggerFactory.getLogger(MewsStayService.class);

    static final Duration CATALOGUE_TTL = Duration.ofMinutes(5);
    static final Duration QUOTE_TTL = Duration.ofSeconds(60);
    /** Longest stay a plan can be written against. Mews availability allows far more. */
    static final int MAX_NIGHTS = 30;

    private final Jdbi jdbi;
    private final MewsAdapterFactory adapterFactory;
    private final Clock clock;

    private final Map<UUID, Cached<Catalogue>> catalogues = new ConcurrentHashMap<>();
    private final Map<QuoteKey, Cached<StayQuote>> quotes = new ConcurrentHashMap<>();

    public MewsStayService(Jdbi jdbi, MewsAdapterFactory adapterFactory, Clock clock) {
        this.jdbi = jdbi;
        this.adapterFactory = adapterFactory;
        this.clock = clock;
    }

    /**
     * Quotes a stay. {@code categoryId} wins when it names one of the
     * property's rooms; otherwise {@code roomName} (the booking engine's room
     * label) is matched against room names. With neither resolving, the quote
     * comes back unpriced with {@code reason = "choose_room"} and the room list,
     * so the guest can pick.
     *
     * @param adults null picks a default: two, or the room's capacity if smaller
     */
    public StayQuote quote(String merchantSlug, LocalDate checkin, LocalDate checkout,
            String categoryId, String roomName, Integer adults) {
        Ctx ctx = context(merchantSlug);
        validateDates(checkin, checkout);

        Catalogue catalogue = catalogue(ctx);
        MewsCatalog.ResourceCategory room = resolveRoom(catalogue.rooms(), categoryId, roomName).orElse(null);
        List<RoomOption> roomOptions = catalogue.rooms().stream()
                .map(r -> new RoomOption(r.id(), r.name(), r.capacity()))
                .toList();
        if (room == null) {
            return StayQuote.unpriced(roomOptions, null, null, 0, "choose_room");
        }

        int maxAdults = room.capacity();
        int guestCount = adults == null ? Math.min(2, maxAdults) : adults;
        if (guestCount < 1 || guestCount > maxAdults) {
            throw new MewsStayException("invalid_adults",
                    room.name() + " sleeps up to " + maxAdults + " adult" + (maxAdults == 1 ? "" : "s") + ".");
        }

        QuoteKey key = new QuoteKey(ctx.merchant().id(), checkin, checkout, room.id(), guestCount);
        return cached(quotes, key, QUOTE_TTL, () ->
                priceRoom(ctx, catalogue, room, roomOptions, checkin, checkout, guestCount));
    }

    /**
     * A fresh, uncached quote, for plan creation. The price a plan is written
     * against must be what Mews says now, not what it said a minute ago.
     */
    public StayQuote quoteFresh(String merchantSlug, LocalDate checkin, LocalDate checkout,
            String categoryId, int adults) {
        Ctx ctx = context(merchantSlug);
        validateDates(checkin, checkout);
        Catalogue catalogue = catalogue(ctx);
        MewsCatalog.ResourceCategory room = resolveRoom(catalogue.rooms(), categoryId, null)
                .orElseThrow(() -> new MewsStayException("unknown_room", "Choose a room."));
        if (adults < 1 || adults > room.capacity()) {
            throw new MewsStayException("invalid_adults",
                    room.name() + " sleeps up to " + room.capacity() + " adults.");
        }
        List<RoomOption> roomOptions = catalogue.rooms().stream()
                .map(r -> new RoomOption(r.id(), r.name(), r.capacity()))
                .toList();
        StayQuote fresh = priceRoom(ctx, catalogue, room, roomOptions, checkin, checkout, adults);
        quotes.put(new QuoteKey(ctx.merchant().id(), checkin, checkout, room.id(), adults),
                new Cached<>(fresh, Instant.now(clock).plus(QUOTE_TTL)));
        return fresh;
    }

    private StayQuote priceRoom(Ctx ctx, Catalogue catalogue, MewsCatalog.ResourceCategory room,
            List<RoomOption> roomOptions, LocalDate checkin, LocalDate checkout, int adults) {
        MewsConnection conn = ctx.connection();
        ZoneId zone = ZoneId.of(conn.timeZone());
        StayTimes times = stayTimes(zone, checkin, checkout, catalogue.service());
        MewsAdapter adapter = adapterFactory.adapterForConnection(conn);
        try {
            int[] free = adapter.getFreeRoomsPerNight(conn.serviceId(), times.firstNightUtc(), times.lastNightUtc())
                    .get(room.id());
            boolean available = free != null && free.length > 0;
            if (free != null) {
                for (int n : free) {
                    available &= n > 0;
                }
            }
            if (!available) {
                return StayQuote.unpriced(roomOptions, room.id(), conn.blissRateId(), adults, "sold_out");
            }
            StayPrice price = adapter.priceStay(conn.serviceId(), room.id(), conn.blissRateId(),
                    conn.adultAgeCategoryId(), adults, times.startUtc(), times.endUtc());
            if (conn.currency() != null && !conn.currency().equalsIgnoreCase(price.currency())) {
                // Plan amounts are labelled in the connection's currency. A price in
                // another one would be charged under the wrong label.
                throw new MewsStayException("currency_mismatch",
                        "Mews priced this stay in " + price.currency() + ", but the property charges in "
                                + conn.currency() + ".");
            }
            return new StayQuote(roomOptions, room.id(), conn.blissRateId(), adults, room.capacity(),
                    true, price.totalMinorUnits(), price.currency(), times.startUtc(), times.endUtc(), null);
        } catch (PmsAdapterException e) {
            log.warn("Mews stay quote failed for merchant {}: {}", ctx.merchant().id(), e.getMessage());
            throw new MewsStayException("mews_unreachable",
                    "We couldn't reach the property's booking system. Try again in a moment.");
        }
    }

    /**
     * Arrival and departure as Mews wants them: the service's check-in and
     * check-out times on those dates, in the property's time zone, as UTC. The
     * offsets are added to local wall-clock midnight, so a daylight-saving
     * change on the arrival date does not shift check-in by an hour.
     */
    static StayTimes stayTimes(ZoneId zone, LocalDate checkin, LocalDate checkout, MewsCatalog.Service service) {
        Duration in = service.startOffset() == null ? Duration.ZERO : service.startOffset();
        Duration out = service.endOffset() == null ? Duration.ZERO : service.endOffset();
        Instant startUtc = checkin.atStartOfDay().plus(in).atZone(zone).toInstant();
        Instant endUtc = checkout.atStartOfDay().plus(out).atZone(zone).toInstant();
        Instant firstNight = checkin.atStartOfDay(zone).toInstant();
        Instant lastNight = checkout.minusDays(1).atStartOfDay(zone).toInstant();
        return new StayTimes(startUtc, endUtc, firstNight, lastNight);
    }

    public record StayTimes(Instant startUtc, Instant endUtc, Instant firstNightUtc, Instant lastNightUtc) {
    }

    /** Arrival and departure instants for a property's stay, from its cached catalogue. */
    public StayTimes timesFor(String merchantSlug, LocalDate checkin, LocalDate checkout) {
        Ctx ctx = context(merchantSlug);
        return stayTimes(ZoneId.of(ctx.connection().timeZone()), checkin, checkout, catalogue(ctx).service());
    }

    /** Exact id first, then an exact name, then a name containing the label (either way round). */
    static Optional<MewsCatalog.ResourceCategory> resolveRoom(
            List<MewsCatalog.ResourceCategory> rooms, String categoryId, String roomName) {
        if (categoryId != null && !categoryId.isBlank()) {
            Optional<MewsCatalog.ResourceCategory> byId =
                    rooms.stream().filter(r -> r.id().equals(categoryId)).findFirst();
            if (byId.isPresent()) {
                return byId;
            }
        }
        if (roomName == null || roomName.isBlank()) {
            return Optional.empty();
        }
        String wanted = normalize(roomName);
        Optional<MewsCatalog.ResourceCategory> exact =
                rooms.stream().filter(r -> normalize(r.name()).equals(wanted)).findFirst();
        if (exact.isPresent()) {
            return exact;
        }
        List<MewsCatalog.ResourceCategory> partial = rooms.stream()
                .filter(r -> {
                    String name = normalize(r.name());
                    return !name.isEmpty() && (name.contains(wanted) || wanted.contains(name));
                })
                .toList();
        // Only a single partial match is trusted; two means the label is ambiguous.
        return partial.size() == 1 ? Optional.of(partial.get(0)) : Optional.empty();
    }

    private static String normalize(String s) {
        return s == null ? "" : s.trim().toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
    }

    private void validateDates(LocalDate checkin, LocalDate checkout) {
        if (checkin == null || checkout == null) {
            throw new MewsStayException("invalid_dates", "Check-in and check-out dates are required.");
        }
        if (!checkout.isAfter(checkin)) {
            throw new MewsStayException("invalid_dates", "Check-out must be after check-in.");
        }
        if (checkin.isBefore(LocalDate.now(clock))) {
            throw new MewsStayException("invalid_dates", "Check-in is in the past.");
        }
        if (ChronoUnit.DAYS.between(checkin, checkout) > MAX_NIGHTS) {
            throw new MewsStayException("invalid_dates", "Stays are limited to " + MAX_NIGHTS + " nights.");
        }
    }

    private Ctx context(String merchantSlug) {
        return jdbi.withHandle(h -> {
            Merchant merchant = h.attach(MerchantDao.class).findBySlug(merchantSlug)
                    .orElseThrow(() -> new MewsStayException("not_found", "We can't find that property."));
            if (merchant.pmsType() != PmsType.MEWS) {
                throw new MewsStayException("not_mews_rail", "This property does not book through Mews.");
            }
            MewsConnection conn = h.attach(MerchantMewsConnectionDao.class).findByMerchant(merchant.id())
                    .filter(MewsConnection::isValidated)
                    .filter(MewsConnection::isBookingSetupComplete)
                    .orElseThrow(() -> new MewsStayException("not_ready",
                            "This property isn't taking plan bookings yet."));
            return new Ctx(merchant, conn);
        });
    }

    private Catalogue catalogue(Ctx ctx) {
        return cached(catalogues, ctx.merchant().id(), CATALOGUE_TTL, () -> {
            MewsConnection conn = ctx.connection();
            MewsAdapter adapter = adapterFactory.adapterForConnection(conn);
            try {
                MewsCatalog.Service service = adapter.getBookableServices().stream()
                        .filter(s -> s.id().equals(conn.serviceId()))
                        .findFirst()
                        .orElseThrow(() -> new MewsStayException("not_ready",
                                "This property's booking setup points at a service Mews no longer has."));
                List<MewsCatalog.ResourceCategory> rooms = adapter.getResourceCategories(conn.serviceId()).stream()
                        .filter(r -> r.active() && r.capacity() > 0)
                        .toList();
                return new Catalogue(service, rooms);
            } catch (PmsAdapterException e) {
                log.warn("Mews catalogue read failed for merchant {}: {}", ctx.merchant().id(), e.getMessage());
                throw new MewsStayException("mews_unreachable",
                        "We couldn't reach the property's booking system. Try again in a moment.");
            }
        });
    }

    private <K, V> V cached(Map<K, Cached<V>> cache, K key, Duration ttl, Supplier<V> load) {
        Instant now = Instant.now(clock);
        Cached<V> hit = cache.get(key);
        if (hit != null && hit.expiresAt().isAfter(now)) {
            return hit.value();
        }
        V value = load.get();
        cache.put(key, new Cached<>(value, now.plus(ttl)));
        return value;
    }

    private record Ctx(Merchant merchant, MewsConnection connection) {
    }

    private record Catalogue(MewsCatalog.Service service, List<MewsCatalog.ResourceCategory> rooms) {
    }

    private record Cached<V>(V value, Instant expiresAt) {
    }

    private record QuoteKey(UUID merchantId, LocalDate checkin, LocalDate checkout, String categoryId, int adults) {
    }

    /** A room the guest can pick, with how many adults it sleeps. */
    public record RoomOption(String id, String name, int capacity) {
    }

    /**
     * {@code available} true means {@code totalCents} is Mews' tax-inclusive
     * price for the Bliss rate. Otherwise {@code reason} is {@code choose_room}
     * or {@code sold_out} and there is no price. {@code startUtc}/{@code endUtc}
     * are what reservations/add will be sent.
     */
    public record StayQuote(
            List<RoomOption> rooms,
            String categoryId,
            String rateId,
            int adults,
            int maxAdults,
            boolean available,
            Long totalCents,
            String currency,
            Instant startUtc,
            Instant endUtc,
            String reason) {

        static StayQuote unpriced(List<RoomOption> rooms, String categoryId, String rateId, int adults,
                String reason) {
            int max = rooms.stream().filter(r -> r.id().equals(categoryId))
                    .mapToInt(RoomOption::capacity).findFirst().orElse(0);
            return new StayQuote(rooms, categoryId, rateId, adults, max, false, null, null, null, null, reason);
        }
    }

    /** A quote that could not be produced, with a stable code for the API. */
    public static class MewsStayException extends RuntimeException {
        private final String code;

        public MewsStayException(String code, String message) {
            super(message);
            this.code = code;
        }

        public String code() {
            return code;
        }
    }
}

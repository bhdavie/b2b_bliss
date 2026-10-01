package com.bliss.b2b.payments;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Period;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;

/**
 * A rate's cancellation terms as Mews defines them: the active cancellation
 * policies on its rate group (cancellationPolicies/getAll). No steps means the
 * guest can cancel free until arrival. Snapshotted onto each booking, so later
 * policy edits in Mews only affect new bookings.
 *
 * <p>A step applies from a moment: {@code Creation} counts its offset forward
 * from when the reservation was made; {@code Start} counts it back from the
 * stay's start; {@code StartDate} back from the start of the arrival day, in
 * the property's zone. From then on the fee applies: the larger of
 * {@code relativeFee} (a fraction of the stay, over {@code feeExtent}, capped
 * at {@code feeMaximumTimeUnits} nights) and {@code absoluteFee}.
 */
public record CancellationTerms(List<Step> steps) {

    public CancellationTerms {
        steps = steps == null ? List.of() : List.copyOf(steps);
    }

    /** No policy: free cancellation until arrival. */
    public static CancellationTerms freeUntilArrival() {
        return new CancellationTerms(List.of());
    }

    /**
     * Non-refundable when a step charges the whole stay from the moment the
     * reservation is made; refundable otherwise (including a partial penalty
     * from booking, since some money still comes back).
     */
    public BookingType derivedType() {
        for (Step s : steps) {
            if ("Creation".equals(s.applicability())
                    && isZero(s.applicabilityOffset())
                    && s.relativeFee() != null
                    && s.relativeFee().compareTo(BigDecimal.ONE) >= 0
                    && s.feeMaximumTimeUnits() == null
                    && ("TimeUnits".equals(s.feeExtent()) || "Everything".equals(s.feeExtent()))) {
                return BookingType.NON_REFUNDABLE;
            }
        }
        return BookingType.REFUNDABLE;
    }

    /**
     * The last moment the guest can cancel without any fee: the earliest
     * moment a step starts to apply, or the stay's start when there are no
     * steps. Never after the start.
     */
    public Instant freeCancellationUntil(Instant createdUtc, Instant startUtc, ZoneId zone) {
        Instant until = startUtc;
        for (Step s : steps) {
            Instant from = appliesFrom(s, createdUtc, startUtc, zone);
            if (from != null && from.isBefore(until)) {
                until = from;
            }
        }
        return until;
    }

    /**
     * The fee the hotel's policy charges for cancelling at {@code at}, in the
     * stay's currency's minor units: across the steps that apply by then, the
     * largest of each step's relative fee and absolute fee. The relative fee is
     * a fraction of the stay total, limited to {@code feeMaximumTimeUnits}
     * nights when set; a step on products only charges nothing here, since
     * Bliss prices the stay. Zero when no step applies yet.
     */
    public long penaltyAt(Instant at, Instant createdUtc, Instant startUtc, ZoneId zone,
            long stayTotalMinor, long nights, String currency) {
        long penalty = 0L;
        for (Step s : steps) {
            Instant from = appliesFrom(s, createdUtc, startUtc, zone);
            if (from == null || at.isBefore(from)) {
                continue;
            }
            long relative = 0L;
            if (s.relativeFee() != null
                    && ("TimeUnits".equals(s.feeExtent()) || "Everything".equals(s.feeExtent()))) {
                BigDecimal base = BigDecimal.valueOf(stayTotalMinor);
                if (s.feeMaximumTimeUnits() != null && nights > 0 && s.feeMaximumTimeUnits() < nights) {
                    base = base.multiply(BigDecimal.valueOf(s.feeMaximumTimeUnits()))
                            .divide(BigDecimal.valueOf(nights), 0, java.math.RoundingMode.HALF_UP);
                }
                relative = base.multiply(s.relativeFee()).setScale(0, java.math.RoundingMode.HALF_UP).longValueExact();
            }
            long absolute = s.absoluteFeeMinor() != null && currency != null
                    && currency.equalsIgnoreCase(s.absoluteFeeCurrency()) ? s.absoluteFeeMinor() : 0L;
            penalty = Math.max(penalty, Math.max(relative, absolute));
        }
        return Math.min(penalty, stayTotalMinor);
    }

    /**
     * The terms in a line a hotel or guest reads: "Free cancellation until
     * arrival", "Free cancellation until 14 days before arrival",
     * "Free cancellation for 2 days after booking", "A cancellation fee applies
     * from booking", or "Non-refundable".
     */
    public String describe() {
        if (steps.isEmpty()) {
            return "Free cancellation until arrival";
        }
        if (derivedType() == BookingType.NON_REFUNDABLE) {
            return "Non-refundable";
        }
        // The step that applies earliest decides the free window. Compare by
        // a fixed reference stay, since "before arrival" and "after booking"
        // are on different clocks.
        Instant created = Instant.parse("2030-01-01T00:00:00Z");
        Instant start = Instant.parse("2030-07-01T00:00:00Z");
        Step earliest = null;
        Instant earliestAt = null;
        for (Step st : steps) {
            Instant at = appliesFrom(st, created, start, java.time.ZoneOffset.UTC);
            if (at != null && (earliestAt == null || at.isBefore(earliestAt))) {
                earliest = st;
                earliestAt = at;
            }
        }
        if (earliest == null) {
            return "Free cancellation until arrival";
        }
        Offset o = Offset.parse(earliest.applicabilityOffset());
        boolean zero = o.period().isZero() && o.duration().isZero();
        if ("Creation".equals(earliest.applicability())) {
            return zero ? "A cancellation fee applies from booking"
                    : "Free cancellation for " + humanize(o) + " after booking";
        }
        return zero ? "Free cancellation until arrival"
                : "Free cancellation until " + humanize(o) + " before arrival";
    }

    private static String humanize(Offset o) {
        java.util.List<String> parts = new java.util.ArrayList<>();
        Period p = o.period().normalized();
        // Whole days written in hours ("PT48H") read as days.
        Duration d = o.duration();
        long wholeDays = d.toMinutes() % (24 * 60) == 0 ? d.toDays() : 0;
        if (wholeDays > 0) {
            p = p.plusDays(wholeDays);
            d = d.minusDays(wholeDays);
        }
        if (p.getYears() > 0) parts.add(unit(p.getYears(), "year"));
        if (p.getMonths() > 0) parts.add(unit(p.getMonths(), "month"));
        if (p.getDays() > 0) parts.add(unit(p.getDays(), "day"));
        long hours = d.toHours();
        long minutes = d.toMinutesPart();
        if (hours > 0) parts.add(unit((int) hours, "hour"));
        if (minutes > 0) parts.add(unit((int) minutes, "minute"));
        return parts.isEmpty() ? "0 days" : String.join(" ", parts);
    }

    private static String unit(int n, String word) {
        return n + " " + word + (n == 1 ? "" : "s");
    }

    private static Instant appliesFrom(Step s, Instant createdUtc, Instant startUtc, ZoneId zone) {
        String offset = s.applicabilityOffset();
        return switch (s.applicability() == null ? "" : s.applicability()) {
            case "Creation" -> createdUtc == null ? null : plus(createdUtc.atZone(zone), offset).toInstant();
            case "Start" -> minus(startUtc.atZone(zone), offset).toInstant();
            case "StartDate" -> {
                LocalDate arrival = startUtc.atZone(zone).toLocalDate();
                yield minus(arrival.atStartOfDay(zone), offset).toInstant();
            }
            default -> null;
        };
    }

    private static ZonedDateTime plus(ZonedDateTime t, String isoOffset) {
        Offset o = Offset.parse(isoOffset);
        return t.plus(o.period()).plus(o.duration());
    }

    private static ZonedDateTime minus(ZonedDateTime t, String isoOffset) {
        Offset o = Offset.parse(isoOffset);
        return t.minus(o.period()).minus(o.duration());
    }

    private static boolean isZero(String isoOffset) {
        Offset o = Offset.parse(isoOffset);
        return o.period().isZero() && o.duration().isZero();
    }

    /**
     * Mews writes offsets as full ISO 8601 durations with a date part, such as
     * {@code P0M0DT0H0M0S} or {@code P14D}, which neither {@link Period} nor
     * {@link Duration} parses alone. Split at the {@code T}.
     */
    record Offset(Period period, Duration duration) {
        static Offset parse(String iso) {
            if (iso == null || iso.isBlank()) {
                return new Offset(Period.ZERO, Duration.ZERO);
            }
            String s = iso.trim().toUpperCase(java.util.Locale.ROOT);
            boolean negative = s.startsWith("-");
            if (negative) s = s.substring(1);
            if (!s.startsWith("P")) {
                throw new IllegalArgumentException("not an ISO 8601 duration: " + iso);
            }
            int t = s.indexOf('T');
            String datePart = t < 0 ? s : s.substring(0, t);
            String timePart = t < 0 ? "" : s.substring(t + 1);
            Period period = datePart.equals("P") ? Period.ZERO : Period.parse(datePart);
            Duration duration = timePart.isEmpty() ? Duration.ZERO : Duration.parse("PT" + timePart);
            return negative ? new Offset(period.negated(), duration.negated()) : new Offset(period, duration);
        }
    }

    /**
     * One active Mews cancellation policy. {@code absoluteFeeMinor} is in
     * {@code absoluteFeeCurrency}'s minor units; null when the policy sets none.
     */
    public record Step(
            String applicability,
            String applicabilityOffset,
            String feeExtent,
            BigDecimal relativeFee,
            Long absoluteFeeMinor,
            String absoluteFeeCurrency,
            Integer feeMaximumTimeUnits) {
    }
}

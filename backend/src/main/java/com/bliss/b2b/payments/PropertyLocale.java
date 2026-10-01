package com.bliss.b2b.payments;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.Locale;

/**
 * The currency, time zone and locale a property trades in, as snapshotted on a
 * booking. Amounts on the booking and its plans are minor units of
 * {@code currency}; due dates are calendar days in {@code timeZone}.
 *
 * <p>The currency is required. The zone and locale are not, only so bookings
 * made before V36 still read: a missing zone is UTC (how every due date was read
 * before) and a missing locale formats in plain English rather than US English.
 */
public record PropertyLocale(String currency, String timeZone, String localeTag) {

    public PropertyLocale {
        currency = Money.code(currency);
        if (timeZone != null && timeZone.isBlank()) timeZone = null;
        if (localeTag != null && localeTag.isBlank()) localeTag = null;
        if (timeZone != null) {
            try {
                ZoneId.of(timeZone);
            } catch (DateTimeException e) {
                throw new IllegalArgumentException("unknown time zone '" + timeZone + "'", e);
            }
        }
    }

    /** The property's zone; UTC only for a pre-V36 booking that never had one. */
    public ZoneId zone() {
        return timeZone == null ? ZoneId.of("UTC") : ZoneId.of(timeZone);
    }

    public Locale locale() {
        return locale(localeTag);
    }

    /** Today's calendar date at the property. */
    public LocalDate today(Clock clock) {
        return LocalDate.now(clock.withZone(zone()));
    }

    public String format(long minorUnits) {
        return Money.format(minorUnits, currency, locale());
    }

    /** "Friday 15 January 2027" in en-GB, "Friday, January 15, 2027" in en-US. */
    public String longDate(LocalDate date) {
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale()).format(date);
    }

    /** "15 Jan 2027" in en-GB, "Jan 15, 2027" in en-US. */
    public String mediumDate(LocalDate date) {
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale()).format(date);
    }

    /** "15 January 2027" in en-GB, "January 15, 2027" in en-US. */
    public String date(LocalDate date) {
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale()).format(date);
    }

    /**
     * Today's date in an IANA zone, for code that has a zone but no currency
     * (a property that has not connected yet). Null or blank reads as UTC, the
     * pre-V36 behaviour.
     */
    public static LocalDate today(Clock clock, String timeZone) {
        ZoneId zone = timeZone == null || timeZone.isBlank() ? ZoneId.of("UTC") : ZoneId.of(timeZone);
        return LocalDate.now(clock.withZone(zone));
    }

    static Locale locale(String tag) {
        if (tag == null || tag.isBlank()) {
            return Locale.ENGLISH;
        }
        Locale l = Locale.forLanguageTag(tag.trim());
        return l.getLanguage().isEmpty() ? Locale.ENGLISH : l;
    }
}

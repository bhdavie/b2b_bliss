package com.bliss.b2b.payments;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.util.Currency;
import java.util.Locale;

/**
 * Currency-aware conversions and formatting for integer minor-unit amounts.
 *
 * <p>Every amount in Bliss is a {@code long} of minor units of some ISO 4217
 * currency: cents for USD/GBP/EUR, whole yen for JPY, fils (thousandths) for
 * KWD. The columns and fields keep their historical {@code *_cents} names, but
 * the scale is always the currency's own, read from {@link Currency}, never an
 * assumed 2.
 */
public final class Money {

    private Money() {
    }

    /**
     * The {@link Currency} for an ISO code, case-insensitive. Throws for a null,
     * blank or unknown code: a missing currency is a setup problem, and guessing
     * one would charge the wrong amount.
     */
    public static Currency currency(String code) {
        if (code == null || code.isBlank()) {
            throw new IllegalArgumentException("currency is required");
        }
        try {
            return Currency.getInstance(code.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("unknown currency '" + code + "'", e);
        }
    }

    /** Normalised ISO code ("gbp" -> "GBP"), validated. */
    public static String code(String code) {
        return currency(code).getCurrencyCode();
    }

    /** Minor-unit exponent: 2 for USD, 0 for JPY, 3 for KWD. */
    public static int minorDigits(String code) {
        int digits = currency(code).getDefaultFractionDigits();
        // Pseudo-currencies (XAU, XXX) report -1; they are never charged.
        if (digits < 0) {
            throw new IllegalArgumentException("currency '" + code + "' has no minor unit");
        }
        return digits;
    }

    /**
     * Minor units to a major-unit decimal at the currency's exact scale
     * (1234 GBP -> 12.34, 1234 JPY -> 1234, 1234 KWD -> 1.234).
     */
    public static BigDecimal toMajor(long minorUnits, String code) {
        int digits = minorDigits(code);
        return BigDecimal.valueOf(minorUnits, digits);
    }

    /**
     * A major-unit decimal to minor units. Throws when the value has more
     * decimal places than the currency allows, rather than rounding money away.
     */
    public static long toMinor(BigDecimal major, String code) {
        int digits = minorDigits(code);
        try {
            return major.setScale(digits, java.math.RoundingMode.UNNECESSARY)
                    .movePointRight(digits)
                    .longValueExact();
        } catch (ArithmeticException e) {
            throw new IllegalArgumentException(
                    major.toPlainString() + " is not a whole number of " + code + " minor units", e);
        }
    }

    /**
     * Formats an amount for people: symbol, grouping and decimals as the locale
     * writes this currency ("£1,234.56" in en-GB, "1.234,56 €" in de-DE,
     * "¥1,234" in ja-JP). The decimals are always the currency's own.
     */
    public static String format(long minorUnits, String code, Locale locale) {
        Currency currency = currency(code);
        NumberFormat nf = NumberFormat.getCurrencyInstance(locale == null ? Locale.ENGLISH : locale);
        nf.setCurrency(currency);
        int digits = minorDigits(code);
        nf.setMinimumFractionDigits(digits);
        nf.setMaximumFractionDigits(digits);
        return nf.format(toMajor(minorUnits, code));
    }

    /** {@link #format} with the locale given as a BCP 47 tag; null or blank reads as plain English. */
    public static String format(long minorUnits, String code, String localeTag) {
        return format(minorUnits, code, PropertyLocale.locale(localeTag));
    }
}

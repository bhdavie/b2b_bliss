package com.bliss.b2b.payments;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Locale;
import org.junit.jupiter.api.Test;

class MoneyTest {

    @Test
    void minorDigitsAreTheCurrencysOwn() {
        assertThat(Money.minorDigits("USD")).isEqualTo(2);
        assertThat(Money.minorDigits("gbp")).isEqualTo(2);
        assertThat(Money.minorDigits("JPY")).isEqualTo(0);
        assertThat(Money.minorDigits("KWD")).isEqualTo(3);
    }

    @Test
    void conversionsAreExactAtEachScale() {
        assertThat(Money.toMajor(123_456L, "GBP")).isEqualByComparingTo("1234.56");
        assertThat(Money.toMajor(12_000L, "JPY")).isEqualByComparingTo("12000");
        assertThat(Money.toMajor(12_345L, "KWD").toPlainString()).isEqualTo("12.345");
        assertThat(Money.toMinor(new BigDecimal("1234.56"), "EUR")).isEqualTo(123_456L);
        assertThat(Money.toMinor(new BigDecimal("12000"), "JPY")).isEqualTo(12_000L);
        assertThatThrownBy(() -> Money.toMinor(new BigDecimal("0.5"), "JPY"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void thereIsNoDefaultCurrency() {
        assertThatThrownBy(() -> Money.currency(null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Money.currency(" ")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Money.currency("ZZZ")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void formatsAsThePropertysLocaleWritesTheCurrency() {
        assertThat(Money.format(123_456L, "GBP", Locale.forLanguageTag("en-GB"))).isEqualTo("£1,234.56");
        assertThat(Money.format(123_456L, "USD", Locale.forLanguageTag("en-US"))).isEqualTo("$1,234.56");
        assertThat(Money.format(12_000L, "JPY", Locale.forLanguageTag("ja-JP"))).contains("12,000")
                .doesNotContain(".");
        // de-DE writes the decimal comma; normalise the narrow no-break space Java may use.
        assertThat(Money.format(123_456L, "EUR", Locale.forLanguageTag("de-DE")).replace(' ', ' '))
                .isEqualTo("1.234,56 €");
        assertThat(Money.format(12_345L, "KWD", Locale.forLanguageTag("en-GB"))).contains("12.345");
    }

    @Test
    void propertyLocaleUsesThePropertysDayAndFormats() {
        // 03:00 UTC on 15 Jan is still 14 Jan in Los Angeles and already 15 Jan in Tokyo.
        Clock clock = Clock.fixed(Instant.parse("2027-01-15T03:00:00Z"), ZoneOffset.UTC);
        assertThat(new PropertyLocale("USD", "America/Los_Angeles", "en-US").today(clock))
                .isEqualTo(LocalDate.of(2027, 1, 14));
        assertThat(new PropertyLocale("JPY", "Asia/Tokyo", "ja-JP").today(clock))
                .isEqualTo(LocalDate.of(2027, 1, 15));
        // A pre-V36 booking with no zone keeps the UTC reading.
        assertThat(new PropertyLocale("USD", null, null).today(clock)).isEqualTo(LocalDate.of(2027, 1, 15));

        LocalDate d = LocalDate.of(2027, 1, 15);
        assertThat(new PropertyLocale("GBP", "Europe/London", "en-GB").date(d)).isEqualTo("15 January 2027");
        assertThat(new PropertyLocale("USD", "America/New_York", "en-US").date(d)).isEqualTo("January 15, 2027");
    }

    @Test
    void propertyLocaleRefusesBadSetup() {
        assertThatThrownBy(() -> new PropertyLocale(null, "UTC", "en"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PropertyLocale("GBP", "Mars/Olympus", "en"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}

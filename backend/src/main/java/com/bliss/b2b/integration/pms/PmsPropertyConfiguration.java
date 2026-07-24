package com.bliss.b2b.integration.pms;

/**
 * Identity and money settings of the connected PMS property, as read by
 * {@link PmsAdapter#getPropertyConfiguration()}.
 *
 * <p>{@code defaultCurrency} is the property's default enabled currency (ISO
 * 4217). {@code pricing} is "Gross" or "Net" and matters for how amounts are
 * interpreted when charging is added later. Fields are nullable because a given
 * PMS may not populate all of them.
 */
public record PmsPropertyConfiguration(
        String enterpriseId,
        String name,
        String defaultCurrency,
        String countryCode,
        String pricing,
        String timeZoneIdentifier) {
}

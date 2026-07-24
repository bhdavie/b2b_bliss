package com.bliss.b2b.integration.pms;

/**
 * A customer as it exists in the PMS, returned by
 * {@link PmsAdapter#findOrCreateCustomer}. {@code id} is the PMS-native
 * identifier used to look up stored cards.
 */
public record PmsCustomer(String id, String firstName, String lastName, String email) {
}

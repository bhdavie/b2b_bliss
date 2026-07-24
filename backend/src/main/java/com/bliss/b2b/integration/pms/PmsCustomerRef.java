package com.bliss.b2b.integration.pms;

/**
 * Identifying details for a customer lookup-or-create against a PMS.
 *
 * <p>{@code email} is the search key: {@link PmsAdapter#findOrCreateCustomer}
 * matches on it before creating anyone. {@code lastName} is required by Mews on
 * create; {@code firstName} is optional.
 */
public record PmsCustomerRef(String email, String firstName, String lastName) {
}

package com.bliss.b2b.integration.pms;

import java.time.Instant;
import java.util.List;

/**
 * Abstraction over a Property Management System (PMS) that can hold customers
 * and their vaulted cards. The first implementation is {@link MewsAdapter}
 * against the Mews Connector API; the interface exists so a second PMS is a
 * new class, not a rewrite of the callers.
 *
 * <p>Scope: configuration, customers, stored cards, card collection, and
 * charging a vaulted card. Scheduler wiring (deciding <em>when</em> to charge)
 * lives outside this interface and is not built yet, so nothing here touches
 * the existing Stripe execution path.
 *
 * <p>Every method throws {@link PmsAdapterException} on missing credentials,
 * invalid input, transport failure, a non-2xx response, or an unparseable body.
 * The one exception is a payment-level decline: see
 * {@link #chargeStoredCard}, which returns the decline as a result status
 * rather than throwing.
 */
public interface PmsAdapter {

    /**
     * Reads the connected property's identity and money settings (currency,
     * gross/net pricing, timezone). Used to prove a set of credentials resolves
     * to a live property and to learn how amounts should be interpreted.
     */
    PmsPropertyConfiguration getPropertyConfiguration();

    /**
     * Looks the customer up by email and returns the existing record if one is
     * found; otherwise creates a new customer from {@code ref} and returns it.
     * Search-first so repeated runs against the same property do not pile up
     * duplicates.
     */
    PmsCustomer findOrCreateCustomer(PmsCustomerRef ref);

    /**
     * Lists the cards vaulted against the given PMS customer. Returns an empty
     * list when the customer has none. Only masked, non-sensitive card metadata
     * is returned.
     */
    List<PmsStoredCard> getStoredCards(String pmsCustomerId);

    /**
     * Creates a card-collection request against the given PMS customer. The
     * returned {@link PmsCardCollectionRequest#requestId()} is handed to the PMS
     * hosted card-entry surface (Mews Payments Checkout) so the customer can
     * enter a card, which the PMS then vaults for later off-session charging.
     *
     * @param pmsCustomerId the PMS-native customer id (Mews {@code AccountId})
     * @param expiration    when the request itself expires (not the card expiry)
     * @param description   customer-visible reason for the request
     */
    PmsCardCollectionRequest createCardCollectionRequest(
            String pmsCustomerId, Instant expiration, String description);

    /**
     * Charges an already-vaulted card off-session and reports the resulting
     * settlement state.
     *
     * <p>A payment the PMS accepts but that settles to failed/canceled is
     * returned as a {@link PmsChargeResult} with the corresponding
     * {@link PmsChargeStatus}, <em>not</em> thrown. Configuration, invalid
     * input, transport, and protocol errors (including a hard synchronous
     * rejection the PMS returns as a non-2xx response) throw
     * {@link PmsAdapterException}.
     *
     * @param pmsCustomerId   the PMS-native customer id (for validation/logging)
     * @param pmsCardId       the vaulted card id to charge (Mews {@code CreditCardId})
     * @param amountMinorUnits amount in integer minor units (e.g. pence/cents)
     * @param currency        ISO 4217 currency code, e.g. {@code "GBP"}
     * @param reservationRef  optional PMS reservation/booking id, may be null
     * @param notes           optional payment notes, may be null
     */
    PmsChargeResult chargeStoredCard(
            String pmsCustomerId,
            String pmsCardId,
            long amountMinorUnits,
            String currency,
            String reservationRef,
            String notes);
}

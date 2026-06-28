package com.bliss.b2b.integration;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * The slice of a Mews reservation we surface from the demo sync.
 *
 * <p>Sourced from the Connector API {@code reservations/getAll} endpoint, whose
 * objects carry an {@code Id}, lifecycle {@code State}, and {@code StartUtc} /
 * {@code EndUtc} stay dates. Guest name and price are deliberately omitted: they
 * are not on the reservation and would each require a separate Connector call
 * ({@code customers/getAll} and a pricing endpoint respectively).
 *
 * <p>Dates are kept as raw UTC strings (e.g. {@code 2026-06-25T00:59:39Z}) so a
 * format surprise can't fail the whole parse. Unknown fields are ignored.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record MewsBookingDTO(
        @JsonProperty("id") @JsonAlias("Id") String id,
        @JsonAlias({"StartUtc", "ArrivalUtc"}) String arrivalDate,
        @JsonAlias({"EndUtc", "DepartureUtc"}) String departureDate,
        @JsonAlias({"State", "Status"}) String status) {
}

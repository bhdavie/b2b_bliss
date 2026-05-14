package com.bliss.b2b.api;

public record AddressView(
        String line1,
        String line2,
        String city,
        String state,
        String zip,
        String country
) {}

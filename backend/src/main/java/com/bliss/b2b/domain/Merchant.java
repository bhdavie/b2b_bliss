package com.bliss.b2b.domain;

import java.time.Instant;
import java.util.UUID;

public record Merchant(
        UUID id,
        String slug,
        String email,
        String businessName,
        String businessType,
        String phone,
        String addressLine1,
        String addressLine2,
        String addressCity,
        String addressState,
        String addressZip,
        String addressCountry,
        String stripeConnectAccountId,
        String stripeConnectStatus,
        MerchantStatus status,
        Instant emailVerifiedAt,
        Instant createdAt,
        Instant updatedAt
) {
    public boolean onboardingComplete() {
        return businessName != null && !businessName.isBlank()
                && businessType != null && !businessType.isBlank();
    }
}

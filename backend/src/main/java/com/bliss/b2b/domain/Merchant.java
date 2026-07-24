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
        PmsType pmsType,
        OnboardingState onboardingState,
        Instant emailVerifiedAt,
        Instant createdAt,
        Instant updatedAt
) {
    /**
     * Setup is complete once the property reaches {@link OnboardingState#ACTIVE}.
     * (Previously derived from business profile fields; onboarding state is now
     * the source of truth, and pre-existing properties were backfilled to
     * active in V17 so they are unaffected.)
     */
    public boolean onboardingComplete() {
        return onboardingState == OnboardingState.ACTIVE;
    }
}

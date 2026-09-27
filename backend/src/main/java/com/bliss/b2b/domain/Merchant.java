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
        Instant updatedAt,
        // Shown to guests on checkout and in the plan portal when set.
        String logoUrl,
        // The connected Mews enterprise's name. Only the id/slug lookups
        // (MerchantDao.findById, findBySlug) join it in; elsewhere it is null.
        String mewsEnterpriseName
) {
    /**
     * The name a guest sees: the property's own business name, or for a Mews
     * property that has not filled in its profile yet, the name of its Mews
     * enterprise. Null when neither is known, and guest pages fall back to
     * neutral wording rather than inventing a name.
     */
    public String guestFacingName() {
        if (businessName != null && !businessName.isBlank()) {
            return businessName.trim();
        }
        if (pmsType == PmsType.MEWS && mewsEnterpriseName != null && !mewsEnterpriseName.isBlank()) {
            return mewsEnterpriseName.trim();
        }
        return null;
    }

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

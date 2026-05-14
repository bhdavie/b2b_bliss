package com.bliss.b2b.api;

import com.bliss.b2b.domain.Merchant;
import java.time.Instant;

public record MerchantView(
        String id,
        String email,
        String slug,
        String businessName,
        String businessType,
        String phone,
        AddressView address,
        String stripeConnectStatus,
        String status,
        boolean onboardingComplete,
        Instant emailVerifiedAt
) {
    public static MerchantView from(Merchant m) {
        return new MerchantView(
                m.id().toString(),
                m.email(),
                m.slug(),
                m.businessName(),
                m.businessType(),
                m.phone(),
                new AddressView(
                        m.addressLine1(),
                        m.addressLine2(),
                        m.addressCity(),
                        m.addressState(),
                        m.addressZip(),
                        m.addressCountry()
                ),
                m.stripeConnectStatus(),
                m.status().wire(),
                m.onboardingComplete(),
                m.emailVerifiedAt()
        );
    }
}

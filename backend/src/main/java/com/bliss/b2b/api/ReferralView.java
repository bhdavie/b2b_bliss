package com.bliss.b2b.api;

import com.bliss.b2b.domain.Referral;
import com.bliss.b2b.domain.ReferralStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Admin-facing shape of a referral. Statuses go out as their wire strings, the
 * same way MerchantView renders MerchantStatus. Admin only: it carries the
 * guest's email and the submitting IP, so nothing public returns it.
 */
public record ReferralView(
        UUID id,
        String guestEmail,
        String guestName,
        String hotelName,
        String hotelCity,
        String note,
        String status,
        UUID merchantId,
        String source,
        String sourceIp,
        Instant createdAt,
        Instant updatedAt
) {
    public static ReferralView from(Referral r) {
        return new ReferralView(
                r.id(), r.guestEmail(), r.guestName(), r.hotelName(), r.hotelCity(),
                r.note(), r.status().wire(), r.merchantId(), r.source(), r.sourceIp(),
                r.createdAt(), r.updatedAt());
    }

    /**
     * One referral plus the statuses it may move to next (empty for credited
     * and declined), so the admin form renders the options from the backend's
     * rule instead of mirroring it.
     * The current status is left out even where the rule would accept it
     * (declined to declined), since offering a no-op as a choice is noise.
     */
    public record Detail(ReferralView referral, List<String> allowedNextStatuses) {
        public static Detail from(Referral r) {
            return new Detail(
                    ReferralView.from(r),
                    r.status().allowedNext().stream()
                            .filter(s -> s != r.status())
                            .map(ReferralStatus::wire)
                            .toList());
        }
    }
}

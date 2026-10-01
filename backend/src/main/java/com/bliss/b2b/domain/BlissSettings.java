package com.bliss.b2b.domain;

import com.bliss.b2b.payments.PayoutMode;
import com.bliss.b2b.payments.ReleasePolicy;
import java.time.Instant;
import java.util.UUID;

/**
 * A property's own Bliss settings (V38). Anything not here has a default
 * elsewhere or comes from the property's PMS; see BlissSettingsService.
 */
public record BlissSettings(
        UUID merchantId,
        PayoutMode payoutMode,
        ReleasePolicy releasePolicy,
        int chargebackBufferDays,
        Instant blissEnabledAt,
        // False for a property with no row yet: every value above is a default.
        boolean stored
) {
    /** The defaults a property has before it changes anything (spec section 4). */
    public static BlissSettings defaults(UUID merchantId) {
        return new BlissSettings(merchantId, PayoutMode.PAY_AS_YOU_GO, ReleasePolicy.CANCELLATION_DEADLINE,
                3, null, false);
    }

    public boolean enabled() {
        return blissEnabledAt != null;
    }
}

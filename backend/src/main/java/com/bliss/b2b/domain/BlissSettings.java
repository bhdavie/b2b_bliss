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
        // The Bliss fee folio line (V39): the Mews additional service it posts
        // under (null until chosen), its tax code (null: untaxed) and
        // accounting category (null: the service's default).
        String feeServiceId,
        String feeTaxCode,
        String feeAccountingCategoryId,
        // False for a property with no row yet: every value above is a default.
        boolean stored
) {
    /** The defaults a property has before it changes anything (spec section 4). */
    public static BlissSettings defaults(UUID merchantId) {
        return new BlissSettings(merchantId, PayoutMode.PAY_AS_YOU_GO, ReleasePolicy.CANCELLATION_DEADLINE,
                3, null, null, null, null, false);
    }

    public boolean enabled() {
        return blissEnabledAt != null;
    }
}

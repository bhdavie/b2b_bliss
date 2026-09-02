package com.bliss.b2b.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** One versioned Bliss processing-fee rate for one property. */
public record MerchantFeeRate(
        UUID id,
        UUID merchantId,
        BigDecimal rate,
        Instant effectiveFrom,
        String note,
        UUID createdByAdminId,
        Instant createdAt
) {}

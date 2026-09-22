package com.bliss.b2b.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * A guest who has a referral link of their own. One row of {@code referrers}.
 *
 * <p>Identified by email: one referrer per address, forever, so asking for a
 * link twice returns the same code rather than minting a second one.
 *
 * <p>{@code magicToken} is a bearer secret for the guest's status page. It does
 * not expire and is not single-use, which is why it is here rather than in
 * {@code magic_link_tokens}; see V29 for that reasoning. Never log it and never
 * put it in a response that is not going to the guest who owns it.
 */
public record Referrer(
        UUID id,
        String email,
        String code,
        String magicToken,
        Instant createdAt
) {}

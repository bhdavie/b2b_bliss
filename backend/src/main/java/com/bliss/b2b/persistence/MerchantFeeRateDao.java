package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.MerchantFeeRate;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

/**
 * Versioned per-property fee rates. Append-only: a change is a new row with a
 * later effective_from, never an update, so a plan created under an old rate can
 * still be explained.
 */
@RegisterRowMapper(MerchantFeeRateRowMapper.class)
public interface MerchantFeeRateDao {

    /**
     * The rate in force at {@code at}: the greatest effective_from not after it.
     *
     * <p>{@code <=} rather than {@code <} so a row scheduled for exactly now
     * applies now. A row with a future effective_from is invisible here until
     * that moment arrives, which is what makes a scheduled change safe to write
     * ahead of time.
     */
    @SqlQuery("""
            SELECT rate
            FROM merchant_fee_rates
            WHERE merchant_id = :merchantId
              AND effective_from <= :at
            ORDER BY effective_from DESC
            LIMIT 1
            """)
    Optional<BigDecimal> effectiveRateFor(
            @Bind("merchantId") UUID merchantId,
            @Bind("at") Instant at
    );

    /** Full history, newest first. Includes rows not yet in force. */
    @SqlQuery("""
            SELECT *
            FROM merchant_fee_rates
            WHERE merchant_id = :merchantId
            ORDER BY effective_from DESC, created_at DESC
            """)
    List<MerchantFeeRate> historyFor(@Bind("merchantId") UUID merchantId);

    /**
     * {@code adminUserId} is nullable, for a rate written by a migration or a
     * job rather than by a person. It is CAST explicitly because a null UUID
     * bind carries no type information: Postgres sees an untyped parameter,
     * infers varchar, and rejects the insert against a uuid column. The cast is
     * on the null path only in effect, but applying it unconditionally keeps
     * the statement identical either way.
     */
    @SqlUpdate("""
            INSERT INTO merchant_fee_rates
                (merchant_id, rate, effective_from, note, created_by_admin_id)
            VALUES
                (:merchantId, :rate, :effectiveFrom, :note, CAST(:adminUserId AS uuid))
            """)
    void insertRate(
            @Bind("merchantId") UUID merchantId,
            @Bind("rate") BigDecimal rate,
            @Bind("effectiveFrom") Instant effectiveFrom,
            @Bind("note") String note,
            @Bind("adminUserId") UUID adminUserId
    );
}

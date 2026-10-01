package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.BlissRate;
import com.bliss.b2b.payments.BookingType;
import com.bliss.b2b.payments.CancellationTerms;
import com.bliss.b2b.payments.PlanFrequency;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

@RegisterRowMapper(BlissRateDao.Mapper.class)
public interface BlissRateDao {

    ObjectMapper JSON = new ObjectMapper();

    @SqlQuery("SELECT * FROM merchant_bliss_rates WHERE merchant_id = :merchantId ORDER BY frequency DESC")
    List<BlissRate> listForMerchant(@Bind("merchantId") UUID merchantId);

    @SqlQuery("SELECT * FROM merchant_bliss_rates WHERE merchant_id = :merchantId AND mews_rate_id = :rateId")
    Optional<BlissRate> find(@Bind("merchantId") UUID merchantId, @Bind("rateId") String rateId);

    /**
     * Records a rate as synced. Keeps the hotel's override; the sync never
     * changes it.
     */
    @SqlUpdate("""
            INSERT INTO merchant_bliss_rates (merchant_id, mews_rate_id, frequency, rate_name, rate_group_id,
                                              active, cancellation_terms, derived_booking_type, synced_at)
            VALUES (:merchantId, :rateId, :frequency, :name, :groupId, :active, CAST(:terms AS jsonb),
                    :derived, :syncedAt)
            ON CONFLICT (merchant_id, mews_rate_id) DO UPDATE SET
                frequency = EXCLUDED.frequency,
                rate_name = EXCLUDED.rate_name,
                rate_group_id = EXCLUDED.rate_group_id,
                active = EXCLUDED.active,
                cancellation_terms = EXCLUDED.cancellation_terms,
                derived_booking_type = EXCLUDED.derived_booking_type,
                synced_at = EXCLUDED.synced_at
            """)
    int upsertSynced(@Bind("merchantId") UUID merchantId, @Bind("rateId") String rateId,
            @Bind("frequency") String frequency, @Bind("name") String name, @Bind("groupId") String groupId,
            @Bind("active") boolean active, @Bind("terms") String termsJson, @Bind("derived") String derived,
            @Bind("syncedAt") Instant syncedAt);

    /** Rates that are no longer Bliss rates on the connection. */
    @SqlUpdate("""
            DELETE FROM merchant_bliss_rates
            WHERE merchant_id = :merchantId AND NOT (mews_rate_id = ANY(:keep))
            """)
    int deleteOthers(@Bind("merchantId") UUID merchantId, @Bind("keep") String[] keepRateIds);

    /** The hotel's booking type for a rate; null goes back to following Mews. Returns rows updated. */
    @SqlUpdate("""
            UPDATE merchant_bliss_rates SET booking_type_override = :override
            WHERE merchant_id = :merchantId AND mews_rate_id = :rateId
            """)
    int setOverride(@Bind("merchantId") UUID merchantId, @Bind("rateId") String rateId,
            @Bind("override") String override);

    static String termsJson(CancellationTerms terms) {
        try {
            return JSON.writeValueAsString(terms.steps());
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    static CancellationTerms parseTerms(String json) {
        if (json == null || json.isBlank()) {
            return CancellationTerms.freeUntilArrival();
        }
        try {
            return new CancellationTerms(JSON.readValue(json, new TypeReference<List<CancellationTerms.Step>>() { }));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("unreadable cancellation terms: " + json, e);
        }
    }

    final class Mapper implements RowMapper<BlissRate> {
        @Override
        public BlissRate map(ResultSet rs, StatementContext ctx) throws SQLException {
            String override = rs.getString("booking_type_override");
            java.sql.Timestamp synced = rs.getTimestamp("synced_at");
            return new BlissRate(
                    (UUID) rs.getObject("merchant_id"),
                    rs.getString("mews_rate_id"),
                    PlanFrequency.fromWire(rs.getString("frequency")),
                    rs.getString("rate_name"),
                    rs.getString("rate_group_id"),
                    rs.getBoolean("active"),
                    parseTerms(rs.getString("cancellation_terms")),
                    BookingType.fromWire(rs.getString("derived_booking_type")),
                    override == null ? null : BookingType.fromWire(override),
                    synced == null ? null : synced.toInstant());
        }
    }
}

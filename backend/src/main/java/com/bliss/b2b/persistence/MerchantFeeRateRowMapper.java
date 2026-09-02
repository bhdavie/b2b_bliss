package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.MerchantFeeRate;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.UUID;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class MerchantFeeRateRowMapper implements RowMapper<MerchantFeeRate> {
    @Override
    public MerchantFeeRate map(ResultSet rs, StatementContext ctx) throws SQLException {
        Timestamp effectiveFrom = rs.getTimestamp("effective_from");
        Timestamp createdAt = rs.getTimestamp("created_at");
        return new MerchantFeeRate(
                (UUID) rs.getObject("id"),
                (UUID) rs.getObject("merchant_id"),
                rs.getBigDecimal("rate"),
                effectiveFrom == null ? null : effectiveFrom.toInstant(),
                rs.getString("note"),
                (UUID) rs.getObject("created_by_admin_id"),
                createdAt == null ? null : createdAt.toInstant()
        );
    }
}

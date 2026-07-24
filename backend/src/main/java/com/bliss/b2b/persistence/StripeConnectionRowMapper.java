package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.StripeConnection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.UUID;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class StripeConnectionRowMapper implements RowMapper<StripeConnection> {
    @Override
    public StripeConnection map(ResultSet rs, StatementContext ctx) throws SQLException {
        return new StripeConnection(
                (UUID) rs.getObject("merchant_id"),
                rs.getString("stripe_account_id"),
                rs.getString("connect_status"),
                rs.getBoolean("charges_enabled"),
                toInstant(rs.getTimestamp("connected_at")),
                toInstant(rs.getTimestamp("created_at")),
                toInstant(rs.getTimestamp("updated_at"))
        );
    }

    private static java.time.Instant toInstant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }
}

package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.MewsConnection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.UUID;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class MewsConnectionRowMapper implements RowMapper<MewsConnection> {
    @Override
    public MewsConnection map(ResultSet rs, StatementContext ctx) throws SQLException {
        return new MewsConnection(
                (UUID) rs.getObject("merchant_id"),
                rs.getString("platform_url"),
                rs.getString("client_token"),
                rs.getString("access_token"),
                rs.getString("enterprise_id"),
                rs.getString("enterprise_name"),
                rs.getString("currency"),
                toInstant(rs.getTimestamp("validated_at")),
                toInstant(rs.getTimestamp("created_at")),
                toInstant(rs.getTimestamp("updated_at")),
                rs.getString("service_id"),
                rs.getString("bliss_rate_id"),
                rs.getString("adult_age_category_id"),
                rs.getString("time_zone")
        );
    }

    private static java.time.Instant toInstant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }
}

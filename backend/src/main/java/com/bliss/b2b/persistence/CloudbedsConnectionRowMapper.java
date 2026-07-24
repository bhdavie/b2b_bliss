package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.CloudbedsConnection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.UUID;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class CloudbedsConnectionRowMapper implements RowMapper<CloudbedsConnection> {
    @Override
    public CloudbedsConnection map(ResultSet rs, StatementContext ctx) throws SQLException {
        return new CloudbedsConnection(
                (UUID) rs.getObject("merchant_id"),
                rs.getString("property_id"),
                rs.getString("property_name"),
                rs.getString("currency"),
                rs.getString("access_token"),
                rs.getString("refresh_token"),
                toInstant(rs.getTimestamp("access_token_expires_at")),
                rs.getString("status"),
                toInstant(rs.getTimestamp("connected_at")),
                toInstant(rs.getTimestamp("created_at")),
                toInstant(rs.getTimestamp("updated_at"))
        );
    }

    private static java.time.Instant toInstant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }
}

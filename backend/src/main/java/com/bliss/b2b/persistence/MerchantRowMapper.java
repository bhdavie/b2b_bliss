package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MerchantStatus;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class MerchantRowMapper implements RowMapper<Merchant> {
    @Override
    public Merchant map(ResultSet rs, StatementContext ctx) throws SQLException {
        return new Merchant(
                (java.util.UUID) rs.getObject("id"),
                rs.getString("slug"),
                rs.getString("email"),
                rs.getString("business_name"),
                rs.getString("business_type"),
                rs.getString("phone"),
                rs.getString("address_line1"),
                rs.getString("address_line2"),
                rs.getString("address_city"),
                rs.getString("address_state"),
                rs.getString("address_zip"),
                rs.getString("address_country"),
                rs.getString("stripe_connect_account_id"),
                rs.getString("stripe_connect_status"),
                MerchantStatus.fromWire(rs.getString("status")),
                toInstant(rs.getTimestamp("email_verified_at")),
                toInstant(rs.getTimestamp("created_at")),
                toInstant(rs.getTimestamp("updated_at"))
        );
    }

    private static java.time.Instant toInstant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }
}

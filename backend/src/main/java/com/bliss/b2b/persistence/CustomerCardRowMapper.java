package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.CustomerCard;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class CustomerCardRowMapper implements RowMapper<CustomerCard> {
    @Override
    public CustomerCard map(ResultSet rs, StatementContext ctx) throws SQLException {
        return new CustomerCard(
                (UUID) rs.getObject("id"),
                (UUID) rs.getObject("customer_id"),
                rs.getString("stripe_payment_method_id"),
                rs.getString("last_four"),
                rs.getInt("exp_month"),
                rs.getInt("exp_year"),
                rs.getString("brand"),
                rs.getBoolean("is_default"),
                toInstant(rs.getTimestamp("created_at")),
                toInstant(rs.getTimestamp("deleted_at"))
        );
    }

    private static Instant toInstant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }
}

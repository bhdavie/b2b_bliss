package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.Customer;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class CustomerRowMapper implements RowMapper<Customer> {
    @Override
    public Customer map(ResultSet rs, StatementContext ctx) throws SQLException {
        return new Customer(
                (UUID) rs.getObject("id"),
                rs.getString("email"),
                rs.getString("phone"),
                rs.getString("first_name"),
                rs.getString("last_name"),
                rs.getString("stripe_customer_id"),
                toInstant(rs.getTimestamp("last_login_at")),
                toInstant(rs.getTimestamp("created_at")),
                toInstant(rs.getTimestamp("updated_at"))
        );
    }

    private static Instant toInstant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }
}

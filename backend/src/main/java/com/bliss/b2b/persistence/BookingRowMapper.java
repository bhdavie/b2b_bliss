package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.BookingSource;
import com.bliss.b2b.domain.BookingStatus;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class BookingRowMapper implements RowMapper<Booking> {
    @Override
    public Booking map(ResultSet rs, StatementContext ctx) throws SQLException {
        return new Booking(
                (UUID) rs.getObject("id"),
                (UUID) rs.getObject("merchant_id"),
                rs.getString("booking_token"),
                rs.getString("service_name"),
                rs.getString("service_description"),
                rs.getLong("total_amount_cents"),
                (Long) rs.getObject("original_total_cents"),
                toLocalDate(rs.getDate("appointment_date")),
                toLocalDate(rs.getDate("checkout_date")),
                rs.getString("cancellation_policy"),
                BookingStatus.fromWire(rs.getString("status")),
                BookingSource.fromWire(rs.getString("booking_source")),
                (UUID) rs.getObject("customer_id"),
                rs.getString("customer_name_hint"),
                rs.getString("customer_email_hint"),
                rs.getString("customer_phone_hint"),
                toInstant(rs.getTimestamp("created_at")),
                toInstant(rs.getTimestamp("updated_at"))
        );
    }

    private static LocalDate toLocalDate(Date d) {
        return d == null ? null : d.toLocalDate();
    }

    private static Instant toInstant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }
}

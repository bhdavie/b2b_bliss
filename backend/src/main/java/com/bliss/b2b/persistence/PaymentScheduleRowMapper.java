package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.domain.ScheduleKind;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class PaymentScheduleRowMapper implements RowMapper<PaymentScheduleEntry> {
    @Override
    public PaymentScheduleEntry map(ResultSet rs, StatementContext ctx) throws SQLException {
        return new PaymentScheduleEntry(
                (UUID) rs.getObject("id"),
                (UUID) rs.getObject("payment_plan_id"),
                rs.getInt("sequence"),
                toLocalDate(rs.getDate("due_date")),
                rs.getLong("amount_cents"),
                PaymentScheduleStatus.fromWire(rs.getString("status")),
                ScheduleKind.fromWire(rs.getString("kind")),
                rs.getString("stripe_payment_intent_id"),
                toInstant(rs.getTimestamp("attempted_at")),
                toInstant(rs.getTimestamp("paid_at")),
                rs.getInt("retry_count"),
                rs.getString("last_error"),
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

package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentPlanStatus;
import com.bliss.b2b.payments.PlanFrequency;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class PaymentPlanRowMapper implements RowMapper<PaymentPlan> {
    @Override
    public PaymentPlan map(ResultSet rs, StatementContext ctx) throws SQLException {
        return new PaymentPlan(
                (UUID) rs.getObject("id"),
                (UUID) rs.getObject("booking_id"),
                (UUID) rs.getObject("customer_id"),
                (UUID) rs.getObject("customer_card_id"),
                rs.getLong("total_amount_cents"),
                rs.getInt("num_payments"),
                PlanFrequency.fromWire(rs.getString("frequency")),
                toLocalDate(rs.getDate("start_date")),
                toLocalDate(rs.getDate("end_date")),
                PaymentPlanStatus.fromWire(rs.getString("status")),
                rs.getLong("deposit_amount_cents"),
                toInstant(rs.getTimestamp("canceled_at")),
                rs.getString("canceled_reason"),
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

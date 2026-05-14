package com.bliss.b2b.persistence;

import com.bliss.b2b.payments.AllowedFrequencies;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.PlanFrequency;
import java.sql.ResultSet;
import java.sql.SQLException;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class MerchantPlanRulesRowMapper implements RowMapper<MerchantPlanRules> {
    @Override
    public MerchantPlanRules map(ResultSet rs, StatementContext ctx) throws SQLException {
        String recommendedWire = rs.getString("recommended_frequency");
        PlanFrequency recommended = recommendedWire == null ? null : PlanFrequency.fromWire(recommendedWire);

        Integer maxLead = (Integer) rs.getObject("max_lead_time_weeks");
        Long minAmt = (Long) rs.getObject("min_booking_amount_cents");
        Long maxAmt = (Long) rs.getObject("max_booking_amount_cents");

        return new MerchantPlanRules(
                rs.getInt("min_lead_time_weeks"),
                maxLead,
                AllowedFrequencies.fromWire(rs.getString("allowed_frequencies")),
                minAmt,
                maxAmt,
                recommended
        );
    }
}

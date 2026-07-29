package com.bliss.b2b.persistence;

import com.bliss.b2b.payments.AfterRetriesAction;
import com.bliss.b2b.payments.AllowedFrequencies;
import com.bliss.b2b.payments.DepositType;
import com.bliss.b2b.payments.FeeType;
import com.bliss.b2b.payments.LateFeeScope;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.PaymentDuePolicy;
import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.payments.RefundPolicy;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class MerchantPlanRulesRowMapper implements RowMapper<MerchantPlanRules> {

    private static final ObjectMapper JSON = new ObjectMapper();

    /**
     * blackout_dates is a JSONB array of ISO yyyy-MM-dd strings. NULL, an empty
     * array, malformed JSON and unparseable entries all read as an empty list:
     * a bad row must not make a merchant's whole rule set unreadable, and the
     * write path already validates every entry.
     */
    private static List<LocalDate> readBlackoutDates(ResultSet rs) throws SQLException {
        String raw = rs.getString("blackout_dates");
        if (raw == null || raw.isBlank()) return List.of();
        List<String> isos;
        try {
            isos = JSON.readValue(raw, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return List.of();
        }
        List<LocalDate> out = new java.util.ArrayList<>(isos.size());
        for (String iso : isos) {
            if (iso == null) continue;
            try {
                out.add(LocalDate.parse(iso));
            } catch (DateTimeParseException e) {
                // skip the bad entry, keep the rest
            }
        }
        return List.copyOf(out);
    }

    @Override
    public MerchantPlanRules map(ResultSet rs, StatementContext ctx) throws SQLException {
        String recommendedWire = rs.getString("recommended_frequency");
        PlanFrequency recommended = recommendedWire == null ? null : PlanFrequency.fromWire(recommendedWire);

        Integer maxLead = (Integer) rs.getObject("max_lead_time_weeks");
        Long minAmt = (Long) rs.getObject("min_booking_amount_cents");
        Long maxAmt = (Long) rs.getObject("max_booking_amount_cents");

        boolean depositRequired = rs.getBoolean("deposit_required");
        String depositTypeWire = rs.getString("deposit_type");
        DepositType depositType = depositTypeWire == null ? null : DepositType.fromWire(depositTypeWire);
        Long depositValue = (Long) rs.getObject("deposit_value");
        Long depositMaxCents = (Long) rs.getObject("deposit_max_cents");

        RefundPolicy refundPolicy = RefundPolicy.fromWire(rs.getString("refund_policy"));
        Integer refundThreshold = (Integer) rs.getObject("refund_sliding_threshold_percent");

        boolean cancellationFeeEnabled = rs.getBoolean("cancellation_fee_enabled");
        String cancellationFeeTypeWire = rs.getString("cancellation_fee_type");
        FeeType cancellationFeeType = cancellationFeeTypeWire == null ? null : FeeType.fromWire(cancellationFeeTypeWire);
        Long cancellationFeeValue = (Long) rs.getObject("cancellation_fee_value");
        Integer cancellationFeeThreshold = (Integer) rs.getObject("cancellation_fee_threshold_percent");

        PaymentDuePolicy paymentDuePolicy = PaymentDuePolicy.fromWire(rs.getString("payment_due_policy"));
        Integer paymentDueCustomMonths = (Integer) rs.getObject("payment_due_custom_months");

        int retryAttempts = rs.getInt("retry_attempts");
        int retrySpacingDays = rs.getInt("retry_spacing_days");

        boolean lateFeeEnabled = rs.getBoolean("late_fee_enabled");
        String lateFeeTypeWire = rs.getString("late_fee_type");
        FeeType lateFeeType = lateFeeTypeWire == null ? null : FeeType.fromWire(lateFeeTypeWire);
        Long lateFeeValue = (Long) rs.getObject("late_fee_value");
        String lateFeeScopeWire = rs.getString("late_fee_scope");
        LateFeeScope lateFeeScope = lateFeeScopeWire == null ? null : LateFeeScope.fromWire(lateFeeScopeWire);

        AfterRetriesAction afterRetries = AfterRetriesAction.fromWire(rs.getString("after_retries_action"));

        int discountBasisPoints = rs.getInt("discount_basis_points");

        return new MerchantPlanRules(
                rs.getInt("min_lead_time_weeks"),
                maxLead,
                AllowedFrequencies.fromWire(rs.getString("allowed_frequencies")),
                minAmt,
                maxAmt,
                recommended,
                depositRequired,
                depositType,
                depositValue,
                depositMaxCents,
                refundPolicy,
                refundThreshold,
                cancellationFeeEnabled,
                cancellationFeeType,
                cancellationFeeValue,
                cancellationFeeThreshold,
                paymentDuePolicy,
                paymentDueCustomMonths,
                retryAttempts,
                retrySpacingDays,
                lateFeeEnabled,
                lateFeeType,
                lateFeeValue,
                lateFeeScope,
                afterRetries,
                discountBasisPoints,
                readBlackoutDates(rs)
        );
    }
}

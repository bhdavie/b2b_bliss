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
                afterRetries
        );
    }
}

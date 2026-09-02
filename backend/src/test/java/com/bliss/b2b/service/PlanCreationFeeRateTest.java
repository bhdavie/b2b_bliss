package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.payments.PlanOption;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * CI-safe: no database, no network. Covers the two halves of the fee change
 * that can be reasoned about without Postgres — what a resolved rate turns into
 * in cents, and what the schedule builder does with it.
 *
 * <p>The resolution ORDERING (newest effective_from not in the future wins) is
 * SQL in {@code MerchantFeeRateDao} and is exercised by
 * {@link MerchantFeeRateResolutionTest}, which needs a real database and skips
 * itself when there is not one.
 */
class PlanCreationFeeRateTest {

    private static final UUID PLAN = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 2);

    /** Records what buildSchedule would have written. */
    private static final class RecordingScheduleDao implements PaymentScheduleDao {
        record Row(int sequence, LocalDate dueDate, long amountCents, String kind) {}

        final List<Row> rows = new ArrayList<>();

        @Override
        public void insert(UUID paymentPlanId, int sequence, LocalDate dueDate,
                           long amountCents, String status, String kind) {
            rows.add(new Row(sequence, dueDate, amountCents, kind));
        }

        long sum() {
            return rows.stream().mapToLong(Row::amountCents).sum();
        }

        // buildSchedule only ever calls insert. The rest of the interface is
        // present so this compiles, and throws so a future call cannot pass
        // silently through a fake that does nothing.
        private static UnsupportedOperationException unused() {
            return new UnsupportedOperationException("not used by buildSchedule");
        }

        @Override public List<PaymentScheduleEntry> listForPlan(UUID paymentPlanId) {
            throw unused();
        }
        @Override public List<PaymentScheduleEntry> listUnsettledForPlan(UUID paymentPlanId) {
            throw unused();
        }
        @Override public Optional<PaymentScheduleEntry> findNextScheduled(UUID paymentPlanId) {
            throw unused();
        }
        @Override public int recordAttempt(UUID paymentPlanId, int sequence, String status,
                String paymentIntentId, Instant attemptedAt) {
            throw unused();
        }
        @Override public int updateStatusWithError(UUID id, String status, String lastError,
                int retryDelta, Instant attemptedAt) {
            throw unused();
        }
        @Override public int markPaidNow(UUID id, String paymentIntentId, Instant now) {
            throw unused();
        }
        @Override public int markPaidMews(UUID id, String mewsPaymentId, Instant now) {
            throw unused();
        }
        @Override public int recordMewsProcessing(UUID id, String mewsPaymentId, String note,
                Instant attemptedAt) {
            throw unused();
        }
        @Override public int cancelRemaining(UUID paymentPlanId) {
            throw unused();
        }
    }

    private static PlanOption option(long total, int n) {
        long per = Math.round((double) total / n);
        long last = total - per * (n - 1);
        List<LocalDate> dates = new ArrayList<>();
        for (int i = 0; i < n; i++) dates.add(TODAY.plusMonths(i + 1L));
        return new PlanOption(PlanFrequency.MONTHLY, n, per, last, dates);
    }

    // ---------------------------------------------------------------- feeFor

    @Test
    void fivePercentRateProducesFivePercentFee() {
        assertThat(PlanCreationService.feeFor(99_415L, new BigDecimal("0.05000")))
                .isEqualTo(4_971L);
    }

    @Test
    void feeMatchesTheConstantItReplaced() {
        // The old implementation was Math.round(total * 0.05). Same answer, so
        // a plan created the day after this change is priced identically to one
        // created the day before.
        for (long total : new long[] {1L, 99L, 100L, 12_345L, 99_415L, 248_000L, 3_360_000L}) {
            assertThat(PlanCreationService.feeFor(total, new BigDecimal("0.05")))
                    .as("total=%d", total)
                    .isEqualTo(Math.round(total * 0.05));
        }
    }

    @Test
    void zeroRateProducesZeroFeeNotNull() {
        // A real zero, not an absent value: the caller writes it straight into
        // processing_fee_cents, which is NOT NULL.
        assertThat(PlanCreationService.feeFor(99_415L, BigDecimal.ZERO)).isEqualTo(0L);
        assertThat(PlanCreationService.feeFor(99_415L, new BigDecimal("0.00000"))).isEqualTo(0L);
    }

    @Test
    void nullRateIsTreatedAsZeroRatherThanThrowing() {
        assertThat(PlanCreationService.feeFor(99_415L, null)).isEqualTo(0L);
    }

    @Test
    void nonRoundRateStillLandsOnWholeCents() {
        // 3.5% of $994.15 = 3479.525 -> 3480 half-up.
        assertThat(PlanCreationService.feeFor(99_415L, new BigDecimal("0.03500")))
                .isEqualTo(3_480L);
    }

    // --------------------------------------------------- schedule invariant

    @Test
    void noDepositScheduleSumsToTotalPlusFee() {
        long total = 99_415L;
        long fee = PlanCreationService.feeFor(total, new BigDecimal("0.05"));
        RecordingScheduleDao dao = new RecordingScheduleDao();

        PlanCreationService.buildSchedule(
                dao, PLAN, TODAY, false, 0L, fee, total, 6, option(total + fee, 6));

        assertThat(dao.sum()).isEqualTo(total + fee);
        assertThat(dao.rows).hasSize(6);
    }

    @Test
    void noDepositScheduleSumsToTotalWhenFeeIsZero() {
        // The case the refactor could plausibly break: with feeCents 0 the
        // invariant collapses to SUM(schedule) == discountedTotal, and the
        // final installment must still absorb the rounding remainder.
        long total = 99_415L;
        RecordingScheduleDao dao = new RecordingScheduleDao();

        PlanCreationService.buildSchedule(
                dao, PLAN, TODAY, false, 0L, 0L, total, 6, option(total, 6));

        assertThat(dao.sum()).isEqualTo(total);
        assertThat(dao.rows).hasSize(6);
        assertThat(dao.rows).noneMatch(r -> r.kind().equals("deposit"));
    }

    @Test
    void depositCarriesTheFeeAndInstallmentsStayClean() {
        long total = 248_000L;
        long deposit = 50_000L;
        long fee = PlanCreationService.feeFor(total, new BigDecimal("0.05"));
        RecordingScheduleDao dao = new RecordingScheduleDao();

        PlanCreationService.buildSchedule(
                dao, PLAN, TODAY, true, deposit, fee, total, 4, option(total - deposit, 4));

        assertThat(dao.sum()).isEqualTo(total + fee);
        // Row 1 is the deposit, and it is the row the fee rides on.
        assertThat(dao.rows.get(0).kind()).isEqualTo("deposit");
        assertThat(dao.rows.get(0).amountCents()).isEqualTo(deposit + fee);
        // The installments are untouched by the fee.
        assertThat(dao.rows.stream().skip(1).mapToLong(RecordingScheduleDao.Row::amountCents).sum())
                .isEqualTo(total - deposit);
    }

    @Test
    void depositScheduleSumsToTotalWhenFeeIsZero() {
        long total = 248_000L;
        long deposit = 50_000L;
        RecordingScheduleDao dao = new RecordingScheduleDao();

        PlanCreationService.buildSchedule(
                dao, PLAN, TODAY, true, deposit, 0L, total, 4, option(total - deposit, 4));

        assertThat(dao.sum()).isEqualTo(total);
        assertThat(dao.rows.get(0).amountCents()).isEqualTo(deposit);
    }

    @Test
    void oddTotalsStillSumExactlyAtEveryRate() {
        // Rounding remainder lands on the final installment, whatever the rate.
        for (String rate : new String[] {"0.00000", "0.05000", "0.03333", "0.25000"}) {
            for (int n : new int[] {2, 3, 5, 6, 7}) {
                long total = 100_003L;
                long fee = PlanCreationService.feeFor(total, new BigDecimal(rate));
                RecordingScheduleDao dao = new RecordingScheduleDao();
                PlanCreationService.buildSchedule(
                        dao, PLAN, TODAY, false, 0L, fee, total, n, option(total + fee, n));
                assertThat(dao.sum())
                        .as("rate=%s n=%d", rate, n)
                        .isEqualTo(total + fee);
            }
        }
    }
}

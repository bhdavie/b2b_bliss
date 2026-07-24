package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.domain.ScheduleKind;
import com.bliss.b2b.integration.pms.PmsAdapter;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import com.bliss.b2b.integration.pms.PmsCardCollectionRequest;
import com.bliss.b2b.integration.pms.PmsChargeResult;
import com.bliss.b2b.integration.pms.PmsChargeStatus;
import com.bliss.b2b.integration.pms.PmsCustomer;
import com.bliss.b2b.integration.pms.PmsCustomerRef;
import com.bliss.b2b.integration.pms.PmsPropertyConfiguration;
import com.bliss.b2b.integration.pms.PmsStoredCard;
import com.bliss.b2b.persistence.DueChargeDao.DueInstallment;
import com.bliss.b2b.service.InstallmentChargeService.ChargeContext;
import com.bliss.b2b.service.InstallmentChargeService.ChargeContextResolver;
import com.bliss.b2b.service.InstallmentChargeService.Ledger;
import com.bliss.b2b.service.InstallmentChargeService.PassResult;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * CI-safe: no database, no network. Drives {@link InstallmentChargeService}
 * with a fake {@link Ledger} and a fake {@link PmsAdapter} to prove the rail
 * routing, the charge-status mapping, and the async (PENDING) guard.
 */
class InstallmentChargeServiceTest {

    private static final LocalDate ASOF = LocalDate.of(2026, 7, 23);
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-07-23T12:00:00Z"), ZoneOffset.UTC);
    private static final String CUR = "GBP";

    // -- rail routing -------------------------------------------------------

    @Test
    void mewsRail_charged_marksPaidAndCompletes() {
        DueInstallment due = mews("card_abc", ScheduleKind.INSTALLMENT);
        RecordingLedger ledger = new RecordingLedger(due);
        FakePmsAdapter adapter = FakePmsAdapter.returning(
                new PmsChargeResult("pay_1", PmsChargeStatus.CHARGED, "Charged", 12_000, CUR));

        PassResult result = service(ledger, adapter).runDuePass(ASOF);

        assertThat(adapter.chargeCalls).hasSize(1);
        assertThat(adapter.chargeCalls.get(0).cardId()).isEqualTo("card_abc");
        assertThat(adapter.chargeCalls.get(0).amountMinor()).isEqualTo(12_000);
        assertThat(adapter.chargeCalls.get(0).currency()).isEqualTo(CUR);
        assertThat(ledger.paid).containsExactly(due.scheduleId());
        assertThat(ledger.paidPaymentId).isEqualTo("pay_1");
        assertThat(ledger.completedPlans).containsExactly(due.planId());
        assertThat(ledger.processing).isEmpty();
        assertThat(ledger.failed).isEmpty();
        assertThat(result).isEqualTo(new PassResult(1, 1, 0, 0, 0, 0));
    }

    @Test
    void mewsRail_pending_marksProcessing_andDoesNotRecharge() {
        DueInstallment due = mews("card_abc", ScheduleKind.INSTALLMENT);
        RecordingLedger ledger = new RecordingLedger(due);
        FakePmsAdapter adapter = FakePmsAdapter.returning(
                new PmsChargeResult("pay_2", PmsChargeStatus.PENDING, "Pending", 12_000, CUR));

        PassResult result = service(ledger, adapter).runDuePass(ASOF);

        assertThat(ledger.processing).containsExactly(due.scheduleId());
        assertThat(ledger.paid).isEmpty();
        assertThat(ledger.failed).isEmpty();
        assertThat(ledger.completedPlans).isEmpty();
        // charged exactly once; the PROCESSING guard means no re-charge here.
        assertThat(adapter.chargeCalls).hasSize(1);
        assertThat(result).isEqualTo(new PassResult(1, 0, 1, 0, 0, 0));
    }

    @Test
    void mewsRail_declined_marksFailed() {
        DueInstallment due = mews("card_abc", ScheduleKind.INSTALLMENT);
        RecordingLedger ledger = new RecordingLedger(due);
        FakePmsAdapter adapter = FakePmsAdapter.returning(
                new PmsChargeResult("pay_3", PmsChargeStatus.FAILED, "Failed", 12_000, CUR));

        PassResult result = service(ledger, adapter).runDuePass(ASOF);

        assertThat(ledger.failed).containsExactly(due.scheduleId());
        assertThat(ledger.paid).isEmpty();
        assertThat(ledger.processing).isEmpty();
        assertThat(result).isEqualTo(new PassResult(1, 0, 0, 1, 0, 0));
    }

    @Test
    void mewsRail_noPropertyConnection_leftScheduled_notCharged() {
        DueInstallment due = mews("card_abc", ScheduleKind.INSTALLMENT);
        RecordingLedger ledger = new RecordingLedger(due);
        FakePmsAdapter adapter = FakePmsAdapter.returning(
                new PmsChargeResult("nope", PmsChargeStatus.CHARGED, "Charged", 12_000, CUR));
        // Resolver returns empty: this property has no validated Mews connection.
        InstallmentChargeService svc = new InstallmentChargeService(
                ledger, merchantId -> Optional.empty(), CLOCK);

        PassResult result = svc.runDuePass(ASOF);

        assertThat(adapter.chargeCalls).isEmpty();
        assertThat(ledger.anyWrite()).isFalse();
        assertThat(result).isEqualTo(new PassResult(1, 0, 0, 0, 0, 1));
    }

    @Test
    void stripeRail_skipped_adapterAndLedgerUntouched() {
        DueInstallment due = new DueInstallment(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), 2, 12_000,
                ScheduleKind.INSTALLMENT.wire(), "stripe", null, null);
        RecordingLedger ledger = new RecordingLedger(due);
        FakePmsAdapter adapter = FakePmsAdapter.returning(
                new PmsChargeResult("nope", PmsChargeStatus.CHARGED, "Charged", 12_000, CUR));

        PassResult result = service(ledger, adapter).runDuePass(ASOF);

        assertThat(adapter.chargeCalls).isEmpty();
        assertThat(ledger.anyWrite()).isFalse();
        assertThat(result).isEqualTo(new PassResult(1, 0, 0, 0, 1, 0));
    }

    @Test
    void mewsRail_noVaultedCard_leftScheduled_notCharged() {
        DueInstallment due = mews(null, ScheduleKind.INSTALLMENT); // no card id
        RecordingLedger ledger = new RecordingLedger(due);
        FakePmsAdapter adapter = FakePmsAdapter.returning(
                new PmsChargeResult("nope", PmsChargeStatus.CHARGED, "Charged", 12_000, CUR));

        PassResult result = service(ledger, adapter).runDuePass(ASOF);

        assertThat(adapter.chargeCalls).isEmpty();
        assertThat(ledger.anyWrite()).isFalse();
        assertThat(result).isEqualTo(new PassResult(1, 0, 0, 0, 0, 1));
    }

    @Test
    void mewsRail_protocolError_leavesRowUntouched_noRetryBump() {
        DueInstallment due = mews("card_abc", ScheduleKind.INSTALLMENT);
        RecordingLedger ledger = new RecordingLedger(due);
        FakePmsAdapter adapter = FakePmsAdapter.throwing(new PmsAdapterException("Mews HTTP 500"));

        PassResult result = service(ledger, adapter).runDuePass(ASOF);

        // A transport error is not a decline: no status write at all.
        assertThat(ledger.anyWrite()).isFalse();
        assertThat(result).isEqualTo(new PassResult(1, 0, 0, 0, 0, 1));
    }

    // -- pure mapping -------------------------------------------------------

    @Test
    void mapChargeStatus_coversEveryOutcome() {
        assertThat(InstallmentChargeService.mapChargeStatus(PmsChargeStatus.CHARGED))
                .isEqualTo(PaymentScheduleStatus.PAID);
        assertThat(InstallmentChargeService.mapChargeStatus(PmsChargeStatus.PENDING))
                .isEqualTo(PaymentScheduleStatus.PROCESSING);
        assertThat(InstallmentChargeService.mapChargeStatus(PmsChargeStatus.VERIFYING))
                .isEqualTo(PaymentScheduleStatus.PROCESSING);
        assertThat(InstallmentChargeService.mapChargeStatus(PmsChargeStatus.UNKNOWN))
                .isEqualTo(PaymentScheduleStatus.PROCESSING);
        assertThat(InstallmentChargeService.mapChargeStatus(PmsChargeStatus.FAILED))
                .isEqualTo(PaymentScheduleStatus.FAILED);
        assertThat(InstallmentChargeService.mapChargeStatus(PmsChargeStatus.CANCELED))
                .isEqualTo(PaymentScheduleStatus.FAILED);
    }

    // -- helpers ------------------------------------------------------------

    private static InstallmentChargeService service(Ledger ledger, PmsAdapter adapter) {
        // Every property resolves to the same fake adapter + currency.
        ChargeContextResolver resolver = merchantId -> Optional.of(new ChargeContext(adapter, CUR));
        return new InstallmentChargeService(ledger, resolver, CLOCK);
    }

    private static DueInstallment mews(String cardId, ScheduleKind kind) {
        return new DueInstallment(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), 2, 12_000,
                kind.wire(), "mews", "mews_cust_1", cardId);
    }

    /** Records every write so tests can assert exactly which path ran. */
    private static final class RecordingLedger implements Ledger {
        private final List<DueInstallment> due;
        final List<UUID> paid = new ArrayList<>();
        final List<UUID> processing = new ArrayList<>();
        final List<UUID> failed = new ArrayList<>();
        final List<UUID> completedPlans = new ArrayList<>();
        String paidPaymentId;

        RecordingLedger(DueInstallment... rows) {
            this.due = List.of(rows);
        }

        boolean anyWrite() {
            return !paid.isEmpty() || !processing.isEmpty() || !failed.isEmpty()
                    || !completedPlans.isEmpty();
        }

        @Override public List<DueInstallment> findDue(LocalDate asOf) {
            return due;
        }

        @Override public void markPaid(UUID scheduleId, String mewsPaymentId, Instant now) {
            paid.add(scheduleId);
            paidPaymentId = mewsPaymentId;
        }

        @Override public void markProcessing(UUID scheduleId, String mewsPaymentId, String note, Instant now) {
            processing.add(scheduleId);
        }

        @Override public void markFailed(UUID scheduleId, String error, Instant now) {
            failed.add(scheduleId);
        }

        @Override public void completePlanIfDone(UUID planId, ScheduleKind justPaidKind) {
            if (justPaidKind == ScheduleKind.INSTALLMENT) {
                completedPlans.add(planId);
            }
        }
    }

    /** Fake adapter: only chargeStoredCard is used; the rest are never called. */
    private static final class FakePmsAdapter implements PmsAdapter {
        private final PmsChargeResult result;
        private final PmsAdapterException error;
        final List<ChargeCall> chargeCalls = new ArrayList<>();

        private FakePmsAdapter(PmsChargeResult result, PmsAdapterException error) {
            this.result = result;
            this.error = error;
        }

        static FakePmsAdapter returning(PmsChargeResult result) {
            return new FakePmsAdapter(result, null);
        }

        static FakePmsAdapter throwing(PmsAdapterException error) {
            return new FakePmsAdapter(null, error);
        }

        @Override
        public PmsChargeResult chargeStoredCard(String pmsCustomerId, String pmsCardId,
                long amountMinorUnits, String currency, String reservationRef, String notes) {
            chargeCalls.add(new ChargeCall(pmsCustomerId, pmsCardId, amountMinorUnits, currency));
            if (error != null) {
                throw error;
            }
            return result;
        }

        @Override public PmsPropertyConfiguration getPropertyConfiguration() {
            throw new UnsupportedOperationException();
        }

        @Override public PmsCustomer findOrCreateCustomer(PmsCustomerRef ref) {
            throw new UnsupportedOperationException();
        }

        @Override public List<PmsStoredCard> getStoredCards(String pmsCustomerId) {
            throw new UnsupportedOperationException();
        }

        @Override public PmsCardCollectionRequest createCardCollectionRequest(
                String pmsCustomerId, Instant expiration, String description) {
            throw new UnsupportedOperationException();
        }
    }

    private record ChargeCall(String customerId, String cardId, long amountMinor, String currency) {}
}

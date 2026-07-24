package com.bliss.b2b.service;

import com.bliss.b2b.domain.PaymentScheduleStatus;
import com.bliss.b2b.domain.ScheduleKind;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.MewsAdapterFactory;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import com.bliss.b2b.integration.pms.PmsChargeStatus;
import com.bliss.b2b.persistence.DueChargeDao;
import com.bliss.b2b.persistence.DueChargeDao.ProcessingInstallment;
import com.bliss.b2b.service.InstallmentChargeService.Ledger;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The Mews reconciliation pass: settles installments left in {@code processing}.
 *
 * <p>A Mews charge settles asynchronously. When {@link MewsAdapter#chargeStoredCard}
 * comes back Pending/Verifying, the charge pass records the installment as
 * {@code processing} with its {@code mews_payment_id} and moves on; nothing else
 * ever flips it. This pass finds those rows, groups them by property, re-queries
 * each property's own Mews account via {@code payments/getAll}, and settles the
 * ones whose state resolved.
 *
 * <p><b>Reuses the charge pass's machinery, does not invent a parallel one.</b>
 * It shares the same {@link InstallmentChargeService.Ledger} for persistence and
 * the same {@link InstallmentChargeService#mapChargeStatus} for state mapping, so
 * a reconciled payment lands in exactly the states a synchronously-charged one
 * would:
 * <ul>
 *   <li>settled/charged -&gt; {@link Ledger#markPaid} then
 *       {@link Ledger#completePlanIfDone} — the completion check that "waits for
 *       settlement" now actually fires, so flipping the final installment to paid
 *       completes the plan.
 *   <li>failed/canceled -&gt; {@link Ledger#markFailed} — the same failure path a
 *       declined charge takes (marks failed, bumps retry_count), not a silent flip.
 *   <li>still pending/unknown -&gt; left {@code processing}, retried next cycle.
 * </ul>
 *
 * <p>Idempotent and safe to run repeatedly: it only ever reads {@code processing}
 * rows, so a row already {@code paid} or {@code failed} is never selected again.
 */
public class MewsReconciliationService {

    private static final Logger log = LoggerFactory.getLogger(MewsReconciliationService.class);

    /** Mews payment ids per {@code payments/getAll} call; matches the adapter's page limit. */
    private static final int BATCH = 100;

    private final Jdbi jdbi;
    private final MewsAdapterFactory adapterFactory;
    private final Ledger ledger;
    private final Clock clock;

    public MewsReconciliationService(
            Jdbi jdbi, MewsAdapterFactory adapterFactory, Ledger ledger, Clock clock) {
        this.jdbi = jdbi;
        this.adapterFactory = adapterFactory;
        this.ledger = ledger;
        this.clock = clock;
    }

    /**
     * Runs one reconciliation cycle: settles every {@code processing} Mews
     * installment whose payment has resolved. Returns a tally of what happened.
     */
    public PassResult runReconcilePass() {
        List<ProcessingInstallment> rows =
                jdbi.withHandle(h -> h.attach(DueChargeDao.class).findProcessingMews());
        if (rows.isEmpty()) {
            log.info("Mews reconciliation: no processing installments to settle");
            return new PassResult(0, 0, 0, 0, 0, 0);
        }

        // Group by property so each property's credentials resolve once per pass.
        Map<UUID, List<ProcessingInstallment>> byMerchant = rows.stream()
                .collect(Collectors.groupingBy(
                        ProcessingInstallment::merchantId, LinkedHashMap::new, Collectors.toList()));

        int paid = 0, failed = 0, pending = 0, noConnection = 0, errors = 0;

        for (Map.Entry<UUID, List<ProcessingInstallment>> entry : byMerchant.entrySet()) {
            UUID merchantId = entry.getKey();
            List<ProcessingInstallment> group = entry.getValue();

            // Resolve the property's OWN Mews adapter. No validated connection is
            // a config gap, not a settlement outcome: leave the rows processing.
            Optional<MewsAdapter> adapterMaybe = adapterFactory.resolveMewsAdapter(merchantId);
            if (adapterMaybe.isEmpty()) {
                log.warn("Mews reconciliation: merchant {} has no validated connection; "
                        + "leaving {} row(s) processing", merchantId, group.size());
                noConnection += group.size();
                continue;
            }
            MewsAdapter adapter = adapterMaybe.get();

            Map<String, PmsChargeStatus> states;
            try {
                states = queryStates(adapter, group);
            } catch (PmsAdapterException e) {
                // Transport/protocol error: nothing settled, leave rows for the
                // next cycle. Do not mark failed — this was not a decline.
                log.warn("Mews reconciliation: payments/getAll failed for merchant {}: {}",
                        merchantId, e.getMessage());
                errors += group.size();
                continue;
            }

            Instant now = Instant.now(clock);
            for (ProcessingInstallment row : group) {
                PmsChargeStatus state = states.get(row.mewsPaymentId());
                if (state == null) {
                    // Mews did not return this payment; still unknown -> leave in flight.
                    pending++;
                    continue;
                }
                // Same mapping the charge pass applies to a fresh charge result.
                PaymentScheduleStatus mapped = InstallmentChargeService.mapChargeStatus(state);
                switch (mapped) {
                    case PAID -> {
                        ledger.markPaid(row.scheduleId(), row.mewsPaymentId(), now);
                        // Completion waits for settlement: flipping the final
                        // installment to paid here is what lets the plan complete.
                        ledger.completePlanIfDone(row.planId(), ScheduleKind.fromWire(row.kind()));
                        paid++;
                        log.info("Mews reconciliation: installment {} settled paid (payment {})",
                                row.scheduleId(), row.mewsPaymentId());
                    }
                    case FAILED -> {
                        // Same failure path a declined charge takes in the charge
                        // pass: mark failed and bump retry_count, not a silent flip.
                        ledger.markFailed(row.scheduleId(),
                                "mews payment settled failed (state=" + state + ")", now);
                        failed++;
                        log.info("Mews reconciliation: installment {} settled failed "
                                + "(payment {}, state {})", row.scheduleId(), row.mewsPaymentId(), state);
                    }
                    default -> {
                        // PROCESSING / UNKNOWN: still in flight, leave untouched.
                        pending++;
                    }
                }
            }
        }

        PassResult result = new PassResult(rows.size(), paid, failed, pending, noConnection, errors);
        log.info("Mews reconciliation pass -> {}", result);
        return result;
    }

    /** Queries payment states for a property's group, chunked to the Mews page limit. */
    private Map<String, PmsChargeStatus> queryStates(
            MewsAdapter adapter, List<ProcessingInstallment> group) {
        List<String> ids = group.stream()
                .map(ProcessingInstallment::mewsPaymentId)
                .distinct()
                .collect(Collectors.toList());
        Map<String, PmsChargeStatus> out = new LinkedHashMap<>();
        for (int i = 0; i < ids.size(); i += BATCH) {
            out.putAll(adapter.getPayments(ids.subList(i, Math.min(i + BATCH, ids.size()))));
        }
        return out;
    }

    /** Tally of a single reconciliation pass. */
    public record PassResult(
            int processing, int paid, int failed, int stillPending, int noConnection, int errors) {
    }
}

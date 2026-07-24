package com.bliss.b2b.service;

import com.bliss.b2b.persistence.DemoResetDao;
import java.util.List;
import java.util.UUID;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Deletes every {@code is_demo=true} merchant and all of its owned data in one
 * atomic transaction, in FK-safe order, returning a per-table summary. Consumers
 * (customers + cards) are purged only when they are left with zero remaining
 * plans, so a shopper who also transacted with a non-demo property is spared.
 *
 * <p>Non-demo merchants are unreachable: every statement filters on
 * {@code is_demo=true}.
 */
public class DemoResetService {

    private static final Logger log = LoggerFactory.getLogger(DemoResetService.class);

    private final Jdbi jdbi;

    public DemoResetService(Jdbi jdbi) {
        this.jdbi = jdbi;
    }

    public Summary reset() {
        Summary summary = jdbi.inTransaction(handle -> {
            DemoResetDao dao = handle.attach(DemoResetDao.class);

            List<String> emails = dao.selectDemoMerchantEmails();
            // Capture before deleting: after plans go, the merchant link is lost.
            List<UUID> demoCustomerIds = dao.selectCustomerIdsForDemoPlans();

            int scheduleEntries = dao.deleteDemoScheduleEntries();
            int plans = dao.deleteDemoPlans();
            int bookings = dao.deleteDemoBookings();
            int planRules = dao.deleteDemoPlanRules();
            int mewsConnections = dao.deleteDemoMewsConnections();
            int magicLinkTokens = dao.deleteDemoMagicLinkTokens();

            // Orphaned consumers: skip the IN () entirely when there are none.
            int customerCards = demoCustomerIds.isEmpty()
                    ? 0 : dao.deleteCardsForOrphanCustomers(demoCustomerIds);
            int customers = demoCustomerIds.isEmpty()
                    ? 0 : dao.deleteOrphanCustomers(demoCustomerIds);

            int merchants = dao.deleteDemoMerchants();

            return new Summary(
                    new Deleted(merchants, bookings, plans, scheduleEntries, planRules,
                            mewsConnections, magicLinkTokens, customers, customerCards),
                    emails);
        });
        log.warn("Demo reset removed {} merchant(s): {}",
                summary.deleted().merchants(), summary.merchantEmails());
        return summary;
    }

    public record Summary(Deleted deleted, List<String> merchantEmails) {
    }

    public record Deleted(
            int merchants,
            int bookings,
            int paymentPlans,
            int scheduleEntries,
            int planRules,
            int mewsConnections,
            int magicLinkTokens,
            int customers,
            int customerCards) {
    }
}

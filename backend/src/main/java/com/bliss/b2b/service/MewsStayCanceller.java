package com.bliss.b2b.service;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.integration.pms.MewsAdapter;
import com.bliss.b2b.integration.pms.MewsAdapterFactory;
import com.bliss.b2b.integration.pms.PmsAdapterException;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Cancels the Mews reservation behind a Bliss booking. Called before anything
 * changes in Bliss, so a cancellation Mews refuses (or cannot be reached for)
 * leaves the plan exactly as it was and the guest can simply try again.
 *
 * <p>Mews sends the guest its own cancellation email ({@code SendEmail}), as it
 * sent the confirmation. No Mews cancellation fee is posted: under a Bliss
 * plan, what the guest keeps is decided by the property's plan rules and
 * becomes a future-stay credit.
 */
public class MewsStayCanceller {

    private static final Logger log = LoggerFactory.getLogger(MewsStayCanceller.class);

    private final MewsAdapterFactory adapterFactory;

    public MewsStayCanceller(MewsAdapterFactory adapterFactory) {
        this.adapterFactory = adapterFactory;
    }

    /**
     * Cancels {@code booking}'s Mews reservation, or does nothing if Mews
     * already has it cancelled (the hotel may have got there first).
     *
     * @throws StayCancellationException when the property has no Mews
     *         connection, or Mews cannot be read or refuses the cancel
     */
    public void cancel(Booking booking, String reason) {
        String reservationId = booking.mewsReservationId();
        MewsAdapter adapter = adapterFactory.resolveMewsAdapter(booking.merchantId())
                .orElseThrow(() -> new StayCancellationException(
                        "This property's Mews connection is missing, so the stay can't be cancelled here. "
                                + "Contact the property."));
        try {
            Optional<String> state = adapter.getReservationState(reservationId);
            if (state.isPresent() && "Canceled".equals(state.get())) {
                log.info("Mews reservation {} already canceled; nothing to cancel", reservationId);
                return;
            }
            adapter.cancelReservation(reservationId, true, "Canceled through Bliss (" + reason + ")");
        } catch (PmsAdapterException e) {
            log.warn("Could not cancel Mews reservation {} for booking {}: {}",
                    reservationId, booking.id(), e.getMessage());
            throw new StayCancellationException(
                    "We couldn't reach the property's booking system to cancel your stay. "
                            + "Nothing has changed. Try again in a moment.");
        }
    }

    /** The Mews side of a cancellation failed; nothing was changed in Bliss. */
    public static class StayCancellationException extends RuntimeException {
        public StayCancellationException(String message) {
            super(message);
        }
    }
}

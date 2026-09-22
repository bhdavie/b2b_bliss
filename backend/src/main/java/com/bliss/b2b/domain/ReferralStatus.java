package com.bliss.b2b.domain;

import java.util.Arrays;
import java.util.List;

/**
 * Where a guest referral is. Forward-only along the ladder, with an exit to
 * {@link #DECLINED} from any status that has not been credited:
 *
 * <pre>
 *   SUBMITTED -> CLICKED -> CONTACTED -> DEMO_BOOKED -> LIVE -> CREDITED
 *        \__________\___________\____________\_________\_______-> DECLINED
 * </pre>
 *
 * <p>CLICKED and DEMO_BOOKED arrived with the guest referral link (V29).
 * CREDITED is what the product brief calls "paid": an admin has applied the
 * credit. There is no separate PAID, because one state does not need two names.
 *
 * <p>CLICKED is a rung, not the record of a visit. A hotel that opens the link
 * again after we have contacted them cannot move the status backwards, so that
 * later click updates {@code referrals.clicked_at} and leaves the status alone.
 * Read clicked_at to answer "did they ever visit".
 *
 * Forward moves may skip steps (a hotel can go live without a recorded
 * "contacted"). Nothing moves backwards and nothing moves to its own status.
 * Both ends are final: CREDITED has no way out at all, because a credit has
 * been applied and declining it after the fact would contradict that record,
 * and DECLINED has no way out other than to itself.
 *
 * <p>This is the only copy of the rule. The admin detail endpoint returns
 * {@link #allowedNext()} so the frontend renders the options rather than
 * mirroring the ladder.
 */
public enum ReferralStatus {
    SUBMITTED("submitted", 0),
    CLICKED("clicked", 1),
    CONTACTED("contacted", 2),
    DEMO_BOOKED("demo_booked", 3),
    LIVE("live", 4),
    CREDITED("credited", 5),
    /** Off the ladder: order is unused and never compared. */
    DECLINED("declined", -1);

    private final String wire;
    private final int order;

    ReferralStatus(String wire, int order) {
        this.wire = wire;
        this.order = order;
    }

    public String wire() {
        return wire;
    }

    /**
     * Whether a referral at this status may be moved to {@code next}.
     *
     * <p>CREDITED is final and refuses everything, DECLINED included. Any
     * other status may move to DECLINED, including DECLINED itself, which is a
     * harmless no-op and keeps "decline" idempotent for a double-clicked
     * button. Otherwise the move must go strictly forward along the ladder, and
     * DECLINED, being off the ladder, has nowhere forward to go.
     */
    public boolean canTransitionTo(ReferralStatus next) {
        if (next == null) return false;
        if (this == CREDITED) return false;
        if (next == DECLINED) return true;
        if (this == DECLINED) return false;
        return next.order > this.order;
    }

    /** Every status {@link #canTransitionTo} accepts from here, in ladder order. */
    public List<ReferralStatus> allowedNext() {
        return Arrays.stream(values()).filter(this::canTransitionTo).toList();
    }

    public static ReferralStatus fromWire(String wire) {
        for (ReferralStatus s : values()) {
            if (s.wire.equals(wire)) return s;
        }
        throw new IllegalArgumentException("Unknown referral status: " + wire);
    }
}

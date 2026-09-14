package com.bliss.b2b.domain;

import java.util.Arrays;
import java.util.List;

/**
 * Where a guest referral is. Forward-only along the ladder, with an exit to
 * {@link #DECLINED} from any status that has not been credited:
 *
 * <pre>
 *   SUBMITTED -> CONTACTED -> LIVE -> CREDITED
 *        \___________\__________\_______-> DECLINED
 * </pre>
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
    CONTACTED("contacted", 1),
    LIVE("live", 2),
    CREDITED("credited", 3),
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

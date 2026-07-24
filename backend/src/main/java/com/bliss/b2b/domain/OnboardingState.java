package com.bliss.b2b.domain;

/**
 * Resumable setup progress for a property. The dashboard shows a setup checklist
 * until {@link #ACTIVE}. Transitions are forward-only:
 *
 * <pre>
 *   CREATED -> PMS_SELECTED -> PMS_CONNECTED -> POLICY_SET -> ACTIVE
 * </pre>
 *
 * A property that picks Cloudbeds parks at {@link #PMS_SELECTED} ("coming soon")
 * and cannot reach {@link #PMS_CONNECTED} yet.
 */
public enum OnboardingState {
    CREATED("created", 0),
    PMS_SELECTED("pms_selected", 1),
    PMS_CONNECTED("pms_connected", 2),
    POLICY_SET("policy_set", 3),
    ACTIVE("active", 4);

    private final String wire;
    private final int order;

    OnboardingState(String wire, int order) {
        this.wire = wire;
        this.order = order;
    }

    public String wire() {
        return wire;
    }

    /** True when this state is at or past {@code other} in the setup sequence. */
    public boolean isAtLeast(OnboardingState other) {
        return this.order >= other.order;
    }

    public static OnboardingState fromWire(String wire) {
        if (wire == null) {
            return CREATED;
        }
        for (OnboardingState s : values()) {
            if (s.wire.equals(wire)) {
                return s;
            }
        }
        throw new IllegalArgumentException("Unknown onboarding state: " + wire);
    }
}

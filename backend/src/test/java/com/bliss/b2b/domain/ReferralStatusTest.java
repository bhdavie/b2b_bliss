package com.bliss.b2b.domain;

import static com.bliss.b2b.domain.ReferralStatus.CLICKED;
import static com.bliss.b2b.domain.ReferralStatus.CONTACTED;
import static com.bliss.b2b.domain.ReferralStatus.CREDITED;
import static com.bliss.b2b.domain.ReferralStatus.DECLINED;
import static com.bliss.b2b.domain.ReferralStatus.DEMO_BOOKED;
import static com.bliss.b2b.domain.ReferralStatus.LIVE;
import static com.bliss.b2b.domain.ReferralStatus.SUBMITTED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** The referral ladder: forward only, declined from anywhere short of credited, both ends final. */
class ReferralStatusTest {

    @Test
    void forwardMovesAreAllowedIncludingSkips() {
        assertThat(SUBMITTED.canTransitionTo(CONTACTED)).isTrue();
        assertThat(CONTACTED.canTransitionTo(LIVE)).isTrue();
        assertThat(LIVE.canTransitionTo(CREDITED)).isTrue();
        assertThat(SUBMITTED.canTransitionTo(LIVE)).isTrue();
        assertThat(SUBMITTED.canTransitionTo(CREDITED)).isTrue();
    }

    @Test
    void backwardAndSameStatusMovesAreRefused() {
        assertThat(CONTACTED.canTransitionTo(SUBMITTED)).isFalse();
        assertThat(LIVE.canTransitionTo(CONTACTED)).isFalse();
        assertThat(CREDITED.canTransitionTo(LIVE)).isFalse();
        assertThat(CREDITED.canTransitionTo(SUBMITTED)).isFalse();
        assertThat(SUBMITTED.canTransitionTo(SUBMITTED)).isFalse();
        assertThat(LIVE.canTransitionTo(LIVE)).isFalse();
    }

    @Test
    void anyStatusShortOfCreditedMayDecline() {
        assertThat(SUBMITTED.canTransitionTo(DECLINED)).isTrue();
        assertThat(CONTACTED.canTransitionTo(DECLINED)).isTrue();
        assertThat(LIVE.canTransitionTo(DECLINED)).isTrue();
        assertThat(DECLINED.canTransitionTo(DECLINED)).isTrue();
    }

    @Test
    void creditedIsFinalIncludingDecline() {
        for (ReferralStatus s : ReferralStatus.values()) {
            assertThat(CREDITED.canTransitionTo(s)).as("credited -> %s", s).isFalse();
        }
        assertThat(CREDITED.allowedNext()).isEmpty();
    }

    @Test
    void declinedIsTerminal() {
        assertThat(DECLINED.canTransitionTo(SUBMITTED)).isFalse();
        assertThat(DECLINED.canTransitionTo(CONTACTED)).isFalse();
        assertThat(DECLINED.canTransitionTo(LIVE)).isFalse();
        assertThat(DECLINED.canTransitionTo(CREDITED)).isFalse();
    }

    @Test
    void allowedNextListsTheLadderInOrder() {
        assertThat(SUBMITTED.allowedNext())
                .containsExactly(CLICKED, CONTACTED, DEMO_BOOKED, LIVE, CREDITED, DECLINED);
        assertThat(CLICKED.allowedNext())
                .containsExactly(CONTACTED, DEMO_BOOKED, LIVE, CREDITED, DECLINED);
        assertThat(DEMO_BOOKED.allowedNext()).containsExactly(LIVE, CREDITED, DECLINED);
        assertThat(LIVE.allowedNext()).containsExactly(CREDITED, DECLINED);
        assertThat(DECLINED.allowedNext()).containsExactly(DECLINED);
    }

    @Test
    void wireRoundTripsAndRejectsUnknowns() {
        for (ReferralStatus s : ReferralStatus.values()) {
            assertThat(ReferralStatus.fromWire(s.wire())).isEqualTo(s);
        }
        assertThatThrownBy(() -> ReferralStatus.fromWire("LIVE"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}

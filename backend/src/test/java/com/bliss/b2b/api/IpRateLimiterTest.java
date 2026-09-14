package com.bliss.b2b.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/**
 * The limiter behind POST /api/v1/public/referrals, on a hand-driven clock so
 * the window can be crossed without sleeping. The end-to-end 429 is covered in
 * BlissApplicationTest.
 */
class IpRateLimiterTest {

    private static final Duration WINDOW = Duration.ofMinutes(10);

    @Test
    void allowsFivePerWindowThenRefuses() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-14T12:00:00Z"));
        IpRateLimiter limiter = new IpRateLimiter(5, WINDOW, clock);

        for (int i = 0; i < 5; i++) {
            assertThat(limiter.tryAcquire("203.0.113.7").allowed()).as("attempt %d", i + 1).isTrue();
        }
        IpRateLimiter.Decision sixth = limiter.tryAcquire("203.0.113.7");
        assertThat(sixth.allowed()).isFalse();
        assertThat(sixth.retryAfterSeconds()).isEqualTo(600L);
    }

    @Test
    void keysAreIndependent() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-14T12:00:00Z"));
        IpRateLimiter limiter = new IpRateLimiter(5, WINDOW, clock);
        for (int i = 0; i < 5; i++) limiter.tryAcquire("203.0.113.7");

        assertThat(limiter.tryAcquire("203.0.113.7").allowed()).isFalse();
        assertThat(limiter.tryAcquire("198.51.100.4").allowed()).isTrue();
    }

    @Test
    void windowSlidesRatherThanResettingOnABoundary() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-14T12:00:00Z"));
        IpRateLimiter limiter = new IpRateLimiter(5, WINDOW, clock);

        limiter.tryAcquire("ip");                       // t = 0
        clock.advance(Duration.ofMinutes(5));
        for (int i = 0; i < 4; i++) limiter.tryAcquire("ip"); // t = 5m, four more
        assertThat(limiter.tryAcquire("ip").allowed()).isFalse();

        // Just past 10m the t = 0 hit ages out, freeing exactly one slot.
        clock.advance(Duration.ofMinutes(5).plusMillis(1));
        assertThat(limiter.tryAcquire("ip").allowed()).isTrue();
        assertThat(limiter.tryAcquire("ip").allowed()).isFalse();
    }

    @Test
    void refusedAttemptsDoNotExtendTheWindow() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-14T12:00:00Z"));
        IpRateLimiter limiter = new IpRateLimiter(5, WINDOW, clock);
        for (int i = 0; i < 5; i++) limiter.tryAcquire("ip");

        // Keep hammering right up to the edge of the window.
        for (int i = 0; i < 9; i++) {
            clock.advance(Duration.ofMinutes(1));
            assertThat(limiter.tryAcquire("ip").allowed()).isFalse();
        }
        clock.advance(Duration.ofMinutes(1).plusMillis(1));
        assertThat(limiter.tryAcquire("ip").allowed()).isTrue();
    }

    @Test
    void idleKeysAreSweptOnceTheirWindowHasPassed() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-14T12:00:00Z"));
        IpRateLimiter limiter = new IpRateLimiter(5, WINDOW, clock);
        limiter.tryAcquire("a");
        limiter.tryAcquire("b");
        assertThat(limiter.trackedKeys()).isEqualTo(2);

        clock.advance(WINDOW.plusSeconds(1));
        limiter.tryAcquire("c");
        assertThat(limiter.trackedKeys()).isEqualTo(1);
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant start) {
            this.now = start;
        }

        void advance(Duration d) {
            now = now.plus(d);
        }

        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}

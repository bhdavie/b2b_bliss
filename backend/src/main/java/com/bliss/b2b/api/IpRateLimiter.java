package com.bliss.b2b.api;

import java.time.Clock;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * In-memory sliding-window limiter: at most {@code maxRequests} per key within
 * {@code window}. Keyed by caller IP by its one user, PublicReferralsResource.
 *
 * <p>Per process, not shared. Two backend instances each allow the full budget,
 * and a restart forgets every window. That is acceptable for keeping a public
 * form from being scripted into the admin queue; it is not a security boundary.
 *
 * <p>Plain {@link ConcurrentHashMap} rather than Caffeine: Caffeine is only on
 * the classpath transitively through dropwizard-auth, and depending on an
 * undeclared transitive for a class this small is a worse trade than the thirty
 * lines. Each key holds its own timestamps; {@link ConcurrentHashMap#compute}
 * makes the prune, count and append atomic per key without a global lock.
 *
 * <p>Eviction is piggybacked on calls rather than run on a thread: at most once
 * per window, a call sweeps out every key whose newest timestamp has aged past
 * the window. A key with nothing in the window carries no information, so
 * dropping it changes no decision.
 */
public class IpRateLimiter {

    private final int maxRequests;
    private final long windowMillis;
    private final Clock clock;
    private final ConcurrentHashMap<String, Deque<Long>> hits = new ConcurrentHashMap<>();
    private final AtomicLong lastSweepMillis;

    public IpRateLimiter(int maxRequests, Duration window, Clock clock) {
        if (maxRequests < 1) throw new IllegalArgumentException("maxRequests must be at least 1");
        this.maxRequests = maxRequests;
        this.windowMillis = window.toMillis();
        this.clock = clock;
        this.lastSweepMillis = new AtomicLong(clock.millis());
    }

    /**
     * Records an attempt for {@code key} and says whether it is within budget.
     * A refused attempt is not recorded, so a caller hammering past the limit
     * does not push its own window further out.
     */
    public Decision tryAcquire(String key) {
        long now = clock.millis();
        sweepIfDue(now);
        long cutoff = now - windowMillis;
        long[] retryAfterMillis = {0L};
        boolean[] allowed = {false};
        hits.compute(key == null ? "unknown" : key, (k, deque) -> {
            Deque<Long> d = deque == null ? new ArrayDeque<>() : deque;
            while (!d.isEmpty() && d.peekFirst() <= cutoff) d.pollFirst();
            if (d.size() < maxRequests) {
                d.addLast(now);
                allowed[0] = true;
            } else {
                // The oldest hit in the window is the next one to age out.
                retryAfterMillis[0] = d.peekFirst() + windowMillis - now;
            }
            return d;
        });
        long retryAfterSeconds = allowed[0] ? 0L : Math.max(1L, (retryAfterMillis[0] + 999L) / 1000L);
        return new Decision(allowed[0], retryAfterSeconds);
    }

    /** Number of keys currently held. For tests. */
    int trackedKeys() {
        return hits.size();
    }

    private void sweepIfDue(long now) {
        long last = lastSweepMillis.get();
        if (now - last < windowMillis) return;
        // Only the caller that wins the CAS sweeps; the rest carry on.
        if (!lastSweepMillis.compareAndSet(last, now)) return;
        long cutoff = now - windowMillis;
        for (String key : hits.keySet()) {
            hits.computeIfPresent(key, (k, d) -> {
                Long newest = d.peekLast();
                return newest == null || newest <= cutoff ? null : d;
            });
        }
    }

    /** {@code retryAfterSeconds} is 0 when allowed, else whole seconds until a slot frees. */
    public record Decision(boolean allowed, long retryAfterSeconds) {}
}

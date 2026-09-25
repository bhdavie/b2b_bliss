package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.integration.pms.MewsCatalog;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import org.junit.jupiter.api.Test;

class MewsStayServiceTest {

    private static final ZoneId NEW_YORK = ZoneId.of("America/New_York");
    private static final MewsCatalog.Service STAY = new MewsCatalog.Service(
            "svc", "Stay", true, Duration.ofHours(15), Duration.ofHours(12));

    @Test
    void checkInAndOutAreTheServiceTimesInThePropertyZone() {
        var t = MewsStayService.stayTimes(NEW_YORK, LocalDate.of(2026, 11, 24), LocalDate.of(2026, 11, 26), STAY);
        // EST is UTC-5: 15:00 local is 20:00Z, 12:00 local is 17:00Z.
        assertThat(t.startUtc()).isEqualTo(Instant.parse("2026-11-24T20:00:00Z"));
        assertThat(t.endUtc()).isEqualTo(Instant.parse("2026-11-26T17:00:00Z"));
        // Availability nights are local midnights: the 24th and the 25th.
        assertThat(t.firstNightUtc()).isEqualTo(Instant.parse("2026-11-24T05:00:00Z"));
        assertThat(t.lastNightUtc()).isEqualTo(Instant.parse("2026-11-25T05:00:00Z"));
    }

    @Test
    void daylightSavingDayKeepsWallClockCheckIn() {
        // Clocks go back at 02:00 on 2026-11-01. Check-in is still 15:00 local, now EST.
        var t = MewsStayService.stayTimes(NEW_YORK, LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 2), STAY);
        assertThat(t.startUtc()).isEqualTo(Instant.parse("2026-11-01T20:00:00Z"));
        // Midnight that night was still EDT (UTC-4).
        assertThat(t.firstNightUtc()).isEqualTo(Instant.parse("2026-11-01T04:00:00Z"));
    }

    private static final List<MewsCatalog.ResourceCategory> ROOMS = List.of(
            new MewsCatalog.ResourceCategory("a", "Queen Room", true, 2, 0),
            new MewsCatalog.ResourceCategory("b", "King Suite", true, 2, 1),
            new MewsCatalog.ResourceCategory("c", "Twin Room", true, 2, 0));

    @Test
    void idWinsOverName() {
        assertThat(MewsStayService.resolveRoom(ROOMS, "b", "Queen Room")).get()
                .extracting(MewsCatalog.ResourceCategory::id).isEqualTo("b");
    }

    @Test
    void matchesTheBookingEngineLabelByName() {
        assertThat(MewsStayService.resolveRoom(ROOMS, null, "  queen   room ")).get()
                .extracting(MewsCatalog.ResourceCategory::id).isEqualTo("a");
        assertThat(MewsStayService.resolveRoom(ROOMS, "stale-id", "The King Suite")).get()
                .extracting(MewsCatalog.ResourceCategory::id).isEqualTo("b");
    }

    @Test
    void ambiguousOrMissingLabelResolvesToNothing() {
        // "Room" is inside both Queen Room and Twin Room.
        assertThat(MewsStayService.resolveRoom(ROOMS, null, "Room")).isEmpty();
        assertThat(MewsStayService.resolveRoom(ROOMS, null, "Penthouse")).isEmpty();
        assertThat(MewsStayService.resolveRoom(ROOMS, null, null)).isEmpty();
    }
}

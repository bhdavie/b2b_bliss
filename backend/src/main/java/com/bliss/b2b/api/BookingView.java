package com.bliss.b2b.api;

import com.bliss.b2b.domain.Booking;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record BookingView(
        String id,
        String bookingToken,
        String hostedUrl,
        String serviceName,
        String serviceDescription,
        long totalAmountCents,
        LocalDate appointmentDate,
        String cancellationPolicy,
        String status,
        String customerNameHint,
        String customerEmailHint,
        Instant createdAt,
        EligibilityView eligibility,
        List<PlanOptionView> planOptions
) {
    public static BookingView summary(Booking b, String hostedUrl) {
        return new BookingView(
                b.id().toString(),
                b.bookingToken(),
                hostedUrl,
                b.serviceName(),
                b.serviceDescription(),
                b.totalAmountCents(),
                b.appointmentDate(),
                b.cancellationPolicy(),
                b.status().wire(),
                b.customerNameHint(),
                b.customerEmailHint(),
                b.createdAt(),
                null,
                null
        );
    }

    public static BookingView detail(
            Booking b,
            String hostedUrl,
            EligibilityView eligibility,
            List<PlanOptionView> planOptions
    ) {
        return new BookingView(
                b.id().toString(),
                b.bookingToken(),
                hostedUrl,
                b.serviceName(),
                b.serviceDescription(),
                b.totalAmountCents(),
                b.appointmentDate(),
                b.cancellationPolicy(),
                b.status().wire(),
                b.customerNameHint(),
                b.customerEmailHint(),
                b.createdAt(),
                eligibility,
                planOptions
        );
    }

    public record EligibilityView(
            boolean eligible,
            String reason,
            long daysToAppointment,
            long depositAmountCents
    ) {}

    public record PlanOptionView(
            String frequency,
            int numPayments,
            long perPaymentAmountCents,
            long finalPaymentAmountCents,
            List<LocalDate> dueDates
    ) {}
}

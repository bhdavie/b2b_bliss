package com.bliss.b2b.payments;

import java.time.LocalDate;
import java.util.List;

/**
 * A single eligible payment plan option for a booking. Amounts use integer
 * cents. When a total does not divide evenly across {@code numPayments}, the
 * remainder lands on the final payment so the sum equals the booking total.
 */
public record PlanOption(
        PlanFrequency frequency,
        int numPayments,
        long perPaymentAmountCents,
        long finalPaymentAmountCents,
        List<LocalDate> dueDates
) {}

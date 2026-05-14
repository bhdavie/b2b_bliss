package com.bliss.b2b.service;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.persistence.BookingDao;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public class BookingService {

    private static final int TOKEN_BYTES = 12;
    private static final int TOKEN_INSERT_RETRIES = 5;

    private final BookingDao bookingDao;
    private final SecureRandom random;

    public BookingService(BookingDao bookingDao) {
        this(bookingDao, new SecureRandom());
    }

    BookingService(BookingDao bookingDao, SecureRandom random) {
        this.bookingDao = bookingDao;
        this.random = random;
    }

    public Booking create(CreateBookingInput input) {
        for (int attempt = 0; attempt < TOKEN_INSERT_RETRIES; attempt++) {
            String token = generateToken();
            if (bookingDao.findByToken(token).isPresent()) continue;
            bookingDao.insert(
                    input.merchantId(),
                    token,
                    input.serviceName(),
                    input.serviceDescription(),
                    input.totalAmountCents(),
                    input.appointmentDate(),
                    input.cancellationPolicy(),
                    input.customerNameHint(),
                    input.customerEmailHint()
            );
            return bookingDao.findByToken(token).orElseThrow();
        }
        throw new IllegalStateException("Could not generate a unique booking token");
    }

    public Optional<Booking> findById(UUID merchantId, UUID bookingId) {
        return bookingDao.findByIdForMerchant(bookingId, merchantId);
    }

    public List<Booking> list(UUID merchantId, int limit, int offset) {
        return bookingDao.listForMerchant(merchantId, limit, offset);
    }

    public long count(UUID merchantId) {
        return bookingDao.countForMerchant(merchantId);
    }

    private String generateToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public record CreateBookingInput(
            UUID merchantId,
            String serviceName,
            String serviceDescription,
            long totalAmountCents,
            LocalDate appointmentDate,
            String cancellationPolicy,
            String customerNameHint,
            String customerEmailHint
    ) {}
}

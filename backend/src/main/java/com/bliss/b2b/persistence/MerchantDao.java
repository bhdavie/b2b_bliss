package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.Merchant;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

@RegisterRowMapper(MerchantRowMapper.class)
public interface MerchantDao {

    // findById and findBySlug also bring in the Mews enterprise name, which
    // Merchant.guestFacingName falls back to. LEFT JOIN, one row per merchant
    // (merchant_mews_connections is keyed by merchant_id).
    @SqlQuery("""
            SELECT m.*, mc.enterprise_name AS mews_enterprise_name
            FROM merchants m
            LEFT JOIN merchant_mews_connections mc ON mc.merchant_id = m.id
            WHERE m.id = :id
            """)
    Optional<Merchant> findById(@Bind("id") UUID id);

    @SqlQuery("SELECT * FROM merchants WHERE email = :email")
    Optional<Merchant> findByEmail(@Bind("email") String email);

    @SqlQuery("""
            SELECT m.*, mc.enterprise_name AS mews_enterprise_name
            FROM merchants m
            LEFT JOIN merchant_mews_connections mc ON mc.merchant_id = m.id
            WHERE m.slug = :slug
            """)
    Optional<Merchant> findBySlug(@Bind("slug") String slug);

    @SqlUpdate("""
            INSERT INTO merchants (slug, email, status, is_demo)
            VALUES (:slug, :email, 'pending_verification', :isDemo)
            """)
    void insertPending(
            @Bind("slug") String slug,
            @Bind("email") String email,
            @Bind("isDemo") boolean isDemo);

    @SqlUpdate("""
            UPDATE merchants
            SET status = CASE WHEN status = 'suspended' THEN status ELSE 'active' END,
                email_verified_at = :verifiedAt
            WHERE id = :id
            """)
    void markVerified(@Bind("id") UUID id, @Bind("verifiedAt") Instant verifiedAt);

    @SqlUpdate("""
            UPDATE merchants
            SET business_name = :businessName,
                business_type = :businessType,
                phone = :phone,
                address_line1 = :addressLine1,
                address_line2 = :addressLine2,
                address_city = :addressCity,
                address_state = :addressState,
                address_zip = :addressZip
            WHERE id = :id
            """)
    int updateProfile(
            @Bind("id") UUID id,
            @Bind("businessName") String businessName,
            @Bind("businessType") String businessType,
            @Bind("phone") String phone,
            @Bind("addressLine1") String addressLine1,
            @Bind("addressLine2") String addressLine2,
            @Bind("addressCity") String addressCity,
            @Bind("addressState") String addressState,
            @Bind("addressZip") String addressZip
    );

    @SqlQuery("SELECT * FROM merchants WHERE stripe_connect_account_id = :stripeAccountId")
    Optional<Merchant> findByStripeAccountId(@Bind("stripeAccountId") String stripeAccountId);

    @SqlUpdate("""
            UPDATE merchants
            SET stripe_connect_account_id = :stripeAccountId
            WHERE id = :id
            """)
    int setStripeAccountId(@Bind("id") UUID id, @Bind("stripeAccountId") String stripeAccountId);

    @SqlUpdate("""
            UPDATE merchants
            SET stripe_connect_status = :status
            WHERE id = :id
            """)
    int updateStripeConnectStatus(@Bind("id") UUID id, @Bind("status") String status);

    @SqlUpdate("""
            UPDATE merchants
            SET pms_type = :pmsType
            WHERE id = :id
            """)
    int updatePmsType(@Bind("id") UUID id, @Bind("pmsType") String pmsType);

    /**
     * Records what the property trades in, as read from its PMS or Stripe
     * account. New bookings snapshot these; existing bookings keep theirs. A
     * null zone or locale leaves the stored one alone; currency is required.
     */
    @SqlUpdate("""
            UPDATE merchants
            SET currency  = :currency,
                time_zone = COALESCE(:timeZone, time_zone),
                locale    = COALESCE(:locale, locale)
            WHERE id = :id
            """)
    int updatePropertyLocale(
            @Bind("id") UUID id,
            @Bind("currency") String currency,
            @Bind("timeZone") String timeZone,
            @Bind("locale") String locale);

    /** Records the property's time zone only, e.g. once Mews booking setup reads it. */
    @SqlUpdate("UPDATE merchants SET time_zone = :timeZone WHERE id = :id")
    int updateTimeZone(@Bind("id") UUID id, @Bind("timeZone") String timeZone);

    @SqlUpdate("""
            UPDATE merchants
            SET onboarding_state = :state
            WHERE id = :id
            """)
    int updateOnboardingState(@Bind("id") UUID id, @Bind("state") String state);

    /**
     * The property's Bliss fee as a fraction (0.0300 = 3%). Read on the charge
     * path to size {@code application_fee_amount} on destination charges; not on
     * the {@link Merchant} record, which has no fee field.
     */
    @SqlQuery("SELECT bliss_fee_percentage FROM merchants WHERE id = :id")
    Optional<BigDecimal> findFeePercentage(@Bind("id") UUID id);
}

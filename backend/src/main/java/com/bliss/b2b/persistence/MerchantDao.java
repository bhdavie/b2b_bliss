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

    @SqlQuery("SELECT * FROM merchants WHERE id = :id")
    Optional<Merchant> findById(@Bind("id") UUID id);

    @SqlQuery("SELECT * FROM merchants WHERE email = :email")
    Optional<Merchant> findByEmail(@Bind("email") String email);

    @SqlQuery("SELECT * FROM merchants WHERE slug = :slug")
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
            SET status = 'active', email_verified_at = :verifiedAt
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

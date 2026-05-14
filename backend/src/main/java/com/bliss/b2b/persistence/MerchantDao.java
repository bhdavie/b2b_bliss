package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.Merchant;
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

    @SqlUpdate("""
            INSERT INTO merchants (slug, email, status)
            VALUES (:slug, :email, 'pending_verification')
            """)
    void insertPending(@Bind("slug") String slug, @Bind("email") String email);

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
}

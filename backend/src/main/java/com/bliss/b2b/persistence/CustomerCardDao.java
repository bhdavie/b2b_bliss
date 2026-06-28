package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.CustomerCard;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

@RegisterRowMapper(CustomerCardRowMapper.class)
public interface CustomerCardDao {

    @SqlQuery("SELECT * FROM customer_cards WHERE id = :id")
    Optional<CustomerCard> findById(@Bind("id") UUID id);

    @SqlQuery("""
            SELECT * FROM customer_cards
            WHERE stripe_payment_method_id = :paymentMethodId
            """)
    Optional<CustomerCard> findByPaymentMethodId(
            @Bind("paymentMethodId") String paymentMethodId
    );

    @SqlUpdate("""
            INSERT INTO customer_cards (
                customer_id, stripe_payment_method_id, last_four,
                exp_month, exp_year, brand, is_default
            ) VALUES (
                :customerId, :paymentMethodId, :lastFour,
                :expMonth, :expYear, :brand, :isDefault
            )
            """)
    void insert(
            @Bind("customerId") UUID customerId,
            @Bind("paymentMethodId") String paymentMethodId,
            @Bind("lastFour") String lastFour,
            @Bind("expMonth") int expMonth,
            @Bind("expYear") int expYear,
            @Bind("brand") String brand,
            @Bind("isDefault") boolean isDefault
    );

    @SqlUpdate("""
            UPDATE customer_cards
            SET is_default = FALSE
            WHERE customer_id = :customerId AND is_default = TRUE
            """)
    int markAllNonDefaultForCustomer(@Bind("customerId") UUID customerId);

    @SqlQuery("""
            SELECT * FROM customer_cards
            WHERE customer_id = :customerId AND is_default = TRUE
            ORDER BY created_at DESC
            LIMIT 1
            """)
    Optional<CustomerCard> findDefaultForCustomer(@Bind("customerId") UUID customerId);
}

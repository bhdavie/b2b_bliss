package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.Customer;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

@RegisterRowMapper(CustomerRowMapper.class)
public interface CustomerDao {

    @SqlQuery("SELECT * FROM customers WHERE id = :id")
    Optional<Customer> findById(@Bind("id") UUID id);

    @SqlQuery("SELECT * FROM customers WHERE email = :email")
    Optional<Customer> findByEmail(@Bind("email") String email);

    @SqlUpdate("""
            INSERT INTO customers (email, first_name, last_name)
            VALUES (:email, :firstName, :lastName)
            """)
    void insert(
            @Bind("email") String email,
            @Bind("firstName") String firstName,
            @Bind("lastName") String lastName
    );

    @SqlUpdate("""
            UPDATE customers
            SET stripe_customer_id = :stripeCustomerId
            WHERE id = :id
            """)
    int setStripeCustomerId(
            @Bind("id") UUID id,
            @Bind("stripeCustomerId") String stripeCustomerId
    );

    @SqlUpdate("""
            UPDATE customers SET last_login_at = :at WHERE id = :id
            """)
    int touchLastLogin(@Bind("id") UUID id, @Bind("at") Instant at);

    // Keep the customer's name in sync with what the guest entered at checkout.
    // COALESCE so a blank/missing name on this booking never wipes an existing
    // name; a provided name wins so the latest booking's identity sticks.
    @SqlUpdate("""
            UPDATE customers
            SET first_name = COALESCE(:firstName, first_name),
                last_name = COALESCE(:lastName, last_name)
            WHERE id = :id
            """)
    int updateName(
            @Bind("id") UUID id,
            @Bind("firstName") String firstName,
            @Bind("lastName") String lastName
    );
}

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
}

package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.AdminUser;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.jdbi.v3.sqlobject.config.RegisterRowMapper;
import org.jdbi.v3.sqlobject.customizer.Bind;
import org.jdbi.v3.sqlobject.statement.SqlQuery;
import org.jdbi.v3.sqlobject.statement.SqlUpdate;

/**
 * Reads and one write. There is deliberately no insert: admins are provisioned
 * by migration, so no request path can mint one. Sign-in fails closed against
 * {@link #findByEmail}.
 */
@RegisterRowMapper(AdminUserRowMapper.class)
public interface AdminUserDao {

    @SqlQuery("SELECT * FROM admin_users WHERE id = :id")
    Optional<AdminUser> findById(@Bind("id") UUID id);

    @SqlQuery("SELECT * FROM admin_users WHERE email = :email")
    Optional<AdminUser> findByEmail(@Bind("email") String email);

    @SqlUpdate("""
            UPDATE admin_users
            SET last_login_at = :now
            WHERE id = :id
            """)
    int touchLastLogin(@Bind("id") UUID id, @Bind("now") Instant now);
}

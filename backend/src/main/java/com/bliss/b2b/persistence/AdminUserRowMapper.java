package com.bliss.b2b.persistence;

import com.bliss.b2b.domain.AdminUser;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.UUID;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public class AdminUserRowMapper implements RowMapper<AdminUser> {
    @Override
    public AdminUser map(ResultSet rs, StatementContext ctx) throws SQLException {
        Timestamp createdAt = rs.getTimestamp("created_at");
        Timestamp lastLoginAt = rs.getTimestamp("last_login_at");
        return new AdminUser(
                (UUID) rs.getObject("id"),
                rs.getString("email"),
                rs.getString("name"),
                createdAt == null ? null : createdAt.toInstant(),
                lastLoginAt == null ? null : lastLoginAt.toInstant()
        );
    }
}

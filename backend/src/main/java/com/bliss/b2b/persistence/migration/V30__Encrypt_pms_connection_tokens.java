package com.bliss.b2b.persistence.migration;

import com.bliss.b2b.security.TokenCipher;
import com.bliss.b2b.security.TokenCipher.Field;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

/**
 * Encrypts the PMS credentials that V17 (Mews) and V21 (Cloudbeds) stored in
 * plaintext, and adds CHECK constraints so plaintext cannot be written again.
 *
 * <p>A Java migration because SQL cannot reach the application's key. It is
 * deliberately outside {@code db/migration}, so Flyway's classpath scan never
 * finds it and tries to build it without a cipher; {@code BlissApplication}
 * registers it explicitly through {@code javaMigrations}. Flyway takes the
 * version and description from the class name, so do not rename it.
 *
 * <p>Per table: widen the token columns to TEXT (a sealed value is longer than
 * the plaintext, and Cloudbeds tokens were already up to 2048 characters),
 * encrypt every value that is not already in {@code v1:} form, then add the
 * constraint. Runs in Flyway's transaction, so a failure part way leaves every
 * row as it was.
 */
public class V30__Encrypt_pms_connection_tokens extends BaseJavaMigration {

    private final TokenCipher cipher;

    public V30__Encrypt_pms_connection_tokens(TokenCipher cipher) {
        this.cipher = cipher;
    }

    @Override
    public void migrate(Context context) throws Exception {
        Connection conn = context.getConnection();
        encryptTable(conn, "merchant_mews_connections",
                "client_token", Field.MEWS_CLIENT_TOKEN,
                "access_token", Field.MEWS_ACCESS_TOKEN,
                "merchant_mews_connections_tokens_encrypted_chk");
        encryptTable(conn, "merchant_cloudbeds_connections",
                "access_token", Field.CLOUDBEDS_ACCESS_TOKEN,
                "refresh_token", Field.CLOUDBEDS_REFRESH_TOKEN,
                "merchant_cloudbeds_connections_tokens_encrypted_chk");
    }

    private void encryptTable(Connection conn, String table,
            String colA, Field fieldA, String colB, Field fieldB,
            String constraint) throws SQLException {
        try (Statement st = conn.createStatement()) {
            st.execute("ALTER TABLE " + table
                    + " ALTER COLUMN " + colA + " TYPE TEXT,"
                    + " ALTER COLUMN " + colB + " TYPE TEXT");
        }

        List<Object[]> rows = new ArrayList<>();
        try (Statement st = conn.createStatement();
                ResultSet rs = st.executeQuery(
                        "SELECT merchant_id, " + colA + ", " + colB + " FROM " + table + " FOR UPDATE")) {
            while (rs.next()) {
                rows.add(new Object[] {rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3)});
            }
        }

        try (PreparedStatement update = conn.prepareStatement(
                "UPDATE " + table + " SET " + colA + " = ?, " + colB + " = ? WHERE merchant_id = ?")) {
            for (Object[] row : rows) {
                UUID merchantId = (UUID) row[0];
                String a = (String) row[1];
                String b = (String) row[2];
                if (cipher.isEncrypted(a) && cipher.isEncrypted(b)) {
                    continue;
                }
                update.setString(1, cipher.isEncrypted(a) ? a : cipher.encrypt(fieldA, merchantId, a));
                update.setString(2, cipher.isEncrypted(b) ? b : cipher.encrypt(fieldB, merchantId, b));
                update.setObject(3, merchantId);
                update.addBatch();
            }
            update.executeBatch();
        }

        try (Statement st = conn.createStatement()) {
            st.execute("ALTER TABLE " + table + " ADD CONSTRAINT " + constraint
                    + " CHECK (" + colA + " LIKE 'v1:%' AND " + colB + " LIKE 'v1:%')");
        }
    }
}

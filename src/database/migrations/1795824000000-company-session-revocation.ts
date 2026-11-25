import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CompanySessionRevocation1795824000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE identity_users ADD COLUMN session_version bigint NOT NULL DEFAULT 0',
    );
    // This read contract belongs to Companies; Identity does not read its tables.
    await queryRunner.query(`
      CREATE VIEW company_account_availability AS
      SELECT m.user_id, bool_or(c.disabled_at IS NULL) AS has_available_company
      FROM company_memberships m JOIN companies c ON c.id = m.company_id
      WHERE m.revoked_at IS NULL
      GROUP BY m.user_id
    `);
    // Revoke legacy sessions for memberships that are already suspended.
    await queryRunner.query(`
      UPDATE identity_users u SET session_version = 1
      WHERE EXISTS (
        SELECT 1 FROM company_memberships m
        JOIN companies c ON c.id = m.company_id
        WHERE m.user_id = u.id AND m.revoked_at IS NULL
          AND c.disabled_at IS NOT NULL
      )
    `);
    await queryRunner.query(`
      DELETE FROM identity_sessions s
      WHERE EXISTS (SELECT 1 FROM identity_users u
                    WHERE u.session_version > 0
                    AND s.sess ->> 'userId' = u.id::text)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const [state] = (await queryRunner.query(
      'SELECT EXISTS (SELECT 1 FROM identity_users WHERE session_version > 0) AS "hasRevocations"',
    )) as { hasRevocations: boolean }[];
    if (state?.hasRevocations) {
      throw new Error('Cannot remove session revocation rules after use');
    }
    await queryRunner.query('DROP VIEW company_account_availability');
    await queryRunner.query(
      'ALTER TABLE identity_users DROP COLUMN session_version',
    );
  }
}

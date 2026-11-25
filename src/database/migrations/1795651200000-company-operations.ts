import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CompanyOperations1795651200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE companies ADD COLUMN disabled_at timestamptz',
    );
    await queryRunner.query(
      'ALTER TABLE company_admin_invitations ADD COLUMN revoked_at timestamptz',
    );
    await queryRunner.query(
      'ALTER TABLE company_memberships ADD COLUMN revoked_at timestamptz',
    );
    await queryRunner.query('DROP INDEX company_initial_admin_idx');
    await queryRunner.query(`
      CREATE UNIQUE INDEX company_initial_admin_idx
      ON company_memberships (company_id)
      WHERE role = 'admin' AND revoked_at IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const [state] = (await queryRunner.query(`
      SELECT EXISTS (SELECT 1 FROM companies WHERE disabled_at IS NOT NULL)
          OR EXISTS (SELECT 1 FROM company_admin_invitations WHERE revoked_at IS NOT NULL)
          OR EXISTS (SELECT 1 FROM company_memberships WHERE revoked_at IS NOT NULL)
          AS "requiresNewAccessRules"
    `)) as { requiresNewAccessRules: boolean }[];
    if (state?.requiresNewAccessRules) {
      throw new Error(
        'Cannot roll back company access rules after disabling or transferring access',
      );
    }
    await queryRunner.query('DROP INDEX company_initial_admin_idx');
    await queryRunner.query(`
      CREATE UNIQUE INDEX company_initial_admin_idx
      ON company_memberships (company_id) WHERE role = 'admin'
    `);
    await queryRunner.query(
      'ALTER TABLE company_memberships DROP COLUMN revoked_at',
    );
    await queryRunner.query(
      'ALTER TABLE company_admin_invitations DROP COLUMN revoked_at',
    );
    await queryRunner.query('ALTER TABLE companies DROP COLUMN disabled_at');
  }
}

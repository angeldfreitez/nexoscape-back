import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Companies1795478400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE identity_users
      ADD COLUMN platform_founder boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      CREATE TABLE companies (
        id uuid PRIMARY KEY,
        name varchar(120) NOT NULL,
        initial_admin_email varchar(254) NOT NULL,
        CONSTRAINT company_name_trimmed CHECK (
          name <> '' AND name = trim(name)
        ),
        CONSTRAINT company_admin_email_normalized CHECK (
          initial_admin_email <> ''
          AND initial_admin_email = lower(trim(initial_admin_email))
        )
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE companies');
    await queryRunner.query(
      'ALTER TABLE identity_users DROP COLUMN platform_founder',
    );
  }
}

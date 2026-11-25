import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminInvitations1795564800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE company_admin_invitations (
        company_id uuid PRIMARY KEY REFERENCES companies(id),
        email varchar(254) NOT NULL,
        token_hash varchar(64) UNIQUE NOT NULL,
        expires_at timestamptz NOT NULL,
        accepted_at timestamptz
      )
    `);
    await queryRunner.query(`
      CREATE TABLE company_memberships (
        company_id uuid NOT NULL REFERENCES companies(id),
        user_id uuid NOT NULL REFERENCES identity_users(id),
        role varchar(16) NOT NULL CHECK (role = 'admin'),
        PRIMARY KEY (company_id, user_id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX company_initial_admin_idx
      ON company_memberships (company_id) WHERE role = 'admin'
    `);
    await queryRunner.query(`
      CREATE INDEX company_membership_user_idx ON company_memberships (user_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE company_memberships');
    await queryRunner.query('DROP TABLE company_admin_invitations');
  }
}

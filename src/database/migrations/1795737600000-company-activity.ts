import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CompanyActivity1795737600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE company_events (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id uuid NOT NULL REFERENCES companies(id),
        kind varchar(32) NOT NULL CHECK (kind IN (
          'company_created', 'link_sent', 'transfer_requested', 'link_revoked',
          'admin_assigned', 'admin_transferred', 'company_disabled',
          'company_reactivated'
        )),
        occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        actor_user_id uuid NOT NULL REFERENCES identity_users(id),
        actor_email varchar(254) NOT NULL,
        target_email varchar(254),
        previous_email varchar(254)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX company_events_recent_idx ON company_events (company_id, id DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Avoid dropping audit history in a routine rollback.
    const [state] = (await queryRunner.query(
      'SELECT EXISTS (SELECT 1 FROM company_events) AS "hasActivity"',
    )) as { hasActivity: boolean }[];
    if (state?.hasActivity) {
      throw new Error('Cannot roll back while company activity exists');
    }
    await queryRunner.query('DROP TABLE company_events');
  }
}

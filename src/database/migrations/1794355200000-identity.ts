import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Identity1794355200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE identity_users (
        id uuid PRIMARY KEY,
        email varchar(254) NOT NULL UNIQUE,
        password_hash text NOT NULL,
        active boolean NOT NULL DEFAULT true,
        CONSTRAINT identity_email_normalized CHECK (email = lower(trim(email)))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE identity_sessions (
        sid varchar NOT NULL PRIMARY KEY,
        sess json NOT NULL,
        expire timestamp(6) NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX identity_sessions_expire_idx ON identity_sessions (expire)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE identity_sessions');
    await queryRunner.query('DROP TABLE identity_users');
  }
}

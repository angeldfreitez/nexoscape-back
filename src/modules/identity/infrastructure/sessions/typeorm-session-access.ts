import type { EntityManager } from 'typeorm';
import type { SessionAccess } from '../../application/ports/session-access.js';

export class TypeormSessionAccess implements SessionAccess {
  constructor(private readonly manager: EntityManager) {}

  async version(userId: string): Promise<string | null> {
    const rows: { version: string }[] = await this.manager.query(
      `SELECT u.session_version::text AS version
       FROM identity_users u
       LEFT JOIN company_account_availability a ON a.user_id = u.id
       WHERE u.id = $1 AND u.active
         AND (u.platform_founder OR COALESCE(a.has_available_company, true))`,
      [userId],
    );
    return rows[0]?.version ?? null;
  }

  async lockAccounts(userIds: string[]): Promise<void> {
    if (!userIds.length) return;
    await this.manager.query(
      `SELECT id FROM identity_users
       WHERE id = ANY($1::uuid[]) ORDER BY id FOR NO KEY UPDATE`,
      [userIds],
    );
  }

  async revokeUsersWithoutAvailableCompany(userIds: string[]): Promise<void> {
    if (!userIds.length) return;
    const unavailable: { userId: string }[] = await this.manager.query(
      `SELECT user_id AS "userId"
       FROM company_account_availability
       WHERE user_id = ANY($1::uuid[]) AND NOT has_available_company`,
      [userIds],
    );
    await this.revokeUsers(unavailable.map((account) => account.userId));
  }

  private async revokeUsers(userIds: string[]): Promise<void> {
    if (!userIds.length) return;
    // Bump as well as deleting. A response already in flight cannot restore
    // a session with the old version, even after the company is reactivated.
    await this.manager.query(
      `UPDATE identity_users SET session_version = session_version + 1
       WHERE id = ANY($1::uuid[])`,
      [userIds],
    );
    await this.manager.query(
      `DELETE FROM identity_sessions WHERE (sess ->> 'userId') = ANY($1::text[])`,
      [userIds],
    );
  }
}

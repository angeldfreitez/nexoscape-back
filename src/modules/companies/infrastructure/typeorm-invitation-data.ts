import type { DataSource, EntityManager } from 'typeorm';
import type { PasswordHasher } from '../../identity/application/ports/password-hasher.js';
import { InvitedAccounts } from '../../identity/infrastructure/persistence/invited-accounts.js';
import {
  InvitationProblem,
  type AdminInvitation,
  type InvitationData,
  type InvitationTransaction,
} from '../application/admin-invitations.js';

import type { NewCompanyEvent } from '../domain/company-event.js';
import { recordCompanyEvent } from './company-events.js';

import { TypeormSessionAccess } from '../../identity/infrastructure/sessions/typeorm-session-access.js';

const invitationQuery = `
  SELECT i.company_id AS "companyId", c.name AS "companyName", i.email,
         i.expires_at AS "expiresAt", i.accepted_at AS "acceptedAt",
         i.revoked_at AS "revokedAt", (c.disabled_at IS NOT NULL) AS "companyDisabled"
  FROM company_admin_invitations i
  JOIN companies c ON c.id = i.company_id
`;

class PostgresInvitationTransaction implements InvitationTransaction {
  private readonly accounts: InvitedAccounts;

  constructor(private readonly manager: EntityManager) {
    this.accounts = new InvitedAccounts(manager);
  }

  async company(id: string) {
    const rows: {
      name: string;
      initialAdminEmail: string;
      disabled: boolean;
      hasAdmin: boolean;
    }[] = await this.manager.query(
      `SELECT c.name, c.initial_admin_email AS "initialAdminEmail",
              (c.disabled_at IS NOT NULL) AS disabled,
              EXISTS (SELECT 1 FROM company_memberships m
                      WHERE m.company_id = c.id AND m.role = 'admin'
                        AND m.revoked_at IS NULL) AS "hasAdmin"
       FROM companies c WHERE c.id = $1`,
      [id],
    );
    return rows[0];
  }

  async setAvailability(
    companyId: string,
    active: boolean,
  ): Promise<string | null> {
    const members: { userId: string }[] = await this.manager.query(
      `SELECT user_id AS "userId" FROM company_memberships
       WHERE company_id = $1 AND revoked_at IS NULL
       ORDER BY user_id`,
      [companyId],
    );
    const sessions = new TypeormSessionAccess(this.manager);
    const memberIds = members.map((member) => member.userId);
    // Two companies can change at the same time. Evaluate the account only
    // after locking it, so a parallel suspension cannot hide the last loss.
    await sessions.lockAccounts(memberIds);

    if (active) {
      await this.manager.query(
        'UPDATE companies SET disabled_at = NULL WHERE id = $1',
        [companyId],
      );
      return null;
    }

    await this.manager.query(
      `UPDATE companies SET disabled_at = COALESCE(disabled_at, clock_timestamp())
       WHERE id = $1`,
      [companyId],
    );
    await sessions.revokeUsersWithoutAvailableCompany(memberIds);
    const revoked: { email: string }[] = await this.manager.query(
      `WITH revoked AS (
         UPDATE company_admin_invitations SET revoked_at = clock_timestamp()
         WHERE company_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
           AND expires_at > clock_timestamp()
         RETURNING email
       ) SELECT email FROM revoked`,
      [companyId],
    );
    return revoked[0]?.email ?? null;
  }

  record(event: NewCompanyEvent): Promise<void> {
    return recordCompanyEvent(this.manager, event);
  }

  async current(companyId: string) {
    const rows: AdminInvitation[] = await this.manager.query(
      invitationQuery + ' WHERE i.company_id = $1',
      [companyId],
    );
    return rows[0];
  }

  async save(invitation: AdminInvitation, digest: string): Promise<void> {
    await this.manager.query(
      `INSERT INTO company_admin_invitations
         (company_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id) DO UPDATE
       SET email = EXCLUDED.email, token_hash = EXCLUDED.token_hash,
           expires_at = EXCLUDED.expires_at, accepted_at = NULL, revoked_at = NULL`,
      [invitation.companyId, invitation.email, digest, invitation.expiresAt],
    );
  }

  async find(digest: string) {
    const rows: AdminInvitation[] = await this.manager.query(
      invitationQuery + ' WHERE i.token_hash = $1',
      [digest],
    );
    return rows[0];
  }

  account(email: string) {
    return this.accounts.find(email);
  }

  async hasCompanyHistory(userId: string): Promise<boolean> {
    const rows: { hasHistory: boolean }[] = await this.manager.query(
      `SELECT EXISTS (
         SELECT 1 FROM company_memberships WHERE user_id = $1
       ) AS "hasHistory"`,
      [userId],
    );
    return rows[0]?.hasHistory ?? false;
  }

  verifyAccountPassword(
    userId: string,
    password: string,
    hasher: PasswordHasher,
  ): Promise<boolean> {
    return this.accounts.verifyPassword(userId, password, hasher);
  }

  createAccount(email: string, passwordHash: string) {
    return this.accounts.create(email, passwordHash);
  }

  async assign(
    companyId: string,
    userId: string,
    email: string,
  ): Promise<void> {
    await this.manager.query(
      `UPDATE company_memberships SET revoked_at = clock_timestamp()
       WHERE company_id = $1 AND role = 'admin' AND revoked_at IS NULL
         AND user_id <> $2`,
      [companyId, userId],
    );
    await this.manager.query(
      `INSERT INTO company_memberships (company_id, user_id, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (company_id, user_id) DO UPDATE SET role = 'admin', revoked_at = NULL`,
      [companyId, userId],
    );
    await this.manager.query(
      'UPDATE companies SET initial_admin_email = $2 WHERE id = $1',
      [companyId, email],
    );
  }

  async consume(companyId: string): Promise<void> {
    await this.manager.query(
      `UPDATE company_admin_invitations SET accepted_at = clock_timestamp()
       WHERE company_id = $1`,
      [companyId],
    );
  }
}

export class TypeormInvitationData implements InvitationData {
  constructor(private readonly database: DataSource) {}

  read<T>(action: (db: InvitationTransaction) => Promise<T>): Promise<T> {
    return action(new PostgresInvitationTransaction(this.database.manager));
  }

  forCompany<T>(
    companyId: string,
    action: (db: InvitationTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (manager) => {
      await manager.query('SELECT id FROM companies WHERE id = $1 FOR UPDATE', [
        companyId,
      ]);
      return action(new PostgresInvitationTransaction(manager));
    });
  }

  forToken<T>(
    digest: string,
    action: (db: InvitationTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (manager) => {
      const locked: { id: string }[] = await manager.query(
        `SELECT c.id FROM companies c
         JOIN company_admin_invitations i ON i.company_id = c.id
         WHERE i.token_hash = $1 FOR UPDATE OF c`,
        [digest],
      );
      // Do not re-read or accept a token if this transaction did not lock its company.
      if (!locked.length) throw new InvitationProblem('invitation_unavailable');
      return action(new PostgresInvitationTransaction(manager));
    });
  }
}

import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import type { CompanyRegistry } from '../application/manage-companies.js';
import type {
  Company,
  CompanyDetails,
  CompanySummary,
  ManagedCompany,
} from '../domain/company.js';
import type { CompanyEntity } from './company.entity.js';

import type {
  CompanyActivity,
  CompanyEvent,
  CompanyEventActor,
} from '../domain/company-event.js';
import { recordCompanyEvent } from './company-events.js';

const ACTIVITY_PAGE_SIZE = 30;

const companySummary = `
      SELECT c.id, c.name, c.initial_admin_email AS "initialAdminEmail",
             COALESCE(m.total, 0)::int AS "linkedUsers",
             CASE
               WHEN c.disabled_at IS NOT NULL THEN 'disabled'
               WHEN COALESCE(m.total, 0) > 0 THEN 'active'
               WHEN i.company_id IS NOT NULL AND i.accepted_at IS NULL
                 AND i.revoked_at IS NULL AND i.expires_at > statement_timestamp()
                 THEN 'awaiting_acceptance'
               ELSE 'pending_access'
             END AS status,
             CASE WHEN i.accepted_at IS NULL THEN i.email END AS "invitedAdminEmail",
             CASE
               WHEN i.company_id IS NULL AND COALESCE(m.total, 0) > 0 THEN 'assigned'
               WHEN i.company_id IS NULL THEN 'pending'
               WHEN i.accepted_at IS NOT NULL THEN 'assigned'
               WHEN i.revoked_at IS NOT NULL THEN 'cancelled'
               WHEN i.expires_at <= statement_timestamp() THEN 'expired'
               ELSE 'invited'
             END AS "initialAdminStatus"
      FROM companies c
      LEFT JOIN company_admin_invitations i ON i.company_id = c.id
      LEFT JOIN LATERAL (
        SELECT count(*) AS total FROM company_memberships
        WHERE company_id = c.id AND revoked_at IS NULL
      ) m ON true
`;

export class TypeormCompanyRegistry implements CompanyRegistry {
  constructor(private readonly repository: Repository<CompanyEntity>) {}

  list(): Promise<CompanySummary[]> {
    return this.repository.query(companySummary + ' ORDER BY c.name, c.id');
  }

  async find(id: string): Promise<CompanySummary | null> {
    const rows: CompanySummary[] = await this.repository.query(
      companySummary + ' WHERE c.id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  managedBy(userId: string, companyId?: string): Promise<ManagedCompany[]> {
    return this.repository.query(
      `SELECT c.id, c.name, m.role,
              CASE WHEN c.disabled_at IS NULL THEN 'active' ELSE 'disabled' END AS status,
              COALESCE((
                SELECT e.id
                FROM company_events e
                WHERE e.company_id = c.id
                  AND e.kind IN ('company_disabled', 'admin_transferred')
                ORDER BY e.id DESC LIMIT 1
              ), 0)::text AS "accessVersion"
       FROM company_memberships m JOIN companies c ON c.id = m.company_id
       WHERE m.user_id = $1 AND m.revoked_at IS NULL
         AND ($2::uuid IS NULL OR c.id = $2::uuid)
       ORDER BY (c.disabled_at IS NOT NULL), c.name, c.id`,
      [userId, companyId ?? null],
    );
  }

  async activity(id: string, before: string | null): Promise<CompanyActivity> {
    const rows: CompanyEvent[] = await this.repository.query(
      `SELECT id::text, kind, occurred_at AS "occurredAt", actor_email AS "actorEmail",
              target_email AS "targetEmail", previous_email AS "previousEmail"
       FROM company_events WHERE company_id = $1
         AND ($2::bigint IS NULL OR id < $2::bigint)
       ORDER BY company_events.id DESC LIMIT $3`,
      [id, before, ACTIVITY_PAGE_SIZE + 1],
    );
    const events = rows.slice(0, ACTIVITY_PAGE_SIZE);
    return {
      events,
      nextCursor:
        rows.length > ACTIVITY_PAGE_SIZE ? (events.at(-1)?.id ?? null) : null,
    };
  }

  async create(
    details: CompanyDetails,
    actor: CompanyEventActor,
  ): Promise<Company> {
    const company = { id: randomUUID(), ...details };
    await this.repository.manager.transaction(async (manager) => {
      await manager.insert(this.repository.target, company);
      await recordCompanyEvent(manager, {
        companyId: company.id,
        kind: 'company_created',
        actor,
      });
    });
    return company;
  }
}

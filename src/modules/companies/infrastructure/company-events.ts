import type { EntityManager } from 'typeorm';
import type { NewCompanyEvent } from '../domain/company-event.js';

export async function recordCompanyEvent(
  manager: EntityManager,
  event: NewCompanyEvent,
): Promise<void> {
  await manager.query(
    `INSERT INTO company_events
       (company_id, kind, actor_user_id, actor_email, target_email, previous_email)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      event.companyId,
      event.kind,
      event.actor.id,
      event.actor.email,
      event.targetEmail ?? null,
      event.previousEmail ?? null,
    ],
  );
}

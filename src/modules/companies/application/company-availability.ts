import type { CompanyEventActor } from '../domain/company-event.js';
import { InvitationProblem, type InvitationData } from './admin-invitations.js';

export class CompanyAvailability {
  constructor(private readonly data: InvitationData) {}

  set(
    companyId: string,
    active: boolean,
    actor: CompanyEventActor,
  ): Promise<void> {
    return this.data.forCompany(companyId, async (db) => {
      const company = await db.company(companyId);
      if (!company) {
        throw new InvitationProblem('company_not_found');
      }
      if (company.disabled === !active) return;

      const revokedEmail = await db.setAvailability(companyId, active);
      await db.record({
        companyId,
        kind: active ? 'company_reactivated' : 'company_disabled',
        actor,
      });
      if (revokedEmail) {
        await db.record({
          companyId,
          kind: 'link_revoked',
          actor,
          targetEmail: revokedEmail,
        });
      }
    });
  }
}

import type {
  Company,
  CompanyDetails,
  CompanySummary,
  ManagedCompany,
} from '../domain/company.js';

import type {
  CompanyActivity,
  CompanyEventActor,
} from '../domain/company-event.js';

export interface CompanyRegistry {
  list(): Promise<CompanySummary[]>;
  find(id: string): Promise<CompanySummary | null>;
  managedBy(userId: string, companyId?: string): Promise<ManagedCompany[]>;
  activity(id: string, before: string | null): Promise<CompanyActivity>;
  create(details: CompanyDetails, actor: CompanyEventActor): Promise<Company>;
}

export class ManageCompanies {
  constructor(private readonly registry: CompanyRegistry) {}

  list(): Promise<CompanySummary[]> {
    return this.registry.list();
  }

  find(id: string): Promise<CompanySummary | null> {
    return this.registry.find(id);
  }

  managedBy(userId: string, companyId?: string): Promise<ManagedCompany[]> {
    return this.registry.managedBy(userId, companyId);
  }

  activity(id: string, before: string | null): Promise<CompanyActivity> {
    return this.registry.activity(id, before);
  }

  create(details: CompanyDetails, actor: CompanyEventActor): Promise<Company> {
    return this.registry.create(details, actor);
  }
}

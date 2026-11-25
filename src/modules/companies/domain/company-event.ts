export type CompanyEventKind =
  | 'company_created'
  | 'link_sent'
  | 'transfer_requested'
  | 'link_revoked'
  | 'admin_assigned'
  | 'admin_transferred'
  | 'company_disabled'
  | 'company_reactivated';

export interface CompanyEventActor {
  id: string;
  email: string;
}

export interface NewCompanyEvent {
  companyId: string;
  kind: CompanyEventKind;
  actor: CompanyEventActor;
  targetEmail?: string;
  previousEmail?: string;
}

export interface CompanyEvent {
  id: string;
  kind: CompanyEventKind;
  occurredAt: Date;
  actorEmail: string;
  targetEmail: string | null;
  previousEmail: string | null;
}

export interface CompanyActivity {
  events: CompanyEvent[];
  nextCursor: string | null;
}

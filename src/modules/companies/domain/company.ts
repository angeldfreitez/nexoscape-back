export interface CompanyDetails {
  name: string;
  initialAdminEmail: string;
}

export interface Company extends CompanyDetails {
  id: string;
}

export interface CompanySummary extends Company {
  linkedUsers: number;
  status: 'pending_access' | 'awaiting_acceptance' | 'active' | 'disabled';
  invitedAdminEmail: string | null;
  initialAdminStatus:
    'pending' | 'invited' | 'expired' | 'assigned' | 'cancelled';
}

export interface ManagedCompany {
  id: string;
  name: string;
  role: 'admin';
  status: 'active' | 'disabled';
  accessVersion: string;
}

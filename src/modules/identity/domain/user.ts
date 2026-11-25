export interface IdentityUser {
  id: string;
  email: string;
  passwordHash: string;
  active: boolean;
  platformFounder: boolean;
}

export interface PublicUser {
  id: string;
  email: string;
  canManageCompanies: boolean;
}

export function publicUser(user: IdentityUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    canManageCompanies: user.platformFounder,
  };
}

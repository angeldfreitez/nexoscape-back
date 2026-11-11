export interface IdentityUser {
  id: string;
  email: string;
  passwordHash: string;
  active: boolean;
}

export interface PublicUser {
  id: string;
  email: string;
}

export function publicUser(user: IdentityUser): PublicUser {
  return { id: user.id, email: user.email };
}

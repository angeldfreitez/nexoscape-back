import type { IdentityUser } from '../../domain/user.js';

export interface IdentityStore {
  findByEmail(email: string): Promise<IdentityUser | null>;
  findById(id: string): Promise<IdentityUser | null>;
  create(email: string, passwordHash: string): Promise<void>;
}

export const IDENTITY_STORE = Symbol('IDENTITY_STORE');

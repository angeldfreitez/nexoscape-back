import type { IdentityStore } from '../ports/identity-store.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import { publicUser, type PublicUser } from '../../domain/user.js';

export class Authenticate {
  constructor(
    private readonly users: IdentityStore,
    private readonly passwords: PasswordHasher,
    private readonly dummyHash: string,
  ) {}

  async execute(email: string, password: string): Promise<PublicUser | null> {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    // An unknown account still incurs the password verification cost.
    const matches = await this.passwords.verify(
      user?.passwordHash ?? this.dummyHash,
      password,
    );
    if (!user || !matches || !user.active) return null;
    return publicUser(user);
  }
}

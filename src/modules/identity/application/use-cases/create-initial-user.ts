import type { NewPasswordPolicy } from '../new-password-policy.js';
import type { IdentityStore } from '../ports/identity-store.js';
import type { PasswordHasher } from '../ports/password-hasher.js';

export class InitialPasswordLengthError extends Error {
  constructor() {
    super('La contraseña debe tener entre 15 y 128 caracteres.');
    this.name = 'InitialPasswordLengthError';
  }
}

export class InitialPasswordBlockedError extends Error {
  constructor() {
    super('La contraseña es común o insegura. Elige una frase diferente.');
    this.name = 'InitialPasswordBlockedError';
  }
}

export function validateInitialPassword(
  policy: NewPasswordPolicy,
  password: string,
  email: string,
): void {
  const problem = policy.check(password, email);
  if (problem === 'length') throw new InitialPasswordLengthError();
  if (problem === 'blocked') throw new InitialPasswordBlockedError();
}

export class CreateInitialUser {
  constructor(
    private readonly users: IdentityStore,
    private readonly passwords: PasswordHasher,
    private readonly policy: NewPasswordPolicy,
  ) {}

  async execute(email: string, password: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    validateInitialPassword(this.policy, password, normalized);
    if (await this.users.findByEmail(normalized)) {
      throw new Error('User already exists; no credentials were changed');
    }
    await this.users.create(normalized, await this.passwords.hash(password));
  }
}

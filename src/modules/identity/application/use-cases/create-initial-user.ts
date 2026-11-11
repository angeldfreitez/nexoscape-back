import type { IdentityStore } from '../ports/identity-store.js';
import type { PasswordHasher } from '../ports/password-hasher.js';

export class InitialPasswordLengthError extends Error {
  constructor() {
    super('La contraseña debe tener entre 15 y 128 caracteres.');
    this.name = 'InitialPasswordLengthError';
  }
}

export function validateInitialPassword(password: string): void {
  if (password.length < 15 || password.length > 128) {
    throw new InitialPasswordLengthError();
  }
}

export class CreateInitialUser {
  constructor(
    private readonly users: IdentityStore,
    private readonly passwords: PasswordHasher,
  ) {}

  async execute(email: string, password: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    validateInitialPassword(password);
    if (await this.users.findByEmail(normalized)) {
      throw new Error('User already exists; no credentials were changed');
    }
    await this.users.create(normalized, await this.passwords.hash(password));
  }
}

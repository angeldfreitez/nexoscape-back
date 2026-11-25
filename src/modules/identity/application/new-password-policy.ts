import {
  MAX_PASSWORD_LENGTH,
  MIN_NEW_PASSWORD_LENGTH,
  passwordLength,
} from '../domain/password-length.js';

export type NewPasswordProblem = 'length' | 'blocked';

export interface PasswordBlocklist {
  matches(password: string): boolean;
}

export class NewPasswordPolicy {
  constructor(private readonly blocklist: PasswordBlocklist) {}

  check(password: string, email: string): NewPasswordProblem | null {
    const normalized = password.normalize('NFC');
    const length = passwordLength(normalized);
    if (length < MIN_NEW_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
      return 'length';
    }

    const comparison = normalized.toLowerCase();
    const identifier = email.normalize('NFC').toLowerCase();
    const repeated = Array.from(comparison).every(
      (character, _index, characters) => character === characters[0],
    );
    if (
      /^\s+$/u.test(normalized) ||
      repeated ||
      comparison === identifier ||
      comparison === identifier.split('@')[0] ||
      this.blocklist.matches(comparison)
    ) {
      return 'blocked';
    }

    return null;
  }
}

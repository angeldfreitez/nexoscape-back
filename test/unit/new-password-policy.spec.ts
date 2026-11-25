import { describe, expect, it } from 'vitest';
import { NewPasswordPolicy } from '../../src/modules/identity/application/new-password-policy.js';
import { LocalPasswordBlocklist } from '../../src/modules/identity/infrastructure/security/local-password-blocklist.js';

const email = 'long-invited-user@example.invalid';
const policy = new NewPasswordPolicy(new LocalPasswordBlocklist());

describe('New password policy', () => {
  it.each([
    'ab cd ef gh ijk',
    'es una frase de prueba',
    'clave con 🌿 y acento',
  ])(
    'accepts a sufficiently long phrase without composition rules',
    (password) => {
      expect(policy.check(password, email)).toBeNull();
    },
  );

  it('counts Unicode code points after NFC, not UTF-16 units', () => {
    expect(policy.check('🌿'.repeat(14), email)).toBe('length');
    expect(policy.check('a' + '🌿'.repeat(127), email)).toBeNull();
    expect(policy.check('a' + '🌿'.repeat(128), email)).toBe('length');
    expect(policy.check('a'.repeat(13) + 'e\u0301', email)).toBe('length');
  });

  it.each([
    '123456789012345',
    'PASSWORDPASSWORD',
    '*'.repeat(15),
    ' '.repeat(15),
    email,
    'long-invited-user',
  ])('rejects the complete common or context-specific value', (password) => {
    expect(policy.check(password, email)).toBe('blocked');
  });

  it('does not reject a strong phrase just because it contains a listed value', () => {
    expect(
      policy.check('123456789012345 en una frase distinta', email),
    ).toBeNull();
  });
});

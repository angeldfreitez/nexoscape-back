import { describe, expect, it, vi } from 'vitest';
import { Authenticate } from '../../src/modules/identity/application/use-cases/authenticate.js';
import { CreateInitialUser } from '../../src/modules/identity/application/use-cases/create-initial-user.js';
import type { IdentityStore } from '../../src/modules/identity/application/ports/identity-store.js';
import { ArgonPasswordHasher } from '../../src/modules/identity/infrastructure/security/argon-password-hasher.js';
import { readEnvironment } from '../../src/config/environment.js';

const user = {
  id: 'synthetic-id',
  email: 'test@example.invalid',
  passwordHash: 'encoded',
  active: true,
};
function fixtures() {
  const store: IdentityStore = {
    findByEmail: vi.fn().mockResolvedValue(user),
    findById: vi.fn().mockResolvedValue(user),
    create: vi.fn().mockResolvedValue(undefined),
  };
  const passwords = {
    hash: vi.fn().mockResolvedValue('encoded'),
    verify: vi.fn().mockResolvedValue(true),
  };
  return {
    store,
    passwords,
    authenticate: new Authenticate(store, passwords, 'dummy'),
  };
}

describe('Identity use cases', () => {
  it('normalizes email and never returns the password hash', async () => {
    const { store, authenticate } = fixtures();
    expect(
      await authenticate.execute(' TEST@EXAMPLE.INVALID ', 'synthetic'),
    ).toEqual({ id: user.id, email: user.email });
    expect(store.findByEmail).toHaveBeenCalledWith(user.email);
  });
  it('performs a dummy verification for an unknown email', async () => {
    const { store, passwords, authenticate } = fixtures();
    vi.mocked(store.findByEmail).mockResolvedValue(null);
    expect(await authenticate.execute(user.email, 'wrong')).toBeNull();
    expect(passwords.verify).toHaveBeenCalledWith('dummy', 'wrong');
  });
  it('rejects incorrect credentials', async () => {
    const { passwords, authenticate } = fixtures();
    passwords.verify.mockResolvedValue(false);
    expect(await authenticate.execute(user.email, 'wrong')).toBeNull();
  });
  it('rejects disabled accounts even with a correct password', async () => {
    const { store, authenticate } = fixtures();
    vi.mocked(store.findByEmail).mockResolvedValue({ ...user, active: false });
    expect(await authenticate.execute(user.email, 'correct')).toBeNull();
  });
  it('does not replace an existing account during bootstrap', async () => {
    const { store, passwords } = fixtures();
    await expect(
      new CreateInitialUser(store, passwords).execute(
        user.email,
        'synthetic-password-long',
      ),
    ).rejects.toThrow('already exists');
    expect(store.create).not.toHaveBeenCalled();
  });
  it('hashes a valid initial password before persistence', async () => {
    const { store, passwords } = fixtures();
    vi.mocked(store.findByEmail).mockResolvedValue(null);
    await new CreateInitialUser(store, passwords).execute(
      ' TEST@EXAMPLE.INVALID ',
      'synthetic-password-long',
    );
    expect(store.create).toHaveBeenCalledWith(user.email, 'encoded');
  });
  it('rejects short initial passwords', async () => {
    const { store, passwords } = fixtures();
    await expect(
      new CreateInitialUser(store, passwords).execute(user.email, 'short'),
    ).rejects.toThrow('La contraseña debe tener entre 15 y 128 caracteres.');
    expect(store.create).not.toHaveBeenCalled();
  });
  it.each([0, 14, 129])(
    'rejects invalid length %i before accessing persistence',
    async (length) => {
      const { store, passwords } = fixtures();
      await expect(
        new CreateInitialUser(store, passwords).execute(
          user.email,
          'x'.repeat(length),
        ),
      ).rejects.toThrow('La contraseña debe tener entre 15 y 128 caracteres.');
      expect(store.findByEmail).not.toHaveBeenCalled();
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(store.create).not.toHaveBeenCalled();
    },
  );

  it.each([15, 128])('accepts the valid boundary length %i', async (length) => {
    const { store, passwords } = fixtures();
    vi.mocked(store.findByEmail).mockResolvedValue(null);
    await new CreateInitialUser(store, passwords).execute(
      user.email,
      'x'.repeat(length),
    );
    expect(store.create).toHaveBeenCalledWith(user.email, 'encoded');
  });

  it('uses Argon2id and verifies real hashes', async () => {
    const hasher = new ArgonPasswordHasher();
    const hash = await hasher.hash('synthetic-password-long');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await hasher.verify(hash, 'synthetic-password-long')).toBe(true);
    expect(await hasher.verify(hash, 'incorrect')).toBe(false);
  });
});

describe('Configuration safety', () => {
  const environment = {
    DATABASE_URL: 'postgresql://synthetic:synthetic@database/nexo',
    SESSION_SECRET: 'synthetic-secret-at-least-32-characters',
    APP_ORIGIN: 'http://nexoscape.localhost',
  };
  it('rejects missing secrets without exposing configuration values', () => {
    expect(() =>
      readEnvironment({ ...environment, SESSION_SECRET: 'PRIVATE' }),
    ).toThrow('SESSION_SECRET');
    expect(() =>
      readEnvironment({ ...environment, SESSION_SECRET: 'PRIVATE' }),
    ).not.toThrow('PRIVATE');
  });
  it('requires HTTPS in production', () => {
    expect(() =>
      readEnvironment({ ...environment, NODE_ENV: 'production' }),
    ).toThrow('HTTPS');
  });
  it('rejects origins with paths', () => {
    expect(() =>
      readEnvironment({
        ...environment,
        APP_ORIGIN: 'http://nexoscape.localhost/path',
      }),
    ).toThrow('origin');
  });
});

describe('Safe exception boundary', () => {
  it('does not serialize or log unexpected exception details', async () => {
    const { SafeExceptionFilter } =
      await import('../../src/safe-exception.filter.js');
    const { Logger } = await import('@nestjs/common');
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    };
    try {
      new SafeExceptionFilter().catch(
        new Error('synthetic-private-query-parameters'),
        host as import('@nestjs/common').ArgumentsHost,
      );
      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        statusCode: 500,
        message: 'internal_error',
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-private');
    } finally {
      log.mockRestore();
    }
  });
});

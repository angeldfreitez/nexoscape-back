import { argon2id, hash, verify } from 'argon2';
import type { PasswordHasher } from '../../application/ports/password-hasher.js';

export class ArgonPasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  verify(encoded: string, password: string): Promise<boolean> {
    return verify(encoded, password);
  }
}

import { argon2id, hash, verify } from 'argon2';
import type { PasswordHasher } from '../../application/ports/password-hasher.js';

const NFC_VERSION = 'nfc-v1:';

export class ArgonPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const encoded = await hash(password.normalize('NFC'), {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    return NFC_VERSION + encoded;
  }

  verify(encoded: string, password: string): Promise<boolean> {
    if (encoded.startsWith(NFC_VERSION)) {
      return verify(
        encoded.slice(NFC_VERSION.length),
        password.normalize('NFC'),
      );
    }
    // Existing stored hashes still match the exact original input.
    return verify(encoded, password);
  }
}

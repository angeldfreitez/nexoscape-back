import { createHash } from 'node:crypto';
import type { PasswordBlocklist } from '../../application/new-password-policy.js';
import { COMMON_PASSWORD_DIGESTS } from './common-password-digests.js';

const digests = new Set(COMMON_PASSWORD_DIGESTS);

export class LocalPasswordBlocklist implements PasswordBlocklist {
  matches(password: string): boolean {
    const digest = createHash('sha256').update(password).digest('hex');
    return digests.has(digest);
  }
}

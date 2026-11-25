import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { PasswordHasher } from '../../application/ports/password-hasher.js';
import { UserEntity } from './user.entity.js';

// Identity owns reads and inserts for its accounts. The orchestrator supplies
// the current PostgreSQL transaction so acceptance can commit atomically.
export class InvitedAccounts {
  constructor(private readonly manager: EntityManager) {}

  find(email: string): Promise<{ id: string } | null> {
    return this.manager.getRepository(UserEntity).findOne({
      select: { id: true },
      where: { email },
    });
  }

  async verifyPassword(
    id: string,
    password: string,
    hasher: PasswordHasher,
  ): Promise<boolean> {
    const user = await this.manager
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .select(['user.id', 'user.active'])
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
    return user?.active === true && hasher.verify(user.passwordHash, password);
  }

  async create(email: string, passwordHash: string): Promise<string | null> {
    const rows: { id: string }[] = await this.manager.query(
      `INSERT INTO identity_users (id, email, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [randomUUID(), email, passwordHash],
    );
    return rows[0]?.id ?? null;
  }
}

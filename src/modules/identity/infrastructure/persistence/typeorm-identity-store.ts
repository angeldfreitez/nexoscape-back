import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import type { IdentityStore } from '../../application/ports/identity-store.js';
import type { IdentityUser } from '../../domain/user.js';
import { UserEntity } from './user.entity.js';

export class TypeormIdentityStore implements IdentityStore {
  constructor(private readonly repository: Repository<UserEntity>) {}

  async findByEmail(email: string): Promise<IdentityUser | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  async findById(id: string): Promise<IdentityUser | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
  }

  async create(email: string, passwordHash: string): Promise<void> {
    await this.repository.insert({ id: randomUUID(), email, passwordHash });
  }
}

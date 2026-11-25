import { Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import {
  IDENTITY_STORE,
  type IdentityStore,
} from './application/ports/identity-store.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from './application/ports/password-hasher.js';
import { NewPasswordPolicy } from './application/new-password-policy.js';
import { LocalPasswordBlocklist } from './infrastructure/security/local-password-blocklist.js';
import { Authenticate } from './application/use-cases/authenticate.js';
import { UserEntity } from './infrastructure/persistence/user.entity.js';
import { TypeormIdentityStore } from './infrastructure/persistence/typeorm-identity-store.js';
import { ArgonPasswordHasher } from './infrastructure/security/argon-password-hasher.js';
import { AuthController } from './http/auth.controller.js';
import { SESSION_ACCESS } from './application/ports/session-access.js';
import { TypeormSessionAccess } from './infrastructure/sessions/typeorm-session-access.js';
import { SessionGuard } from './http/session.guard.js';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  controllers: [AuthController],
  exports: [SessionGuard, PASSWORD_HASHER, NewPasswordPolicy],
  providers: [
    SessionGuard,
    {
      provide: SESSION_ACCESS,
      inject: [DataSource],
      useFactory: (database: DataSource) =>
        new TypeormSessionAccess(database.manager),
    },
    {
      provide: NewPasswordPolicy,
      useFactory: () => new NewPasswordPolicy(new LocalPasswordBlocklist()),
    },
    { provide: PASSWORD_HASHER, useClass: ArgonPasswordHasher },
    {
      provide: IDENTITY_STORE,
      inject: [getRepositoryToken(UserEntity)],
      useFactory: (repository: Repository<UserEntity>) =>
        new TypeormIdentityStore(repository),
    },
    {
      provide: Authenticate,
      inject: [IDENTITY_STORE, PASSWORD_HASHER],
      useFactory: async (users: IdentityStore, passwords: PasswordHasher) =>
        new Authenticate(
          users,
          passwords,
          await passwords.hash(randomBytes(32).toString('hex')),
        ),
    },
  ],
})
export class IdentityModule {}

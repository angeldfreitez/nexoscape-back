import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserEntity } from '../modules/identity/infrastructure/persistence/user.entity.js';
import { Identity1794355200000 } from './migrations/1794355200000-identity.js';

import { CompanyEntity } from '../modules/companies/infrastructure/company.entity.js';
import { Companies1795478400000 } from './migrations/1795478400000-companies.js';

import { AdminInvitations1795564800000 } from './migrations/1795564800000-admin-invitations.js';

import { CompanyOperations1795651200000 } from './migrations/1795651200000-company-operations.js';

import { CompanyActivity1795737600000 } from './migrations/1795737600000-company-activity.js';

import { CompanySessionRevocation1795824000000 } from './migrations/1795824000000-company-session-revocation.js';

export function createDataSource(url: string): DataSource {
  return new DataSource({
    type: 'postgres',
    url,
    entities: [UserEntity, CompanyEntity],
    migrations: [
      Identity1794355200000,
      Companies1795478400000,
      AdminInvitations1795564800000,
      CompanyOperations1795651200000,
      CompanyActivity1795737600000,
      CompanySessionRevocation1795824000000,
    ],
    synchronize: false,
    migrationsRun: false,
    logging: false,
  });
}

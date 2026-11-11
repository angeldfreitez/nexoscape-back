import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserEntity } from '../modules/identity/infrastructure/persistence/user.entity.js';
import { Identity1794355200000 } from './migrations/1794355200000-identity.js';

export function createDataSource(url: string): DataSource {
  return new DataSource({
    type: 'postgres',
    url,
    entities: [UserEntity],
    migrations: [Identity1794355200000],
    synchronize: false,
    migrationsRun: false,
    logging: false,
  });
}

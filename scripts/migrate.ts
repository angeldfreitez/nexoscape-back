import { readEnvironment } from '../src/config/environment.js';
import { createDataSource } from '../src/database/data-source.js';

const environment = readEnvironment(process.env);
const database = createDataSource(environment.DATABASE_URL);
try {
  await database.initialize();
  const migrations = await database.runMigrations({ transaction: 'all' });
  console.log(`Applied migrations: ${migrations.length}`);
} finally {
  if (database.isInitialized) await database.destroy();
}

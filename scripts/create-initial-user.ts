import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { readEnvironment } from '../src/config/environment.js';
import { createDataSource } from '../src/database/data-source.js';
import { NewPasswordPolicy } from '../src/modules/identity/application/new-password-policy.js';
import { LocalPasswordBlocklist } from '../src/modules/identity/infrastructure/security/local-password-blocklist.js';
import { UserEntity } from '../src/modules/identity/infrastructure/persistence/user.entity.js';
import { TypeormIdentityStore } from '../src/modules/identity/infrastructure/persistence/typeorm-identity-store.js';
import { ArgonPasswordHasher } from '../src/modules/identity/infrastructure/security/argon-password-hasher.js';
import {
  CreateInitialUser,
  InitialPasswordLengthError,
  InitialPasswordBlockedError,
  validateInitialPassword,
} from '../src/modules/identity/application/use-cases/create-initial-user.js';

if (!process.stdin.isTTY) {
  throw new Error(
    'Run interactively; credentials must not be passed as arguments',
  );
}
const environment = readEnvironment(process.env);
const database = createDataSource(environment.DATABASE_URL);
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
const prompt = createInterface({
  input: process.stdin,
  output,
  terminal: true,
});
try {
  const email = z
    .email()
    .max(254)
    .parse((await prompt.question('Email: ')).trim().toLowerCase());
  process.stdout.write('Password (15–128 characters, hidden): ');
  muted = true;
  const password = await prompt.question('');
  muted = false;
  process.stdout.write('\n');
  const policy = new NewPasswordPolicy(new LocalPasswordBlocklist());
  validateInitialPassword(policy, password, email);
  await database.initialize();
  const create = new CreateInitialUser(
    new TypeormIdentityStore(database.getRepository(UserEntity)),
    new ArgonPasswordHasher(),
    policy,
  );
  await create.execute(email, password);
  console.log('User created. No company or platform role was assigned.');
} catch (error) {
  if (
    error instanceof InitialPasswordLengthError ||
    error instanceof InitialPasswordBlockedError
  ) {
    console.error(`No se creó el usuario. ${error.message}`);
  } else {
    console.error(
      'User was not created. Check input, duplicates and database availability.',
    );
  }
  process.exitCode = 1;
} finally {
  prompt.close();
  if (database.isInitialized) await database.destroy();
}

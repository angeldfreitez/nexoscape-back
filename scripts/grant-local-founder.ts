import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { readEnvironment } from '../src/config/environment.js';
import { createDataSource } from '../src/database/data-source.js';
import { UserEntity } from '../src/modules/identity/infrastructure/persistence/user.entity.js';

async function grantLocalFounder(): Promise<void> {
  if (!process.stdin.isTTY || process.env.NODE_ENV !== 'development') {
    throw new Error('Ejecuta el comando de forma interactiva en desarrollo.');
  }

  const environment = readEnvironment(process.env);
  const databaseUrl = new URL(environment.DATABASE_URL);
  const appUrl = new URL(environment.APP_ORIGIN);
  const localHosts = ['localhost', '127.0.0.1', '[::1]'];
  if (
    ![...localHosts, 'database'].includes(databaseUrl.hostname) ||
    databaseUrl.pathname !== '/nexo' ||
    databaseUrl.search ||
    ![...localHosts, 'nexoscape.localhost'].includes(appUrl.hostname)
  ) {
    throw new Error('El comando solo admite el entorno local de NexoScape.');
  }

  const database = createDataSource(environment.DATABASE_URL);
  let hideInput = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!hideInput) process.stdout.write(chunk);
      callback();
    },
  });
  const prompt = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  try {
    process.stdout.write('Correo de la cuenta local (oculto): ');
    hideInput = true;
    const enteredEmail = await prompt.question('');
    hideInput = false;
    process.stdout.write('\n');
    const email = z
      .email()
      .max(254)
      .safeParse(enteredEmail.trim().toLowerCase());
    if (!email.success) {
      console.error('Correo inválido. No se modificó ninguna cuenta.');
      process.exitCode = 1;
      return;
    }

    const confirmation = await prompt.question(
      'Escribe FUNDADOR para confirmar el permiso de esta cuenta: ',
    );
    if (confirmation !== 'FUNDADOR') {
      console.log('Operación cancelada.');
      return;
    }

    await database.initialize();
    const result = await database
      .getRepository(UserEntity)
      .update({ email: email.data, active: true }, { platformFounder: true });
    if (result.affected !== 1) {
      console.error('No se encontró una cuenta activa con ese correo.');
      process.exitCode = 1;
      return;
    }
    console.log('Permiso de fundador asignado a la cuenta local.');
  } finally {
    prompt.close();
    if (database.isInitialized) await database.destroy();
  }
}

try {
  await grantLocalFounder();
} catch {
  console.error(
    'No se pudo completar la asignación. Revisa el entorno local y la migración.',
  );
  process.exitCode = 1;
}

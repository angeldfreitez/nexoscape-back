import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url().refine((value) => value.startsWith('postgresql://')),
  SESSION_SECRET: z.string().min(32),
  APP_ORIGIN: z.url(),
});

export type Environment = z.infer<typeof schema>;

export function readEnvironment(input: NodeJS.ProcessEnv): Environment {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Never include configuration values (credentials) in error output.
    const fields = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Invalid configuration fields: ${fields.join(', ')}`);
  }
  const environment = result.data;
  const origin = new URL(environment.APP_ORIGIN);
  if (origin.origin !== environment.APP_ORIGIN) {
    throw new Error(
      'APP_ORIGIN must be an origin without path or trailing slash',
    );
  }
  if (environment.NODE_ENV === 'production' && origin.protocol !== 'https:') {
    throw new Error('Production requires an HTTPS origin');
  }
  return environment;
}

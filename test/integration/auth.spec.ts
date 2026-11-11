import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type pg from 'pg';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { readEnvironment } from '../../src/config/environment.js';
import { createDataSource } from '../../src/database/data-source.js';
import { ArgonPasswordHasher } from '../../src/modules/identity/infrastructure/security/argon-password-hasher.js';

// Refuse to run against the development database, let alone a real environment.
const url = process.env.DATABASE_URL;
if (
  !url ||
  new URL(url).pathname !== '/nexo_auth_test' ||
  !['database', 'localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
  process.env.NODE_ENV !== 'test'
) {
  throw new Error(
    'Integration tests require NODE_ENV=test and database nexo_auth_test',
  );
}
const origin = 'http://nexoscape.localhost';
const email = 'auth-test@example.invalid';
const password = 'synthetic-test-password-123';
let app: INestApplication;
let sessions: pg.Pool;
let database: DataSource;
let server: Parameters<typeof request>[0];

beforeAll(async () => {
  database = await createDataSource(url).initialize();
  await database.runMigrations({ transaction: 'all' });
  await database.query('TRUNCATE identity_sessions, identity_users');
  await database.query(
    'INSERT INTO identity_users (id,email,password_hash) VALUES ($1,$2,$3)',
    [randomUUID(), email, await new ArgonPasswordHasher().hash(password)],
  );
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  sessions = configureApp(app, readEnvironment(process.env));
  await app.init();
  server = app.getHttpServer();
});

afterAll(async () => {
  if (app) await app.close();
  if (sessions) await sessions.end();
  if (database?.isInitialized) await database.destroy();
});

let testIp = 1;
beforeEach(() => {
  testIp++;
});

async function anonymous() {
  const agent = request
    .agent(server)
    .set('X-Forwarded-For', `192.0.2.${testIp}`);
  const response = await agent.get('/api/auth/csrf').expect(200);
  return {
    agent,
    token: response.body.token as string,
    cookie: response.headers['set-cookie'] as unknown as string[],
  };
}
async function signedIn() {
  const client = await anonymous();
  const response = await client.agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('x-csrf-token', client.token)
    .send({ email, password })
    .expect(200);
  return { ...client, token: response.body.token as string, login: response };
}

describe('Real HTTP + PostgreSQL authentication', () => {
  it('migrates without schema synchronization and reports database health', async () => {
    expect(await database.runMigrations()).toHaveLength(0);
    await request(server).get('/api/health').expect(200, { status: 'ok' });
  });
  it('marks the session cookie Secure behind an HTTPS production proxy', async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const secureApp = module.createNestApplication();
    const securePool = configureApp(secureApp, {
      ...readEnvironment(process.env),
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://nexoscape.example.invalid',
    });
    try {
      await secureApp.init();
      const response = await request(secureApp.getHttpServer())
        .get('/api/auth/csrf')
        .set('X-Forwarded-Proto', 'https')
        .expect(200);
      const cookie = response.headers['set-cookie'] as unknown as string[];
      expect(cookie[0]).toContain('Secure');
      expect(cookie[0]).toContain('HttpOnly');
    } finally {
      await secureApp.close();
      await securePool.end();
    }
  });

  it('requires a session for protected data', async () => {
    await request(server).get('/api/auth/me').expect(401);
  });
  it('rejects missing CSRF and a foreign origin', async () => {
    await request(server)
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ email, password })
      .expect(403);
    const client = await anonymous();
    await client.agent
      .post('/api/auth/login')
      .set('Origin', 'http://foreign.invalid')
      .set('x-csrf-token', client.token)
      .send({ email, password })
      .expect(403);
  });
  it('rejects a CSRF token from another session', async () => {
    const one = await anonymous();
    const two = await anonymous();
    await one.agent
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('x-csrf-token', two.token)
      .send({ email, password })
      .expect(403);
  });
  it('rejects malformed input without internal data', async () => {
    const client = await anonymous();
    await client.agent
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('x-csrf-token', client.token)
      .send({ email: 'invalid', password, unexpected: true })
      .expect(400);
  });
  it('returns the same response for unknown and incorrect accounts', async () => {
    const client = await anonymous();
    const wrong = await client.agent
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('x-csrf-token', client.token)
      .send({ email, password: 'wrong' })
      .expect(401);
    const unknown = await client.agent
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('x-csrf-token', client.token)
      .send({ email: 'unknown@example.invalid', password })
      .expect(401);
    expect(unknown.body).toEqual(wrong.body);
  });
  it('logs in, rotates the session, persists it and never returns a hash', async () => {
    const client = await signedIn();
    expect(client.login.body.user.email).toBe(email);
    expect(JSON.stringify(client.login.body)).not.toContain('password');
    const cookies = client.login.headers['set-cookie'] as unknown as string[];
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Lax');
    expect(cookies[0]).toContain('Path=/api');
    expect(cookies[0]?.split(';')[0]).not.toBe(client.cookie[0]?.split(';')[0]);
    await client.agent.get('/api/auth/me').expect(200);
    await request(server)
      .get('/api/auth/me')
      .set('Cookie', client.cookie)
      .expect(401);
    const rows = await database.query(
      "SELECT sess FROM identity_sessions WHERE sess::jsonb ? 'userId'",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(password);
    expect(client.login.headers['cache-control']).toBe('no-store');
  });
  it('rejects expired sessions even if their cookie is replayed', async () => {
    const client = await signedIn();
    await database.query(
      `UPDATE identity_sessions SET sess = jsonb_set(sess::jsonb, '{authenticatedUntil}', '1'::jsonb)::json WHERE sess::jsonb ? 'userId'`,
    );
    await client.agent.get('/api/auth/me').expect(401);
  });
  it('rejects disabled users with a previously valid session', async () => {
    const client = await signedIn();
    await database.query(
      'UPDATE identity_users SET active=false WHERE email=$1',
      [email],
    );
    await client.agent.get('/api/auth/me').expect(401);
    await database.query(
      'UPDATE identity_users SET active=true WHERE email=$1',
      [email],
    );
  });
  it('invalidates logout server-side, including replay of the old cookie', async () => {
    const client = await signedIn();
    const cookie = client.login.headers['set-cookie'] as unknown as string[];
    await client.agent
      .post('/api/auth/logout')
      .set('Origin', origin)
      .set('x-csrf-token', client.token)
      .expect(204);
    await request(server).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });
  it('limits repeated login attempts', async () => {
    const client = await anonymous();
    let limited = false;
    for (let index = 0; index < 6; index++) {
      const response = await client.agent
        .post('/api/auth/login')
        .set('Origin', origin)
        .set('x-csrf-token', client.token)
        .send({ email, password: 'wrong' });
      if (response.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});

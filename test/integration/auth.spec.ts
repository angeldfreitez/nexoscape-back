import { hash as legacyHash } from 'argon2';
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
import {
  INVITATION_MAILER,
  type InvitationMailer,
} from '../../src/modules/companies/application/admin-invitations.js';
import { localInvitationMailer } from '../../src/modules/companies/infrastructure/smtp-invitation-mailer.js';

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
const useMailpit = process.env.NEXO_TEST_MAILPIT === 'true';
const origin = 'http://nexoscape.localhost';
const email = 'auth-test@example.invalid';
const founderEmail = 'founder-test@example.invalid';
const password = 'synthetic-test-password-123';
let app: INestApplication;
let sessions: pg.Pool;
let database: DataSource;
let server: Parameters<typeof request>[0];
const captured = new Map<string, string>();
let simulateMailFault = false;

beforeAll(async () => {
  database = await createDataSource(url).initialize();
  await database.runMigrations({ transaction: 'all' });
  await database.query(`TRUNCATE identity_sessions, identity_users, companies,
      company_admin_invitations, company_memberships, company_events`);
  await database.query(
    `INSERT INTO identity_users (id,email,password_hash,platform_founder)
     VALUES ($1,$2,$3,false), ($4,$5,$3,true)`,
    [
      randomUUID(),
      email,
      await legacyHash(password),
      randomUUID(),
      founderEmail,
    ],
  );
  const mailpit = localInvitationMailer({
    ...readEnvironment(process.env),
    NODE_ENV: 'development',
    NEXO_LOCAL_INVITATIONS: 'true',
  });
  const mailer: InvitationMailer = {
    enabled: true,
    async send(invitation, token) {
      if (simulateMailFault) throw new Error('Synthetic SMTP failure');
      if (useMailpit) {
        await mailpit.send(invitation, token);
      } else {
        captured.set(invitation.email, token);
      }
    },
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(INVITATION_MAILER)
    .useValue(mailer)
    .compile();
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
async function signedIn(accountEmail = email, accountPassword = password) {
  const client = await anonymous();
  const response = await client.agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('x-csrf-token', client.token)
    .send({ email: accountEmail, password: accountPassword })
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

describe('Founder company registry', () => {
  const endpoint = '/api/companies';

  it('requires an authenticated session for reading and writing', async () => {
    await request(server).get(endpoint).expect(401);
    const client = await anonymous();
    await client.agent
      .post(endpoint)
      .set('Origin', origin)
      .set('x-csrf-token', client.token)
      .send({ name: 'Demo', initialAdminEmail: 'admin@example.invalid' })
      .expect(401);
  });

  it('denies both operations to an ordinary authenticated account', async () => {
    const client = await signedIn();
    expect(client.login.body.user.canManageCompanies).toBe(false);
    await client.agent.get(endpoint).expect(403);
    await client.agent
      .post(endpoint)
      .set('Origin', origin)
      .set('x-csrf-token', client.token)
      .send({ name: 'Demo', initialAdminEmail: 'admin@example.invalid' })
      .expect(403);
  });

  it('validates the founder request, origin and CSRF', async () => {
    const client = await signedIn(founderEmail);
    const input = { name: 'Demo', initialAdminEmail: 'admin@example.invalid' };
    await client.agent
      .post(endpoint)
      .set('Origin', origin)
      .send(input)
      .expect(403);
    await client.agent
      .post(endpoint)
      .set('Origin', 'http://foreign.invalid')
      .set('x-csrf-token', client.token)
      .send(input)
      .expect(403);
    for (const invalid of [
      { ...input, name: '  ' },
      { ...input, name: 'x'.repeat(121) },
      { ...input, initialAdminEmail: 'bad-email' },
      { ...input, initialAdminStatus: 'active' },
    ]) {
      await client.agent
        .post(endpoint)
        .set('Origin', origin)
        .set('x-csrf-token', client.token)
        .send(invalid)
        .expect(400);
    }
  });

  it('persists and lists a normalized pending company without creating an account', async () => {
    const client = await signedIn(founderEmail);
    expect(client.login.body.user.canManageCompanies).toBe(true);
    await client.agent.get(endpoint).expect(200, { companies: [] });

    const response = await client.agent
      .post(endpoint)
      .set('Origin', origin)
      .set('x-csrf-token', client.token)
      .send({
        name: ' Empresa de prueba ',
        initialAdminEmail: ' Admin@Example.Invalid ',
      })
      .expect(201);
    const company = {
      id: response.body.company.id as string,
      name: 'Empresa de prueba',
      initialAdminEmail: 'admin@example.invalid',
      initialAdminStatus: 'pending',
      linkedUsers: 0,
      status: 'pending_access',
      invitedAdminEmail: null,
    };
    expect(company.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body).toEqual({ company });
    await (
      await signedIn(founderEmail)
    ).agent
      .get(endpoint)
      .expect(200, { companies: [company] });
    expect(
      await database.query('SELECT id FROM identity_users WHERE email=$1', [
        company.initialAdminEmail,
      ]),
    ).toEqual([]);
  });

  it('checks founder permission again on the existing session', async () => {
    const client = await signedIn(founderEmail);
    await client.agent.get(endpoint).expect(200);
    await database.query(
      'UPDATE identity_users SET platform_founder=false WHERE email=$1',
      [founderEmail],
    );
    try {
      await client.agent.get(endpoint).expect(403);
      const me = await client.agent.get('/api/auth/me').expect(200);
      expect(me.body.user.canManageCompanies).toBe(false);
    } finally {
      await database.query(
        'UPDATE identity_users SET platform_founder=true WHERE email=$1',
        [founderEmail],
      );
    }
  });
});

async function receivedToken(recipient: string): Promise<string> {
  if (!useMailpit) {
    const value = captured.get(recipient);
    if (!value) throw new Error('Synthetic invitation not captured');
    return value;
  }
  const inbox = await fetch('http://mailpit:8025/api/v1/messages');
  const data = (await inbox.json()) as {
    messages: { ID: string; To: { Address: string }[] }[];
  };
  const message = data.messages.find((item) =>
    item.To.some((address) => address.Address === recipient),
  );
  if (!message) throw new Error('Mailpit did not capture the invitation');
  const receipt = await fetch(
    `http://mailpit:8025/api/v1/message/${message.ID}`,
  );
  const body = (await receipt.json()) as { Text: string };
  const link = body.Text.match(
    /http:\/\/nexoscape\.localhost\/aceptar-invitacion#([A-Za-z0-9_-]{43})/,
  );
  if (!link?.[1]) throw new Error('Mailpit invitation link not found');
  return link[1];
}

describe('Local administrator invitation workflow', () => {
  const invitePath = (id: string) => `/api/companies/${id}/admin-invitation`;
  const previewPath = '/api/company-invitations/preview';
  const acceptPath = '/api/company-invitations/accept';

  async function newCompany(admin: string) {
    const founder = await signedIn(founderEmail);
    const response = await founder.agent
      .post('/api/companies')
      .set('Origin', origin)
      .set('x-csrf-token', founder.token)
      .send({ name: 'Empresa sintética', initialAdminEmail: admin })
      .expect(201);
    return {
      founder,
      companyId: response.body.company.id as string,
    };
  }

  function post(client: Awaited<ReturnType<typeof anonymous>>, path: string) {
    return client.agent
      .post(path)
      .set('Origin', origin)
      .set('x-csrf-token', client.token);
  }

  it('sends only as founder, captures the email and assigns an existing account once', async () => {
    const { founder, companyId } = await newCompany(email);
    const invited = await signedIn();
    await post(invited, invitePath(companyId)).expect(403);
    await post(founder, invitePath(companyId)).expect(201);
    await post(founder, invitePath(companyId)).expect(409);
    const token = await receivedToken(email);
    const rows = (await database.query(
      'SELECT token_hash, accepted_at FROM company_admin_invitations WHERE company_id = $1',
      [companyId],
    )) as { token_hash: string; accepted_at: Date | null }[];
    expect(rows[0]?.token_hash).toHaveLength(64);
    expect(rows[0]?.token_hash).not.toBe(token);
    expect(rows[0]?.accepted_at).toBeNull();

    const anonymousClient = await anonymous();
    const preview = await post(anonymousClient, previewPath)
      .send({ token })
      .expect(200);
    expect(preview.body).toMatchObject({
      existingAccount: true,
      hasCompanyHistory: false,
    });
    await post(anonymousClient, previewPath).send({ token }).expect(200);
    await post(anonymousClient, acceptPath).send({ token }).expect(400);
    await post(founder, acceptPath).send({ token, password }).expect(403);
    await post(invited, acceptPath).send({ token }).expect(400);
    const incorrect = await post(invited, acceptPath)
      .send({ token, password: 'contraseña incorrecta', mode: 'existing' })
      .expect(401);
    expect(incorrect.body.message).toBe('invalid_credentials');
    await post(invited, acceptPath).send({ token, password }).expect(200);
    await post(invited, acceptPath).send({ token }).expect(410);
    await founder.agent.get('/api/my-companies').expect(200, { companies: [] });
    await invited.agent.get('/api/my-companies').expect(200, {
      companies: [
        {
          id: companyId,
          name: 'Empresa sintética',
          role: 'admin',
          status: 'active',
          accessVersion: '0',
        },
      ],
    });
    const registry = await founder.agent.get('/api/companies').expect(200);
    expect(registry.body.companies).toContainEqual(
      expect.objectContaining({
        id: companyId,
        initialAdminStatus: 'assigned',
        linkedUsers: 1,
      }),
    );
  });

  it('creates a missing account atomically and accepts only one concurrent request', async () => {
    const recipient = 'new-admin@example.invalid';
    const { founder, companyId } = await newCompany(recipient);
    await post(founder, invitePath(companyId)).expect(201);
    const token = await receivedToken(recipient);
    const first = await anonymous();
    const invalid = await post(first, acceptPath)
      .send({ token, password: '123456789012345' })
      .expect(400);
    expect(invalid.body.message).toBe('password_blocked');
    await post(first, previewPath).send({ token }).expect(200);
    const newPassword = 'cafe\u0301 de casa tranquilo';
    const second = await anonymous();
    const results = await Promise.all([
      post(first, acceptPath).send({ token, password: newPassword }),
      post(second, acceptPath).send({ token, password: newPassword }),
    ]);
    expect(results.map((value) => value.status).sort()).toEqual([200, 410]);
    const admin = await signedIn(recipient, newPassword.normalize('NFC'));
    await admin.agent.get('/api/my-companies').expect(200, {
      companies: [
        {
          id: companyId,
          name: 'Empresa sintética',
          role: 'admin',
          status: 'active',
          accessVersion: '0',
        },
      ],
    });
    await admin.agent.get('/api/companies').expect(403);
  });

  it('does not grant access after expiry and rotating a link invalidates the old one', async () => {
    const recipient = 'expired-admin@example.invalid';
    const { founder, companyId } = await newCompany(recipient);
    await post(founder, invitePath(companyId)).expect(201);
    const token = await receivedToken(recipient);
    await database.query(
      `UPDATE company_admin_invitations SET expires_at = '2000-01-01'
       WHERE company_id = $1`,
      [companyId],
    );
    const client = await anonymous();
    await post(client, acceptPath).send({ token, password }).expect(410);
    await post(founder, invitePath(companyId)).expect(201);
    await post(client, previewPath).send({ token }).expect(410);
  });

  it('rolls back the invitation if SMTP fails and supports retry', async () => {
    const { founder, companyId } = await newCompany(
      'retry-admin@example.invalid',
    );
    simulateMailFault = true;
    try {
      await post(founder, invitePath(companyId)).expect(503);
    } finally {
      simulateMailFault = false;
    }
    expect(
      await database.query(
        'SELECT company_id FROM company_admin_invitations WHERE company_id = $1',
        [companyId],
      ),
    ).toEqual([]);
    await post(founder, invitePath(companyId)).expect(201);
  });
  function setAvailability(
    client: Awaited<ReturnType<typeof anonymous>>,
    companyId: string,
    active: boolean,
  ) {
    return client.agent
      .patch(`/api/companies/${companyId}/status`)
      .set('Origin', origin)
      .set('x-csrf-token', client.token)
      .send({ active });
  }

  async function checkCompany(
    founder: Awaited<ReturnType<typeof signedIn>>,
    companyId: string,
    details: Record<string, unknown>,
  ) {
    const result = await founder.agent.get('/api/companies').expect(200);
    expect(result.body.companies).toContainEqual(
      expect.objectContaining({ id: companyId, ...details }),
    );
  }

  it('disables access without deleting memberships, revokes pending links and restores access only', async () => {
    const { founder, companyId } = await newCompany(email);
    const currentAdmin = await signedIn();
    const unaffected = await newCompany(email);
    await post(unaffected.founder, invitePath(unaffected.companyId)).expect(
      201,
    );
    await post(currentAdmin, acceptPath)
      .send({ token: await receivedToken(email), password })
      .expect(200);
    const recipient = 'suspended-target@example.invalid';
    const transferPath = `/api/companies/${companyId}/admin-transfer`;

    await post(founder, invitePath(companyId)).expect(201);
    const initial = await receivedToken(email);
    await post(currentAdmin, acceptPath)
      .send({ token: initial, password })
      .expect(200);
    await post(founder, transferPath).send({ email: recipient }).expect(201);
    const pending = await receivedToken(recipient);

    await setAvailability(currentAdmin, companyId, false).expect(403);
    await setAvailability(founder, companyId, false).expect(204);
    await currentAdmin.agent.get('/api/auth/me').expect(200);
    const hidden = await currentAdmin.agent
      .get('/api/my-companies')
      .expect(200);
    expect(hidden.body.companies).toContainEqual(
      expect.objectContaining({ id: companyId, status: 'disabled' }),
    );
    expect(hidden.body.companies).toContainEqual(
      expect.objectContaining({ id: unaffected.companyId }),
    );
    await checkCompany(founder, companyId, {
      status: 'disabled',
      initialAdminStatus: 'cancelled',
      linkedUsers: 1,
    });
    await post(founder, transferPath).send({ email: recipient }).expect(409);
    const receiver = await anonymous();
    await post(receiver, previewPath).send({ token: pending }).expect(410);

    await setAvailability(founder, companyId, true).expect(204);
    const restored = await currentAdmin.agent
      .get('/api/my-companies')
      .expect(200);
    expect(restored.body.companies).toContainEqual(
      expect.objectContaining({ id: companyId }),
    );
    await post(receiver, acceptPath)
      .send({ token: pending, password })
      .expect(410);
    await checkCompany(founder, companyId, {
      status: 'active',
      initialAdminStatus: 'cancelled',
    });

    await post(founder, invitePath(companyId)).expect(201);
    const renewed = await receivedToken(recipient);
    expect(renewed).not.toBe(pending);
    await post(receiver, previewPath).send({ token: renewed }).expect(200);
  });

  it('transfers only that company after acceptance, preserving the previous account and other memberships', async () => {
    const { founder, companyId } = await newCompany(email);
    const former = await signedIn();
    const unaffected = await newCompany(email);
    await post(unaffected.founder, invitePath(unaffected.companyId)).expect(
      201,
    );
    await post(former, acceptPath)
      .send({ token: await receivedToken(email), password })
      .expect(200);
    const replacement = 'replacement-admin@example.invalid';
    const path = `/api/companies/${companyId}/admin-transfer`;
    await post(founder, invitePath(companyId)).expect(201);
    await post(former, acceptPath)
      .send({ token: await receivedToken(email), password })
      .expect(200);
    const formerBefore = await former.agent
      .get('/api/my-companies')
      .expect(200);

    await post(former, path).send({ email: replacement }).expect(403);
    await post(founder, path).send({ email }).expect(409);
    await post(founder, path).send({ email: replacement }).expect(201);
    await checkCompany(founder, companyId, {
      status: 'active',
      initialAdminStatus: 'invited',
      initialAdminEmail: email,
      invitedAdminEmail: replacement,
      linkedUsers: 1,
    });
    await former.agent.get('/api/my-companies').expect(200, formerBefore.body);

    const token = await receivedToken(replacement);
    const anonymousClient = await anonymous();
    await post(anonymousClient, acceptPath)
      .send({ token, password })
      .expect(200);
    await former.agent.get('/api/auth/me').expect(200);
    const formerAfter = await former.agent.get('/api/my-companies').expect(200);
    expect(formerAfter.body.companies).toEqual(
      formerBefore.body.companies.filter(
        (company: { id: string }) => company.id !== companyId,
      ),
    );
    const next = await signedIn(replacement);
    const nextCompanies = await next.agent.get('/api/my-companies').expect(200);
    expect(nextCompanies.body.companies).toEqual([
      {
        id: companyId,
        name: 'Empresa sintética',
        role: 'admin',
        status: 'active',
        accessVersion: expect.stringMatching(/^[1-9][0-9]*$/),
      },
    ]);
    await checkCompany(founder, companyId, {
      status: 'active',
      initialAdminStatus: 'assigned',
      initialAdminEmail: replacement,
      invitedAdminEmail: null,
      linkedUsers: 1,
    });
    await post(anonymousClient, acceptPath)
      .send({ token, password })
      .expect(410);
  });

  it('replaces a pending recipient without granting the old link access', async () => {
    const original = 'original-recipient@example.invalid';
    const replacement = 'updated-recipient@example.invalid';
    const { founder, companyId } = await newCompany(original);
    await post(founder, invitePath(companyId)).expect(201);
    await post(founder, `/api/companies/${companyId}/admin-transfer`)
      .send({ email: replacement })
      .expect(201);
    const receiver = await anonymous();
    await post(receiver, acceptPath)
      .send({ token: await receivedToken(original), password })
      .expect(410);
    await post(receiver, previewPath)
      .send({ token: await receivedToken(replacement) })
      .expect(200);
  });
  it('returns founder-only details and keeps the accepted link recorded after disabling the company', async () => {
    const recipient = 'detail-admin@example.invalid';
    const { founder, companyId } = await newCompany(recipient);
    const detail = `/api/companies/${companyId}`;
    await request(server).get(detail).expect(401);
    const ordinary = await signedIn();
    await ordinary.agent.get(detail).expect(403);
    await founder.agent.get('/api/companies/not-a-uuid').expect(400);
    await founder.agent.get(`/api/companies/${randomUUID()}`).expect(404);

    await post(founder, invitePath(companyId)).expect(201);
    const receiver = await anonymous();
    await post(receiver, acceptPath)
      .send({ token: await receivedToken(recipient), password })
      .expect(200);
    await setAvailability(founder, companyId, false).expect(204);
    const stored = await founder.agent.get(detail).expect(200);
    expect(stored.body.company).toMatchObject({
      id: companyId,
      status: 'disabled',
      initialAdminStatus: 'assigned',
      initialAdminEmail: recipient,
      linkedUsers: 1,
    });
  });
  it('projects the four company states and records committed activity with the correct actor', async () => {
    const recipient = 'activity-admin@example.invalid';
    const { founder, companyId } = await newCompany(recipient);
    const activityPath = `/api/companies/${companyId}/activity`;
    await request(server).get(activityPath).expect(401);
    const ordinary = await signedIn();
    await ordinary.agent.get(activityPath).expect(403);
    await founder.agent
      .get(activityPath + '?before=9223372036854775808')
      .expect(400);

    await checkCompany(founder, companyId, { status: 'pending_access' });
    await post(founder, invitePath(companyId)).expect(201);
    await checkCompany(founder, companyId, { status: 'awaiting_acceptance' });
    const receiver = await anonymous();
    await post(receiver, acceptPath)
      .send({ token: await receivedToken(recipient), password })
      .expect(200);
    await checkCompany(founder, companyId, { status: 'active' });
    const transferPath = `/api/companies/${companyId}/admin-transfer`;
    await post(founder, transferPath)
      .send({ email: 'activity-next@example.invalid' })
      .expect(201);
    await checkCompany(founder, companyId, {
      status: 'active',
      initialAdminStatus: 'invited',
    });

    await setAvailability(founder, companyId, false).expect(204);
    await setAvailability(founder, companyId, false).expect(204);
    await checkCompany(founder, companyId, { status: 'disabled' });
    await setAvailability(founder, companyId, true).expect(204);
    await checkCompany(founder, companyId, { status: 'active' });

    const result = await founder.agent.get(activityPath).expect(200);
    const events = result.body.events as {
      kind: string;
      actorEmail: string;
      occurredAt: string;
      targetEmail: string | null;
    }[];
    expect(events.map((item) => [item.kind, item.actorEmail])).toEqual([
      ['company_reactivated', founderEmail],
      ['link_revoked', founderEmail],
      ['company_disabled', founderEmail],
      ['transfer_requested', founderEmail],
      ['admin_assigned', recipient],
      ['link_sent', founderEmail],
      ['company_created', founderEmail],
    ]);
    expect(events[1]?.targetEmail).toBe('activity-next@example.invalid');
    expect(
      events.every((item) => !Number.isNaN(Date.parse(item.occurredAt))),
    ).toBe(true);
    expect(result.body.nextCursor).toBeNull();
    expect(JSON.stringify(result.body)).not.toContain('token_hash');
  });

  it('pages only the selected company’s audit history without duplicates', async () => {
    const { founder, companyId } = await newCompany('archive@example.invalid');
    const other = await newCompany('other-audit@example.invalid');
    for (let step = 0; step < 31; step++) {
      await setAvailability(founder, companyId, step % 2 !== 0).expect(204);
    }
    const url = `/api/companies/${companyId}/activity`;
    const first = await founder.agent.get(url).expect(200);
    expect(first.body.events).toHaveLength(30);
    expect(typeof first.body.nextCursor).toBe('string');
    const second = await founder.agent
      .get(url + '?before=' + first.body.nextCursor)
      .expect(200);
    expect(second.body.events).toHaveLength(2);
    expect(second.body.events[1]?.kind).toBe('company_created');
    expect(second.body.nextCursor).toBeNull();
    const seen = [...first.body.events, ...second.body.events].map(
      (entry: { id: string }) => entry.id,
    );
    expect(new Set(seen).size).toBe(32);
    const separate = await founder.agent
      .get(`/api/companies/${other.companyId}/activity`)
      .expect(200);
    expect(separate.body.events).toHaveLength(1);
    expect(seen).not.toContain(separate.body.events[0].id);
  });
  it('keeps the session when another company is active and rejects the suspended workspace', async () => {
    const first = await newCompany(email);
    const second = await newCompany(email);
    const currentAdmin = await signedIn();
    for (const entry of [first, second]) {
      await post(entry.founder, invitePath(entry.companyId)).expect(201);
      await post(currentAdmin, acceptPath)
        .send({ token: await receivedToken(email), password })
        .expect(200);
    }
    const firstAccess = `/api/my-companies/${first.companyId}/access`;
    const secondAccess = `/api/my-companies/${second.companyId}/access`;
    await request(server)
      .get(firstAccess + '?version=0')
      .expect(401);
    await currentAdmin.agent.get(firstAccess + '?version=invalid').expect(400);
    await currentAdmin.agent.get(firstAccess + '?version=0').expect(204);
    await currentAdmin.agent.get(secondAccess + '?version=0').expect(204);

    await setAvailability(first.founder, first.companyId, false).expect(204);
    await currentAdmin.agent.get(firstAccess + '?version=0').expect(403);
    await currentAdmin.agent.get('/api/auth/me').expect(200);
    await currentAdmin.agent.get(secondAccess + '?version=0').expect(204);

    await setAvailability(first.founder, first.companyId, true).expect(204);
    await currentAdmin.agent.get(firstAccess + '?version=0').expect(403);
    const available = await currentAdmin.agent
      .get('/api/my-companies')
      .expect(200);
    const restored = available.body.companies.find(
      (item: { id: string }) => item.id === first.companyId,
    ) as { accessVersion: string };
    expect(restored.accessVersion).not.toBe('0');
    await currentAdmin.agent
      .get(firstAccess + '?version=' + restored.accessVersion)
      .expect(204);
    await first.founder.agent
      .get(firstAccess + '?version=' + restored.accessVersion)
      .expect(403);
  });
  it('revokes every session and rejects a new login when the only company is disabled', async () => {
    const recipient = 'only-disabled-company@example.invalid';
    const { founder, companyId } = await newCompany(recipient);
    await post(founder, invitePath(companyId)).expect(201);
    const receiver = await anonymous();
    await post(receiver, acceptPath)
      .send({ token: await receivedToken(recipient), password })
      .expect(200);
    const first = await signedIn(recipient);
    const second = await signedIn(recipient);

    await setAvailability(founder, companyId, false).expect(204);
    await first.agent.get('/api/auth/me').expect(401);
    await second.agent.get('/api/my-companies').expect(401);
    await founder.agent.get('/api/auth/me').expect(200);
    const retry = await anonymous();
    await post(retry, '/api/auth/login')
      .send({ email: recipient, password })
      .expect(401);

    await setAvailability(founder, companyId, true).expect(204);
    await first.agent.get('/api/auth/me').expect(401);
    await second.agent.get('/api/auth/me').expect(401);
    const fresh = await signedIn(recipient);
    await fresh.agent.get('/api/auth/me').expect(200);
  });
  it('uses the current password for a second company even when the first is disabled', async () => {
    const recipient = 'second-company@example.invalid';
    const first = await newCompany(recipient);
    const second = await newCompany(recipient);
    const receiver = await anonymous();
    await post(first.founder, invitePath(first.companyId)).expect(201);
    const firstToken = await receivedToken(recipient);
    const initial = await post(receiver, previewPath)
      .send({ token: firstToken })
      .expect(200);
    expect(initial.body).toMatchObject({
      existingAccount: false,
      hasCompanyHistory: false,
    });
    await post(receiver, acceptPath)
      .send({ token: firstToken, password, mode: 'new' })
      .expect(200);

    await setAvailability(first.founder, first.companyId, false).expect(204);
    await post(receiver, '/api/auth/login')
      .send({ email: recipient, password })
      .expect(401);
    await post(second.founder, invitePath(second.companyId)).expect(201);
    const token = await receivedToken(recipient);
    const preview = await post(receiver, previewPath)
      .send({ token })
      .expect(200);
    expect(preview.body).toMatchObject({
      existingAccount: true,
      hasCompanyHistory: true,
    });
    const stale = await post(receiver, acceptPath)
      .send({ token, password, mode: 'new' })
      .expect(409);
    expect(stale.body.message).toBe('account_already_exists');
    await post(receiver, acceptPath)
      .send({ token, password, mode: 'existing' })
      .expect(200);
    await post(receiver, acceptPath)
      .send({ token, password, mode: 'existing' })
      .expect(410);
    const member = await signedIn(recipient);
    const companies = await member.agent.get('/api/my-companies').expect(200);
    expect(companies.body.companies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.companyId, status: 'disabled' }),
        expect.objectContaining({ id: second.companyId, status: 'active' }),
      ]),
    );
  });

  it('serializes simultaneous suspensions before checking the last available company', async () => {
    const recipient = 'parallel-suspension@example.invalid';
    const first = await newCompany(recipient);
    const second = await newCompany(recipient);
    await post(first.founder, invitePath(first.companyId)).expect(201);
    const receiver = await anonymous();
    await post(receiver, acceptPath)
      .send({ token: await receivedToken(recipient), password })
      .expect(200);
    const member = await signedIn(recipient);
    await post(second.founder, invitePath(second.companyId)).expect(201);
    await post(member, acceptPath)
      .send({ token: await receivedToken(recipient), password })
      .expect(200);

    await Promise.all([
      setAvailability(first.founder, first.companyId, false).expect(204),
      setAvailability(second.founder, second.companyId, false).expect(204),
    ]);
    await member.agent.get('/api/auth/me').expect(401);
    await setAvailability(first.founder, first.companyId, true).expect(204);
    await member.agent.get('/api/auth/me').expect(401);
    const newSession = await signedIn(recipient);
    await newSession.agent.get('/api/auth/me').expect(200);
  });
});

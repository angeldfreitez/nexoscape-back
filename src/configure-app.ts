import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import helmet from 'helmet';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { SafeExceptionFilter } from './safe-exception.filter.js';
import type { Environment } from './config/environment.js';
import { csrfSynchronisedProtection } from './modules/identity/infrastructure/security/csrf.js';
import {
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
} from './modules/identity/infrastructure/sessions/session-types.js';

export function configureApp(
  app: INestApplication,
  environment: Environment,
): pg.Pool {
  const express = app as NestExpressApplication;
  // The backend is private; the only public ingress is the single Nginx hop.
  express.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new SafeExceptionFilter());
  app.use(helmet());
  app.use(((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  }) satisfies RequestHandler);
  const pool = new pg.Pool({ connectionString: environment.DATABASE_URL });
  const Store = connectPgSimple(session);
  app.use(
    session({
      name: SESSION_COOKIE,
      secret: environment.SESSION_SECRET,
      store: new Store({
        pool,
        tableName: 'identity_sessions',
        createTableIfMissing: false,
        disableTouch: true,
        errorLog: () => console.error('Session persistence failed'),
      }),
      saveUninitialized: false,
      resave: false,
      rolling: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: environment.NODE_ENV === 'production',
        path: '/api',
        maxAge: SESSION_LIFETIME_MS,
      },
    }),
  );
  app.use(((request, response, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.get('origin') !== environment.APP_ORIGIN) {
        response.status(403).json({ error: 'origin_rejected' });
        return;
      }
    }
    next();
  }) satisfies RequestHandler);
  app.use(csrfSynchronisedProtection);
  app.use(((error: unknown, _request, response, next) => {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'EBADCSRFTOKEN'
    ) {
      response.status(403).json({ error: 'csrf_rejected' });
      return;
    }
    next(error);
  }) satisfies ErrorRequestHandler);
  return pool;
}

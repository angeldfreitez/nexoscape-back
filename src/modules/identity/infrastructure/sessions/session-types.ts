import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    authenticatedUntil?: number;
  }
}

export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'nexo.sid';

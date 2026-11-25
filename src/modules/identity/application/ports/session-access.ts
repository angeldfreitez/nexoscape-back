export const SESSION_ACCESS = Symbol('SESSION_ACCESS');

export interface SessionAccess {
  // Null means the account currently cannot hold a platform session.
  version(userId: string): Promise<string | null>;
}

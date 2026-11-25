import { createHash, randomBytes } from 'node:crypto';
import type { PasswordHasher } from '../../identity/application/ports/password-hasher.js';
import type { NewPasswordPolicy } from '../../identity/application/new-password-policy.js';
import type { PublicUser } from '../../identity/domain/user.js';

import type {
  CompanyEventActor,
  NewCompanyEvent,
} from '../domain/company-event.js';

export const INVITATION_MAILER = Symbol('INVITATION_MAILER');
export const INVITATION_DATA = Symbol('INVITATION_DATA');
const LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface AdminInvitation {
  companyId: string;
  companyName: string;
  email: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  companyDisabled: boolean;
}

export interface InvitationTransaction {
  company(id: string): Promise<
    | {
        name: string;
        initialAdminEmail: string;
        disabled: boolean;
        hasAdmin: boolean;
      }
    | undefined
  >;
  setAvailability(companyId: string, active: boolean): Promise<string | null>;
  record(event: NewCompanyEvent): Promise<void>;
  current(companyId: string): Promise<AdminInvitation | undefined>;
  save(invitation: AdminInvitation, digest: string): Promise<void>;
  find(digest: string): Promise<AdminInvitation | undefined>;
  account(email: string): Promise<{ id: string } | null>;
  hasCompanyHistory(userId: string): Promise<boolean>;
  verifyAccountPassword(
    userId: string,
    password: string,
    hasher: PasswordHasher,
  ): Promise<boolean>;
  createAccount(email: string, passwordHash: string): Promise<string | null>;
  assign(companyId: string, userId: string, email: string): Promise<void>;
  consume(companyId: string): Promise<void>;
}

export interface InvitationData {
  read<T>(action: (db: InvitationTransaction) => Promise<T>): Promise<T>;
  forCompany<T>(
    companyId: string,
    action: (db: InvitationTransaction) => Promise<T>,
  ): Promise<T>;
  forToken<T>(
    digest: string,
    action: (db: InvitationTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface InvitationMailer {
  readonly enabled: boolean;
  send(invitation: AdminInvitation, token: string): Promise<void>;
}

type Problem =
  | 'invitation_disabled'
  | 'company_not_found'
  | 'company_disabled'
  | 'same_administrator'
  | 'invitation_already_sent'
  | 'administrator_already_assigned'
  | 'invitation_unavailable'
  | 'use_invited_account'
  | 'account_already_exists'
  | 'invalid_credentials'
  | 'password_required'
  | 'password_length'
  | 'password_blocked'
  | 'mail_unavailable';

export class InvitationProblem extends Error {
  constructor(readonly reason: Problem) {
    super(reason);
  }
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AdminInvitations {
  constructor(
    private readonly data: InvitationData,
    private readonly mailer: InvitationMailer,
    private readonly passwords: PasswordHasher,
    private readonly passwordPolicy: NewPasswordPolicy,
  ) {}

  async send(
    companyId: string,
    actor: CompanyEventActor,
    replacementEmail?: string,
  ): Promise<{ expiresAt: Date }> {
    this.ensureEnabled();
    return this.data.forCompany(companyId, async (db) => {
      const company = await db.company(companyId);
      if (!company) throw new InvitationProblem('company_not_found');
      if (company.disabled) throw new InvitationProblem('company_disabled');

      const current = await db.current(companyId);
      const email =
        replacementEmail ??
        (current && !current.acceptedAt
          ? current.email
          : company.initialAdminEmail);
      if (company.hasAdmin && email === company.initialAdminEmail) {
        throw new InvitationProblem(
          replacementEmail
            ? 'same_administrator'
            : 'administrator_already_assigned',
        );
      }

      const now = Date.now();
      if (
        current &&
        !current.acceptedAt &&
        !current.revokedAt &&
        current.expiresAt.getTime() > now &&
        current.email === email
      ) {
        throw new InvitationProblem('invitation_already_sent');
      }

      const token = randomBytes(32).toString('base64url');
      const invitation = {
        companyId,
        companyName: company.name,
        email,
        expiresAt: new Date(now + LIFETIME_MS),
        acceptedAt: null,
        revokedAt: null,
        companyDisabled: false,
      };
      await db.save(invitation, digest(token));
      // Bounded local SMTP: keep the company lock until Mailpit acknowledges.
      // An SMTP failure rolls back the invitation so the founder can try again.
      try {
        await this.mailer.send(invitation, token);
      } catch {
        throw new InvitationProblem('mail_unavailable');
      }
      if (
        current &&
        !current.acceptedAt &&
        !current.revokedAt &&
        current.email !== email &&
        current.expiresAt.getTime() > now
      ) {
        await db.record({
          companyId,
          kind: 'link_revoked',
          actor,
          targetEmail: current.email,
        });
      }
      await db.record({
        companyId,
        kind: company.hasAdmin ? 'transfer_requested' : 'link_sent',
        actor,
        targetEmail: email,
        ...(company.hasAdmin
          ? { previousEmail: company.initialAdminEmail }
          : {}),
      });
      return { expiresAt: invitation.expiresAt };
    });
  }

  async preview(token: string) {
    this.ensureEnabled();
    return this.data.read(async (db) => {
      const invitation = await this.available(db, digest(token));
      const account = await db.account(invitation.email);
      return {
        companyName: invitation.companyName,
        email: invitation.email,
        existingAccount: account !== null,
        hasCompanyHistory: account
          ? await db.hasCompanyHistory(account.id)
          : false,
        expiresAt: invitation.expiresAt,
      };
    });
  }

  async accept(
    token: string,
    user: PublicUser | null,
    password: string | undefined,
    mode: 'new' | 'existing' | undefined,
  ): Promise<{ companyId: string; email: string }> {
    this.ensureEnabled();
    const tokenDigest = digest(token);
    return this.data.forToken(tokenDigest, async (db) => {
      const invitation = await this.available(db, tokenDigest);
      const account = await db.account(invitation.email);
      let userId: string | null;
      if (user && user.id !== account?.id) {
        throw new InvitationProblem('use_invited_account');
      }
      if (account && mode === 'new') {
        throw new InvitationProblem('account_already_exists');
      }
      if (!password) throw new InvitationProblem('password_required');
      if (account) {
        if (
          !(await db.verifyAccountPassword(
            account.id,
            password,
            this.passwords,
          ))
        ) {
          throw new InvitationProblem('invalid_credentials');
        }
        userId = account.id;
      } else {
        if (mode === 'existing') {
          throw new InvitationProblem('invitation_unavailable');
        }
        const problem = this.passwordPolicy.check(password, invitation.email);
        if (problem === 'length')
          throw new InvitationProblem('password_length');
        if (problem === 'blocked')
          throw new InvitationProblem('password_blocked');
        userId = await db.createAccount(
          invitation.email,
          await this.passwords.hash(password),
        );
        if (!userId) throw new InvitationProblem('account_already_exists');
      }
      if (invitation.expiresAt.getTime() <= Date.now()) {
        throw new InvitationProblem('invitation_unavailable');
      }
      const company = await db.company(invitation.companyId);
      if (!company || company.disabled) {
        throw new InvitationProblem('invitation_unavailable');
      }
      await db.assign(invitation.companyId, userId, invitation.email);
      await db.consume(invitation.companyId);
      await db.record({
        companyId: invitation.companyId,
        kind: company.hasAdmin ? 'admin_transferred' : 'admin_assigned',
        actor: { id: userId, email: invitation.email },
        ...(company.hasAdmin
          ? { previousEmail: company.initialAdminEmail }
          : {}),
      });
      return { companyId: invitation.companyId, email: invitation.email };
    });
  }

  private async available(db: InvitationTransaction, tokenDigest: string) {
    const invitation = await db.find(tokenDigest);
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.companyDisabled ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw new InvitationProblem('invitation_unavailable');
    }
    return invitation;
  }

  private ensureEnabled(): void {
    if (!this.mailer.enabled)
      throw new InvitationProblem('invitation_disabled');
  }
}

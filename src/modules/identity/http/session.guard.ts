import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  IDENTITY_STORE,
  type IdentityStore,
} from '../application/ports/identity-store.js';
import {
  SESSION_ACCESS,
  type SessionAccess,
} from '../application/ports/session-access.js';
import { publicUser, type PublicUser } from '../domain/user.js';

export interface AuthenticatedRequest extends Request {
  identityUser: PublicUser;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(IDENTITY_STORE) private readonly users: IdentityStore,
    @Inject(SESSION_ACCESS) private readonly access: SessionAccess,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.resolve(request);
    if (!user) throw new UnauthorizedException('session_required');
    request.identityUser = user;
    return true;
  }

  async resolve(request: Request): Promise<PublicUser | null> {
    const { userId, authenticatedUntil } = request.session;
    if (!userId || !authenticatedUntil || authenticatedUntil <= Date.now()) {
      return null;
    }
    const user = await this.users.findById(userId);
    if (
      !user?.active ||
      (await this.access.version(userId)) !==
        (request.session.accessVersion ?? '0')
    ) {
      await new Promise<void>((resolve, reject) => {
        request.session.destroy((error) => (error ? reject(error) : resolve()));
      });
      return null;
    }
    return publicUser(user);
  }
}

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
import { publicUser, type PublicUser } from '../domain/user.js';

export interface AuthenticatedRequest extends Request {
  identityUser: PublicUser;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(IDENTITY_STORE) private readonly users: IdentityStore) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { userId, authenticatedUntil } = request.session;
    if (!userId || !authenticatedUntil || authenticatedUntil <= Date.now()) {
      throw new UnauthorizedException('session_required');
    }
    const user = await this.users.findById(userId);
    if (!user?.active) {
      await new Promise<void>((resolve, reject) => {
        request.session.destroy((error) => (error ? reject(error) : resolve()));
      });
      throw new UnauthorizedException('session_required');
    }
    request.identityUser = publicUser(user);
    return true;
  }
}

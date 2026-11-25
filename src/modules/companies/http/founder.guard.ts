import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../../identity/http/session.guard.js';

@Injectable()
export class FounderGuard implements CanActivate {
  constructor(
    @Inject(SessionGuard) private readonly sessionGuard: SessionGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.sessionGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.identityUser.canManageCompanies) {
      throw new ForbiddenException('founder_required');
    }
    return true;
  }
}

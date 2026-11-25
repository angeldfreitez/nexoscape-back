import { HttpException, HttpStatus } from '@nestjs/common';
import { InvitationProblem } from '../application/admin-invitations.js';

const statuses: Record<InvitationProblem['reason'], HttpStatus> = {
  invitation_disabled: HttpStatus.SERVICE_UNAVAILABLE,
  mail_unavailable: HttpStatus.SERVICE_UNAVAILABLE,
  company_not_found: HttpStatus.NOT_FOUND,
  company_disabled: HttpStatus.CONFLICT,
  same_administrator: HttpStatus.CONFLICT,
  invitation_unavailable: HttpStatus.GONE,
  invitation_already_sent: HttpStatus.CONFLICT,
  administrator_already_assigned: HttpStatus.CONFLICT,
  use_invited_account: HttpStatus.FORBIDDEN,
  account_already_exists: HttpStatus.CONFLICT,
  invalid_credentials: HttpStatus.UNAUTHORIZED,
  password_required: HttpStatus.BAD_REQUEST,
  password_length: HttpStatus.BAD_REQUEST,
  password_blocked: HttpStatus.BAD_REQUEST,
};

export async function invitationResponse<T>(
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof InvitationProblem)) throw error;
    throw new HttpException(error.reason, statuses[error.reason]);
  }
}

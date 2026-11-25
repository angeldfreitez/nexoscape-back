import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { PASSWORD_INPUT_LIMIT } from '../../identity/domain/password-length.js';
import { SessionGuard } from '../../identity/http/session.guard.js';
import { AdminInvitations } from '../application/admin-invitations.js';
import { ManageCompanies } from '../application/manage-companies.js';
import { invitationResponse } from './invitation-response.js';

const accessVersion = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);

const inviteToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const previewInput = z.strictObject({ token: inviteToken });
const acceptInput = z.strictObject({
  token: inviteToken,
  password: z.string().max(PASSWORD_INPUT_LIMIT).optional(),
  mode: z.enum(['new', 'existing']).optional(),
});

@Controller()
export class CompanyInvitationsController {
  constructor(
    @Inject(AdminInvitations) private readonly invitations: AdminInvitations,
    @Inject(SessionGuard) private readonly sessions: SessionGuard,
    @Inject(ManageCompanies) private readonly companies: ManageCompanies,
  ) {}

  @Post('company-invitations/preview')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  preview(@Body() body: unknown) {
    const parsed = previewInput.safeParse(body);
    if (!parsed.success) throw new BadRequestException('invalid_input');
    return invitationResponse(() =>
      this.invitations.preview(parsed.data.token),
    );
  }

  @Post('company-invitations/accept')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 8 } })
  async accept(@Body() body: unknown, @Req() request: Request) {
    const parsed = acceptInput.safeParse(body);
    if (!parsed.success) throw new BadRequestException('invalid_input');
    const user = await this.sessions.resolve(request);
    return invitationResponse(() =>
      this.invitations.accept(
        parsed.data.token,
        user,
        parsed.data.password,
        parsed.data.mode,
      ),
    );
  }

  @Get('my-companies/:id/access')
  @HttpCode(204)
  @Throttle({ default: { ttl: 60000, limit: 240 } })
  async checkAccess(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('version') version: unknown,
    @Req() request: Request,
  ): Promise<void> {
    const user = await this.sessions.resolve(request);
    if (!user) throw new UnauthorizedException('session_required');

    const parsed = accessVersion.safeParse(version);
    if (!parsed.success)
      throw new BadRequestException('invalid_access_version');
    const [company] = await this.companies.managedBy(user.id, id);
    if (
      !company ||
      company.status === 'disabled' ||
      company.accessVersion !== parsed.data
    ) {
      throw new ForbiddenException('company_access_revoked');
    }
  }

  @Get('my-companies')
  async mine(@Req() request: Request) {
    const user = await this.sessions.resolve(request);
    if (!user) throw new UnauthorizedException('session_required');
    return { companies: await this.companies.managedBy(user.id) };
  }
}

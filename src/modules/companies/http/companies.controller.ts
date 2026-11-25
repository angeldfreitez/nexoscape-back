import {
  BadRequestException,
  Param,
  ParseUUIDPipe,
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CompanyAvailability } from '../application/company-availability.js';
import { ManageCompanies } from '../application/manage-companies.js';
import type { Company } from '../domain/company.js';
import { AdminInvitations } from '../application/admin-invitations.js';
import { invitationResponse } from './invitation-response.js';
import type { AuthenticatedRequest } from '../../identity/http/session.guard.js';
import { FounderGuard } from './founder.guard.js';

const activityCursor = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => value.length < 19 || value <= '9223372036854775807')
  .optional();

const companyStatus = z.strictObject({ active: z.boolean() });
const transferInput = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});

const companyInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  initialAdminEmail: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});

function view(company: Company) {
  return {
    ...company,
    linkedUsers: 0,
    initialAdminStatus: 'pending' as const,
    status: 'pending_access' as const,
    invitedAdminEmail: null,
  };
}

@Controller('companies')
@UseGuards(FounderGuard)
export class CompaniesController {
  constructor(
    @Inject(ManageCompanies) private readonly companies: ManageCompanies,
    @Inject(CompanyAvailability)
    private readonly availability: CompanyAvailability,
    @Inject(AdminInvitations) private readonly invitations: AdminInvitations,
  ) {}

  @Get()
  async list() {
    return { companies: await this.companies.list() };
  }

  @Get(':id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    const company = await this.companies.find(id);
    if (!company) throw new NotFoundException('company_not_found');
    return { company };
  }

  @Get(':id/activity')
  async activity(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('before') before: unknown,
  ) {
    const parsed = activityCursor.safeParse(before);
    if (!parsed.success) throw new BadRequestException('invalid_cursor');
    if (!(await this.companies.find(id))) {
      throw new NotFoundException('company_not_found');
    }
    return this.companies.activity(id, parsed.data ?? null);
  }

  @Post(':id/admin-invitation')
  invite(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return invitationResponse(() =>
      this.invitations.send(id, request.identityUser),
    );
  }

  @Post(':id/admin-transfer')
  transfer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = transferInput.safeParse(body);
    if (!parsed.success) throw new BadRequestException('invalid_input');
    return invitationResponse(() =>
      this.invitations.send(id, request.identityUser, parsed.data.email),
    );
  }

  @Patch(':id/status')
  @HttpCode(204)
  async setAvailability(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = companyStatus.safeParse(body);
    if (!parsed.success) throw new BadRequestException('invalid_input');
    await invitationResponse(() =>
      this.availability.set(id, parsed.data.active, request.identityUser),
    );
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = companyInput.safeParse(body);
    if (!parsed.success) throw new BadRequestException('invalid_input');
    return {
      company: view(
        await this.companies.create(parsed.data, request.identityUser),
      ),
    };
  }
}

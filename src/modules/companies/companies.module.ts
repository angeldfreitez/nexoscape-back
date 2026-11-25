import { Module } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import { readEnvironment } from '../../config/environment.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../identity/application/ports/password-hasher.js';
import {
  AdminInvitations,
  INVITATION_DATA,
  INVITATION_MAILER,
  type InvitationData,
  type InvitationMailer,
} from './application/admin-invitations.js';
import { NewPasswordPolicy } from '../identity/application/new-password-policy.js';
import { IdentityModule } from '../identity/identity.module.js';
import { CompanyAvailability } from './application/company-availability.js';
import { ManageCompanies } from './application/manage-companies.js';
import { CompanyInvitationsController } from './http/company-invitations.controller.js';
import { localInvitationMailer } from './infrastructure/smtp-invitation-mailer.js';
import { TypeormInvitationData } from './infrastructure/typeorm-invitation-data.js';
import { CompaniesController } from './http/companies.controller.js';
import { FounderGuard } from './http/founder.guard.js';
import { CompanyEntity } from './infrastructure/company.entity.js';
import { TypeormCompanyRegistry } from './infrastructure/typeorm-company-registry.js';

@Module({
  imports: [IdentityModule, TypeOrmModule.forFeature([CompanyEntity])],
  controllers: [CompaniesController, CompanyInvitationsController],
  providers: [
    FounderGuard,
    {
      provide: CompanyAvailability,
      inject: [INVITATION_DATA],
      useFactory: (data: InvitationData) => new CompanyAvailability(data),
    },
    {
      provide: INVITATION_DATA,
      inject: [DataSource],
      useFactory: (database: DataSource) => new TypeormInvitationData(database),
    },
    {
      provide: INVITATION_MAILER,
      useFactory: () => localInvitationMailer(readEnvironment(process.env)),
    },
    {
      provide: AdminInvitations,
      inject: [
        INVITATION_DATA,
        INVITATION_MAILER,
        PASSWORD_HASHER,
        NewPasswordPolicy,
      ],
      useFactory: (
        data: InvitationData,
        mailer: InvitationMailer,
        passwords: PasswordHasher,
        passwordPolicy: NewPasswordPolicy,
      ) => new AdminInvitations(data, mailer, passwords, passwordPolicy),
    },
    {
      provide: ManageCompanies,
      inject: [getRepositoryToken(CompanyEntity)],
      useFactory: (repository: Repository<CompanyEntity>) =>
        new ManageCompanies(new TypeormCompanyRegistry(repository)),
    },
  ],
})
export class CompaniesModule {}

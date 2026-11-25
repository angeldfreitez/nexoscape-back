import nodemailer from 'nodemailer';
import type { Environment } from '../../../config/environment.js';
import type {
  AdminInvitation,
  InvitationMailer,
} from '../application/admin-invitations.js';

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  ignoreTLS?: boolean;
}

export function localInvitationMailer(
  environment: Environment,
): InvitationMailer {
  const origin = new URL(environment.APP_ORIGIN);
  const enabled =
    environment.NODE_ENV === 'development' &&
    environment.NEXO_LOCAL_INVITATIONS === 'true' &&
    origin.hostname === 'nexoscape.localhost';

  // The composition root only knows about Mailpit. No real SMTP credentials.
  return new SmtpInvitationMailer(
    enabled,
    origin,
    'NexoScape local <invitaciones@nexoscape.invalid>',
    { host: 'mailpit', port: 1025, secure: false, ignoreTLS: true },
  );
}

class SmtpInvitationMailer implements InvitationMailer {
  private readonly smtp: ReturnType<typeof nodemailer.createTransport>;

  constructor(
    readonly enabled: boolean,
    private readonly origin: URL,
    private readonly from: string,
    settings: SmtpSettings,
  ) {
    this.smtp = nodemailer.createTransport({
      ...settings,
      dnsTimeout: 2000,
      connectionTimeout: 2000,
      greetingTimeout: 2000,
      socketTimeout: 3000,
    });
  }

  async send(invitation: AdminInvitation, token: string): Promise<void> {
    if (!this.enabled) throw new Error('Local invitations disabled');
    const link = new URL('/aceptar-invitacion', this.origin);
    link.hash = token;
    const result = await this.smtp.sendMail({
      from: this.from,
      to: { name: '', address: invitation.email },
      subject: 'Invitación para administrar una empresa en NexoScape',
      text: [
        'Te invitaron a administrar la siguiente empresa en NexoScape:',
        invitation.companyName,
        '',
        'Abre este enlace con el correo al que se envió la invitación:',
        link.href,
        '',
        'Este enlace vence en 24 horas y sólo se puede aceptar una vez.',
        'Este mensaje se generó en el entorno local de desarrollo.',
      ].join('\n'),
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    if (result.accepted.length !== 1) {
      throw new Error('SMTP did not accept mail');
    }
  }
}

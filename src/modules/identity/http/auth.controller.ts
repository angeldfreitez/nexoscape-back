import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Authenticate } from '../application/use-cases/authenticate.js';
import { generateToken } from '../infrastructure/security/csrf.js';
import {
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
} from '../infrastructure/sessions/session-types.js';
import { SessionGuard, type AuthenticatedRequest } from './session.guard.js';

const loginSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.trim().toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(Authenticate) private readonly authenticate: Authenticate,
  ) {}

  @Get('csrf')
  csrf(@Req() request: Request): { token: string } {
    return { token: generateToken(request) };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() body: unknown, @Req() request: Request) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('invalid_input');
    const user = await this.authenticate.execute(
      parsed.data.email,
      parsed.data.password,
    );
    if (!user) throw new UnauthorizedException('invalid_credentials');
    // Destroy the anonymous/pre-login session to prevent session fixation.
    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) =>
        error ? reject(error) : resolve(),
      );
    });
    request.session.userId = user.id;
    request.session.authenticatedUntil = Date.now() + SESSION_LIFETIME_MS;
    request.session.cookie.maxAge = SESSION_LIFETIME_MS;
    const token = generateToken(request);
    await new Promise<void>((resolve, reject) => {
      request.session.save((error) => (error ? reject(error) : resolve()));
    });
    return { user, token };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() request: AuthenticatedRequest) {
    return { user: request.identityUser };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      request.session.destroy((error) => (error ? reject(error) : resolve()));
    });
    response.clearCookie(SESSION_COOKIE, {
      path: '/api',
      httpOnly: true,
      sameSite: 'lax',
      secure: request.secure,
    });
    response.status(204).send();
  }
}

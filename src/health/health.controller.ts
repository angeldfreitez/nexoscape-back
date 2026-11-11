import { Controller, Get, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(@Inject(DataSource) private readonly database: DataSource) {}

  @Get()
  async health(): Promise<{ status: string }> {
    await this.database.query('SELECT 1');
    return { status: 'ok' };
  }
}

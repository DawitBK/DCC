import {
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { Public } from '../authz/decorators';
import { DATABASE, type Database } from '../database/database';
import { MetricsService } from './metrics.service';

@Controller()
@SkipThrottle()
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly metrics: MetricsService,
  ) {}

  /** Liveness: the process is up. Never touches dependencies, so a database outage does not make the orchestrator kill a healthy process. */
  @Public()
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: can this instance serve traffic (database reachable)? */
  @Public()
  @Get('health/ready')
  async ready() {
    try {
      await this.database.ping();
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        checks: { database: 'down' },
      });
    }
    return { status: 'ok', checks: { database: 'up' } };
  }

  /** Prometheus text format. Off unless METRICS_TOKEN is configured; then it needs `Authorization: Bearer <token>`. */
  @Public()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Get('metrics')
  metricsText(@Headers('authorization') authorization?: string) {
    if (!this.cfg.METRICS_TOKEN) throw new NotFoundException();
    if (authorization !== `Bearer ${this.cfg.METRICS_TOKEN}`) throw new UnauthorizedException();
    return this.metrics.render();
  }
}

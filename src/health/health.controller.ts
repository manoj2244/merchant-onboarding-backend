import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness/readiness: checks PostgreSQL and Redis connectivity' })
  async check(): Promise<{ status: 'ok'; database: 'up'; redis: 'up' }> {
    const result = await this.health.check();
    if (result.database !== 'up' || result.redis !== 'up') {
      throw new ServiceUnavailableException(`database=${result.database}, redis=${result.redis}`);
    }
    return { status: 'ok', database: 'up', redis: 'up' };
  }
}

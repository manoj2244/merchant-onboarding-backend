import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RISK_REVIEW_QUEUE } from '../risk/risk.constants';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [BullModule.registerQueue({ name: RISK_REVIEW_QUEUE })],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { RiskAssessment } from './entities/risk-assessment.entity';
import { RISK_PROVIDER } from './providers/risk-provider.interface';
import { SimulatedKybProvider } from './providers/simulated-kyb.provider';
import { RiskReviewProcessor } from './risk-review.processor';
import { RiskReviewProducer } from './risk-review.producer';
import { RISK_REVIEW_QUEUE } from './risk.constants';

/**
 * Owns the risk-review queue: producer (used by the application workflow), the worker and the
 * provider binding. Swapping in a real KYB vendor means binding a different RISK_PROVIDER here.
 */
@Module({
  imports: [BullModule.registerQueue({ name: RISK_REVIEW_QUEUE }), TypeOrmModule.forFeature([RiskAssessment]), AuditModule],
  providers: [
    RiskReviewProducer,
    RiskReviewProcessor,
    SimulatedKybProvider,
    { provide: RISK_PROVIDER, useExisting: SimulatedKybProvider },
  ],
  exports: [RiskReviewProducer],
})
export class RiskModule {}

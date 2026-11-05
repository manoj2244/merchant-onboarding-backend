import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { RiskModule } from '../risk/risk.module';
import { UsersModule } from '../users/users.module';
import { ApplicationWorkflowService } from './application-workflow.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { MerchantApplication } from './entities/merchant-application.entity';
import { ReviewDecision } from './entities/review-decision.entity';
import { ApplicationAccessPolicy } from './policies/application-access.policy';

@Module({
  imports: [TypeOrmModule.forFeature([MerchantApplication, ReviewDecision]), AuditModule, UsersModule, RiskModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, ApplicationWorkflowService, ApplicationAccessPolicy],
})
export class ApplicationsModule {}

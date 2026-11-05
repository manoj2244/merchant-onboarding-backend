import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { MerchantApplication } from './entities/merchant-application.entity';
import { ReviewDecision } from './entities/review-decision.entity';
import { ApplicationAccessPolicy } from './policies/application-access.policy';

@Module({
  imports: [TypeOrmModule.forFeature([MerchantApplication, ReviewDecision]), AuditModule, UsersModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, ApplicationAccessPolicy],
  exports: [ApplicationsService, ApplicationAccessPolicy],
})
export class ApplicationsModule {}

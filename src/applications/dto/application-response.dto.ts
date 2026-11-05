import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { maskTaxId } from '../../common/utils/mask';
import { ApplicationRiskStatus, ApplicationStatus, BusinessType } from '../application.enums';
import { MerchantApplication } from '../entities/merchant-application.entity';

/** API view of an application. Built explicitly so new entity columns are never exposed by accident. */
export class ApplicationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() businessName: string;
  @ApiProperty() legalBusinessName: string;
  @ApiProperty({ enum: BusinessType }) businessType: BusinessType;
  @ApiPropertyOptional({ nullable: true }) website: string | null;
  @ApiProperty() ownerFullName: string;
  @ApiProperty() ownerEmail: string;
  @ApiProperty() ownerPhone: string;
  @ApiProperty({ example: '****1234', description: 'Always masked in API responses' }) ownerTaxIdMasked: string;
  @ApiProperty() requestedMonthlyVolume: number;
  @ApiProperty() averageTicketSize: number;
  @ApiProperty() mcc: string;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: ApplicationStatus }) status: ApplicationStatus;
  @ApiProperty({ enum: ApplicationRiskStatus }) riskStatus: ApplicationRiskStatus;
  @ApiProperty() submissionCount: number;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) assignedReviewerId: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  static from(app: MerchantApplication): ApplicationResponseDto {
    return {
      id: app.id,
      businessName: app.businessName,
      legalBusinessName: app.legalBusinessName,
      businessType: app.businessType,
      website: app.website,
      ownerFullName: app.ownerFullName,
      ownerEmail: app.ownerEmail,
      ownerPhone: app.ownerPhone,
      ownerTaxIdMasked: maskTaxId(app.ownerTaxId),
      requestedMonthlyVolume: app.requestedMonthlyVolume,
      averageTicketSize: app.averageTicketSize,
      mcc: app.mcc,
      currency: app.currency,
      status: app.status,
      riskStatus: app.riskStatus,
      submissionCount: app.submissionCount,
      createdById: app.createdById,
      assignedReviewerId: app.assignedReviewerId,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  }
}

export class PaginationMetaDto {
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}

export class PaginatedApplicationsDto {
  @ApiProperty({ type: [ApplicationResponseDto] }) data: ApplicationResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

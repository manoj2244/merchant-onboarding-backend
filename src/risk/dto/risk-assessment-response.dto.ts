import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RiskAssessment } from '../entities/risk-assessment.entity';
import { RiskAssessmentStatus, RiskLevel } from '../risk.enums';

export class RiskAssessmentResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty() submissionNumber: number;
  @ApiProperty({ enum: RiskAssessmentStatus }) status: RiskAssessmentStatus;
  @ApiPropertyOptional({ nullable: true }) score: number | null;
  @ApiPropertyOptional({ enum: RiskLevel, nullable: true }) riskLevel: RiskLevel | null;
  @ApiProperty({ type: [String], example: ['HIGH_RISK_MCC'] }) reasons: string[];
  @ApiPropertyOptional({ nullable: true }) providerReference: string | null;
  @ApiProperty() attempts: number;
  @ApiPropertyOptional({ nullable: true }) lastError: string | null;
  @ApiPropertyOptional({ nullable: true }) completedAt: Date | null;
  @ApiProperty() createdAt: Date;

  static from(a: RiskAssessment): RiskAssessmentResponseDto {
    return {
      id: a.id,
      applicationId: a.applicationId,
      submissionNumber: a.submissionNumber,
      status: a.status,
      score: a.score,
      riskLevel: a.riskLevel,
      reasons: a.reasons,
      providerReference: a.providerReference,
      attempts: a.attempts,
      lastError: a.lastError,
      completedAt: a.completedAt,
      createdAt: a.createdAt,
    };
  }
}

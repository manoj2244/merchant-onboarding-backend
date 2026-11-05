import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { NoNullBytes } from '../../common/validation/no-null-bytes';
import { ApplicationStatus, DecisionType } from '../application.enums';
import { ReviewDecision } from '../entities/review-decision.entity';

export class CreateDecisionDto {
  @ApiProperty({ enum: DecisionType })
  @IsEnum(DecisionType)
  decision: DecisionType;

  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'Required for REJECT and REQUEST_INFO (the merchant and auditors need to know why)',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((dto: CreateDecisionDto) => dto.decision !== DecisionType.APPROVE || dto.comment !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'comment is required when rejecting or requesting information' })
  @NoNullBytes()
  @MaxLength(2000)
  comment?: string;
}

export class DecisionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty({ format: 'uuid' }) reviewerId: string;
  @ApiProperty({ enum: DecisionType }) decision: DecisionType;
  @ApiPropertyOptional({ nullable: true }) comment: string | null;
  @ApiProperty() createdAt: Date;

  static from(d: ReviewDecision): DecisionResponseDto {
    return {
      id: d.id,
      applicationId: d.applicationId,
      reviewerId: d.reviewerId,
      decision: d.decision,
      comment: d.comment,
      createdAt: d.createdAt,
    };
  }
}

export class DecisionResultDto extends DecisionResponseDto {
  @ApiProperty({ enum: ApplicationStatus, description: 'Application status after the decision' })
  applicationStatus: ApplicationStatus;
}

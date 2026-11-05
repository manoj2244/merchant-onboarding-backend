import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { MerchantApplication } from '../../applications/entities/merchant-application.entity';
import { RiskAssessmentStatus, RiskLevel } from '../risk.enums';

/**
 * One row per (application, submission). The unique constraint is the database-level
 * idempotency guarantee: a duplicate submit or duplicate job cannot create a second assessment.
 */
@Entity('risk_assessments')
@Unique('uq_risk_assessments_application_submission', ['applicationId', 'submissionNumber'])
@Index('idx_risk_assessments_status', ['status'])
export class RiskAssessment {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_risk_assessments' })
  id: string;

  @Column({ name: 'application_id', type: 'uuid' })
  applicationId: string;

  @ManyToOne(() => MerchantApplication, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'application_id', foreignKeyConstraintName: 'fk_risk_assessments_application' })
  application?: MerchantApplication;

  @Column({ name: 'submission_number', type: 'int' })
  submissionNumber: number;

  @Column({ type: 'enum', enum: RiskAssessmentStatus, enumName: 'risk_assessment_status', default: RiskAssessmentStatus.PENDING })
  status: RiskAssessmentStatus;

  @Column({ type: 'int', nullable: true })
  score: number | null;

  @Column({ name: 'risk_level', type: 'enum', enum: RiskLevel, enumName: 'risk_level', nullable: true })
  riskLevel: RiskLevel | null;

  /** Reason codes only (e.g. HIGH_RISK_MCC); the raw provider payload is intentionally not stored. */
  @Column({ type: 'jsonb', default: [] })
  reasons: string[];

  @Column({ name: 'provider_reference', type: 'varchar', length: 100, nullable: true })
  providerReference: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true })
  lastError: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

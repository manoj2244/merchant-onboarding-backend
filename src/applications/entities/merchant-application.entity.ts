import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalTransformer } from '../../database/decimal.transformer';
import { User } from '../../users/entities/user.entity';
import { ApplicationRiskStatus, ApplicationStatus, BusinessType } from '../application.enums';

@Entity('merchant_applications')
@Index('idx_merchant_applications_status', ['status'])
@Index('idx_merchant_applications_created_by_status', ['createdById', 'status'])
@Index('idx_merchant_applications_reviewer_status', ['assignedReviewerId', 'status'])
@Check('chk_merchant_applications_monthly_volume_positive', '"requested_monthly_volume" > 0')
@Check('chk_merchant_applications_avg_ticket_positive', '"average_ticket_size" > 0')
@Check('chk_merchant_applications_submission_count', '"submission_count" >= 0')
export class MerchantApplication {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_merchant_applications' })
  id: string;

  // --- Business ---
  @Column({ name: 'business_name', type: 'varchar', length: 200 })
  businessName: string;

  @Column({ name: 'legal_business_name', type: 'varchar', length: 200 })
  legalBusinessName: string;

  @Column({ name: 'business_type', type: 'enum', enum: BusinessType, enumName: 'business_type' })
  businessType: BusinessType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website: string | null;

  // --- Owner / contact (PII: candidates for field-level encryption, see README) ---
  @Column({ name: 'owner_full_name', type: 'varchar', length: 200 })
  ownerFullName: string;

  @Column({ name: 'owner_email', type: 'varchar', length: 255 })
  ownerEmail: string;

  @Column({ name: 'owner_phone', type: 'varchar', length: 32 })
  ownerPhone: string;

  @Column({ name: 'owner_tax_id', type: 'varchar', length: 64 })
  ownerTaxId: string;

  // --- Requested processing ---
  @Column({ name: 'requested_monthly_volume', type: 'numeric', precision: 14, scale: 2, transformer: decimalTransformer })
  requestedMonthlyVolume: number;

  @Column({ name: 'average_ticket_size', type: 'numeric', precision: 12, scale: 2, transformer: decimalTransformer })
  averageTicketSize: number;

  /** ISO 18245 merchant category code. */
  @Column({ type: 'char', length: 4 })
  mcc: string;

  /** ISO 4217 settlement currency. */
  @Column({ type: 'char', length: 3 })
  currency: string;

  // --- Workflow ---
  @Column({ type: 'enum', enum: ApplicationStatus, enumName: 'application_status', default: ApplicationStatus.DRAFT })
  status: ApplicationStatus;

  @Column({
    name: 'risk_status',
    type: 'enum',
    enum: ApplicationRiskStatus,
    enumName: 'application_risk_status',
    default: ApplicationRiskStatus.NOT_STARTED,
  })
  riskStatus: ApplicationRiskStatus;

  /** Incremented on every submit; together with the application id it identifies one risk assessment. */
  @Column({ name: 'submission_count', type: 'int', default: 0 })
  submissionCount: number;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id', foreignKeyConstraintName: 'fk_merchant_applications_created_by' })
  createdBy?: User;

  @Column({ name: 'assigned_reviewer_id', type: 'uuid', nullable: true })
  assignedReviewerId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'assigned_reviewer_id', foreignKeyConstraintName: 'fk_merchant_applications_assigned_reviewer' })
  assignedReviewer?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

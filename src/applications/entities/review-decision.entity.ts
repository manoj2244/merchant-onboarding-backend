import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { DecisionType } from '../application.enums';
import { MerchantApplication } from './merchant-application.entity';

/** Immutable record of every reviewer decision (an application can collect several via REQUEST_INFO). */
@Entity('review_decisions')
@Index('idx_review_decisions_application', ['applicationId', 'createdAt'])
export class ReviewDecision {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_review_decisions' })
  id: string;

  @Column({ name: 'application_id', type: 'uuid' })
  applicationId: string;

  @ManyToOne(() => MerchantApplication, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'application_id', foreignKeyConstraintName: 'fk_review_decisions_application' })
  application?: MerchantApplication;

  @Column({ name: 'reviewer_id', type: 'uuid' })
  reviewerId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reviewer_id', foreignKeyConstraintName: 'fk_review_decisions_reviewer' })
  reviewer?: User;

  @Column({ type: 'enum', enum: DecisionType, enumName: 'review_decision_type' })
  decision: DecisionType;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

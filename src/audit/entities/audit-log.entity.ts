import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Append-only audit trail. A database trigger (see InitialSchema migration) rejects UPDATE and
 * DELETE so the history cannot be rewritten through the application.
 */
@Entity('audit_logs')
@Index('idx_audit_logs_entity', ['entityType', 'entityId', 'createdAt'])
@Index('idx_audit_logs_actor', ['actorId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_audit_logs' })
  id: string;

  /** Null when the action was performed by the system (e.g. the risk worker). */
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'actor_id', foreignKeyConstraintName: 'fk_audit_logs_actor' })
  actor?: User | null;

  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 64 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  /** Already masked by AuditService before it reaches this column. */
  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

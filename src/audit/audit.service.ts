import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { redactSensitive } from '../common/utils/mask';
import { AuditAction, AuditEntityType } from './audit.constants';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditEntry {
  /** Null for system actions (e.g. the risk worker). */
  actorId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>) {}

  /**
   * Writes through the caller's EntityManager so the audit row commits or rolls back together
   * with the change it describes — no "approved but not audited" (or the reverse).
   * Metadata is always redacted/masked here, so callers cannot forget to.
   */
  async record(manager: EntityManager, entry: AuditEntry): Promise<void> {
    const repo = manager.getRepository(AuditLog);
    await repo.save(
      repo.create({
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: redactSensitive(entry.metadata ?? {}),
      }),
    );
  }

  findForEntity(entityType: AuditEntityType, entityId: string): Promise<AuditLog[]> {
    return this.auditLogs.find({
      where: { entityType, entityId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }
}

import { ApiProperty } from '@nestjs/swagger';
import { AuditLog } from '../entities/audit-log.entity';

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Null for system actions' })
  actorId: string | null;

  @ApiProperty()
  action: string;

  @ApiProperty()
  entityType: string;

  @ApiProperty({ format: 'uuid' })
  entityId: string;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Masked change metadata' })
  metadata: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;

  static from(log: AuditLog): AuditLogResponseDto {
    return {
      id: log.id,
      actorId: log.actorId,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      metadata: log.metadata,
      createdAt: log.createdAt,
    };
  }
}

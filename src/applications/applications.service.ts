import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { AuditAction, AuditEntityType } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { AuditLogResponseDto } from '../audit/dto/audit-log-response.dto';
import { ApplicationRiskStatus, ApplicationStatus } from './application.enums';
import { ApplicationAction, transition } from './domain/application-state-machine';
import { ApplicationResponseDto, PaginatedApplicationsDto } from './dto/application-response.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { MerchantApplication } from './entities/merchant-application.entity';
import { ApplicationAccessPolicy } from './policies/application-access.policy';

type EditableField = keyof UpdateApplicationDto;

@Injectable()
export class ApplicationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly policy: ApplicationAccessPolicy,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateApplicationDto): Promise<ApplicationResponseDto> {
    const created = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MerchantApplication);
      const application = await repo.save(
        repo.create({
          ...dto,
          website: dto.website ?? null,
          status: ApplicationStatus.DRAFT,
          riskStatus: ApplicationRiskStatus.NOT_STARTED,
          submissionCount: 0,
          createdById: user.id,
          assignedReviewerId: null,
        }),
      );
      await this.audit.record(manager, {
        actorId: user.id,
        action: AuditAction.APPLICATION_CREATED,
        entityType: AuditEntityType.MERCHANT_APPLICATION,
        entityId: application.id,
        metadata: { status: application.status, fields: dto },
      });
      return application;
    });
    return ApplicationResponseDto.from(created);
  }

  async findAll(user: AuthenticatedUser, query: ListApplicationsQueryDto): Promise<PaginatedApplicationsDto> {
    const qb = this.policy.applyVisibilityScope(
      this.dataSource.getRepository(MerchantApplication).createQueryBuilder('app'),
      user,
    );
    if (query.status) qb.andWhere('app.status = :status', { status: query.status });

    const [rows, total] = await qb
      .orderBy('app.createdAt', 'DESC')
      .addOrderBy('app.id', 'DESC') // tie-breaker keeps pages stable
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return {
      data: rows.map((row) => ApplicationResponseDto.from(row)),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.from(await this.loadVisible(user, id));
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateApplicationDto): Promise<ApplicationResponseDto> {
    const updated = await this.dataSource.transaction(async (manager) => {
      const application = await this.loadVisible(user, id, { manager, lock: true });
      this.policy.assertCanModify(user, application);
      transition(application.status, ApplicationAction.EDIT);

      const changedFields = (Object.keys(dto) as EditableField[]).filter(
        (field) => dto[field] !== undefined && dto[field] !== application[field],
      );
      if (changedFields.length === 0) return application;

      const before = pick(application, changedFields);
      const after = pick(dto, changedFields);
      Object.assign(application, after);
      const saved = await manager.save(application);

      await this.audit.record(manager, {
        actorId: user.id,
        action: AuditAction.APPLICATION_UPDATED,
        entityType: AuditEntityType.MERCHANT_APPLICATION,
        entityId: application.id,
        // Keyed by field name so AuditService can mask PII values in both snapshots.
        metadata: { changedFields, before, after },
      });
      return saved;
    });
    return ApplicationResponseDto.from(updated);
  }

  async getAuditTrail(user: AuthenticatedUser, id: string): Promise<AuditLogResponseDto[]> {
    await this.loadVisible(user, id);
    const logs = await this.audit.findForEntity(AuditEntityType.MERCHANT_APPLICATION, id);
    return logs.map((log) => AuditLogResponseDto.from(log));
  }

  /**
   * Loads an application *through the visibility scope*. If the caller may not see it, the query
   * returns nothing and we answer 404 — identical to a non-existent id. With `lock`, the row is
   * locked (SELECT … FOR UPDATE) until the surrounding transaction ends, serialising concurrent
   * state changes on the same application.
   */
  async loadVisible(
    user: AuthenticatedUser,
    id: string,
    opts: { manager?: EntityManager; lock?: boolean } = {},
  ): Promise<MerchantApplication> {
    const manager = opts.manager ?? this.dataSource.manager;
    const qb = manager.getRepository(MerchantApplication).createQueryBuilder('app').where('app.id = :id', { id });
    this.policy.applyVisibilityScope(qb, user);
    if (opts.lock) qb.setLock('pessimistic_write');

    const application = await qb.getOne();
    if (!application) throw new NotFoundException('Application not found');
    return application;
  }
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, source[k]])) as Pick<T, K>;
}

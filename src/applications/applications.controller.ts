import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { AuditLogResponseDto } from '../audit/dto/audit-log-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/role.enum';
import { ApplicationsService } from './applications.service';
import { ApplicationResponseDto, PaginatedApplicationsDto } from './dto/application-response.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';

/**
 * Thin HTTP layer: role gates via @Roles, everything else (visibility, ownership, state rules)
 * lives in ApplicationsService + ApplicationAccessPolicy.
 */
@ApiTags('applications')
@ApiBearerAuth()
@ApiNotFoundResponse({ description: 'Application does not exist or is not visible to the caller' })
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post()
  @Roles(Role.SALES, Role.ADMIN)
  @ApiOperation({ summary: 'Create a merchant application (starts in DRAFT)' })
  @ApiCreatedResponse({ type: ApplicationResponseDto })
  @ApiForbiddenResponse({ description: 'Reviewers cannot create applications' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateApplicationDto): Promise<ApplicationResponseDto> {
    return this.applications.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List applications visible to the caller',
    description: 'ADMIN: all. SALES: created by them. REVIEWER: assigned to them. Filter by status, paginated.',
  })
  @ApiOkResponse({ type: PaginatedApplicationsDto })
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: ListApplicationsQueryDto): Promise<PaginatedApplicationsDto> {
    return this.applications.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one application' })
  @ApiOkResponse({ type: ApplicationResponseDto })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<ApplicationResponseDto> {
    return this.applications.findOne(user, id);
  }

  @Patch(':id')
  @Roles(Role.SALES, Role.ADMIN)
  @ApiOperation({ summary: 'Update an application while it is editable (DRAFT or NEEDS_INFORMATION)' })
  @ApiOkResponse({ type: ApplicationResponseDto })
  @ApiConflictResponse({ description: 'Application is not in an editable status' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationDto,
  ): Promise<ApplicationResponseDto> {
    return this.applications.update(user, id, dto);
  }

  @Get(':id/audit-logs')
  @ApiOperation({ summary: 'Audit trail of an application (masked metadata)' })
  @ApiOkResponse({ type: [AuditLogResponseDto] })
  auditLogs(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<AuditLogResponseDto[]> {
    return this.applications.getAuditTrail(user, id);
  }
}

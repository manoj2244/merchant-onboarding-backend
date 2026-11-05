import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
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
import { RiskAssessmentResponseDto } from '../risk/dto/risk-assessment-response.dto';
import { Role } from '../users/role.enum';
import { ApplicationWorkflowService } from './application-workflow.service';
import { ApplicationsService } from './applications.service';
import { ApplicationResponseDto, PaginatedApplicationsDto } from './dto/application-response.dto';
import { AssignReviewerDto } from './dto/assign-reviewer.dto';
import { CreateDecisionDto, DecisionResponseDto, DecisionResultDto } from './dto/decision.dto';
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
  constructor(
    private readonly applications: ApplicationsService,
    private readonly workflow: ApplicationWorkflowService,
  ) {}

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

  @Post(':id/submit')
  @Roles(Role.SALES, Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit for review; starts an asynchronous risk/KYB check',
    description: 'Returns 202 immediately with status SUBMITTED / riskStatus PENDING. Poll the application or its risk assessments.',
  })
  @ApiAcceptedResponse({ type: ApplicationResponseDto })
  @ApiConflictResponse({ description: 'Application is not in DRAFT or NEEDS_INFORMATION' })
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<ApplicationResponseDto> {
    return this.workflow.submit(user, id);
  }

  @Post(':id/assign-reviewer')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign (or reassign) the reviewer responsible for the decision' })
  @ApiOkResponse({ type: ApplicationResponseDto })
  @ApiBadRequestResponse({ description: 'reviewerId is not an active REVIEWER' })
  @ApiConflictResponse({ description: 'Application is not in SUBMITTED, UNDER_REVIEW or NEEDS_INFORMATION' })
  assignReviewer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignReviewerDto,
  ): Promise<ApplicationResponseDto> {
    return this.workflow.assignReviewer(user, id, dto.reviewerId);
  }

  @Post(':id/decisions')
  @Roles(Role.REVIEWER)
  @ApiOperation({
    summary: 'Record a review decision (APPROVE, REJECT, REQUEST_INFO)',
    description: 'Only the assigned reviewer, only while UNDER_REVIEW. A comment is required for REJECT and REQUEST_INFO.',
  })
  @ApiCreatedResponse({ type: DecisionResultDto })
  @ApiForbiddenResponse({ description: 'Caller is not the assigned reviewer' })
  @ApiConflictResponse({ description: 'Application is not UNDER_REVIEW' })
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDecisionDto,
  ): Promise<DecisionResultDto> {
    return this.workflow.decide(user, id, dto);
  }

  @Get(':id/decisions')
  @ApiOperation({ summary: 'Decision history of an application (oldest first)' })
  @ApiOkResponse({ type: [DecisionResponseDto] })
  decisions(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<DecisionResponseDto[]> {
    return this.workflow.listDecisions(user, id);
  }

  @Get(':id/risk-assessments')
  @ApiOperation({ summary: 'Risk assessment history (one per submission, newest first)' })
  @ApiOkResponse({ type: [RiskAssessmentResponseDto] })
  riskAssessments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RiskAssessmentResponseDto[]> {
    return this.workflow.listRiskAssessments(user, id);
  }

  @Post(':id/risk-assessments/retry')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-run a FAILED (or stuck PENDING) risk check for the current submission' })
  @ApiAcceptedResponse({ type: RiskAssessmentResponseDto })
  @ApiConflictResponse({ description: 'Nothing to retry' })
  retryRiskAssessment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RiskAssessmentResponseDto> {
    return this.workflow.retryRiskAssessment(user, id);
  }

  @Get(':id/audit-logs')
  @ApiOperation({ summary: 'Audit trail of an application (masked metadata)' })
  @ApiOkResponse({ type: [AuditLogResponseDto] })
  auditLogs(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<AuditLogResponseDto[]> {
    return this.applications.getAuditTrail(user, id);
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from './role.enum';
import { UsersService } from './users.service';

export class ReviewerDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() fullName: string;
  @ApiProperty() email: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('reviewers')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Active reviewers an application can be assigned to' })
  @ApiOkResponse({ type: [ReviewerDto] })
  async reviewers(): Promise<ReviewerDto[]> {
    const reviewers = await this.users.listActiveReviewers();
    return reviewers.map((u) => ({ id: u.id, fullName: u.fullName, email: u.email }));
  }
}

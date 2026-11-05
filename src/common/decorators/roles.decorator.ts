import { SetMetadata } from '@nestjs/common';
import { Role } from '../../users/role.enum';

export const ROLES_KEY = 'roles';

/**
 * Coarse, role-level gate checked by RolesGuard. Object-level rules (ownership, assignment)
 * are enforced separately in the service layer by ApplicationAccessPolicy.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

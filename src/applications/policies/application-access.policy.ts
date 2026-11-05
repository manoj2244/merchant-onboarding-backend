import { ForbiddenException, Injectable } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { AuthenticatedUser } from '../../auth/authenticated-user';
import { Role } from '../../users/role.enum';
import { MerchantApplication } from '../entities/merchant-application.entity';

/**
 * The single source of truth for object-level authorization on merchant applications.
 *
 * Visibility is enforced *inside the SQL query* (`applyVisibilityScope`), so an application a user
 * may not see is never loaded at all and the API answers 404 — exactly as if the id did not exist.
 * That prevents both data leaks and probing for valid ids. Action rules (`assertCan…`) then decide
 * what a user may do with an application they are allowed to see (403 if not).
 */
@Injectable()
export class ApplicationAccessPolicy {
  applyVisibilityScope(
    qb: SelectQueryBuilder<MerchantApplication>,
    user: AuthenticatedUser,
  ): SelectQueryBuilder<MerchantApplication> {
    const alias = qb.alias;
    switch (user.role) {
      case Role.ADMIN:
        return qb;
      case Role.SALES:
        return qb.andWhere(`${alias}.createdById = :scopeUserId`, { scopeUserId: user.id });
      case Role.REVIEWER:
        return qb.andWhere(`${alias}.assignedReviewerId = :scopeUserId`, { scopeUserId: user.id });
      default:
        // Unknown role: fail closed by matching nothing.
        return qb.andWhere('1 = 0');
    }
  }

  /** Edit and submit: the SALES owner or an ADMIN. Reviewers never modify application data. */
  assertCanModify(user: AuthenticatedUser, application: MerchantApplication): void {
    const isOwner = user.role === Role.SALES && application.createdById === user.id;
    if (!(isOwner || user.role === Role.ADMIN)) {
      throw new ForbiddenException('Only the creating sales user or an admin can modify this application');
    }
  }

  /** Approve / reject / request info: only the reviewer currently assigned. Admins cannot decide. */
  assertCanDecide(user: AuthenticatedUser, application: MerchantApplication): void {
    if (user.role !== Role.REVIEWER || application.assignedReviewerId !== user.id) {
      throw new ForbiddenException('Only the assigned reviewer can record a decision on this application');
    }
  }

  assertCanAssign(user: AuthenticatedUser): void {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Only an admin can assign reviewers');
    }
  }
}

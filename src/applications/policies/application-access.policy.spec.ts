import { ForbiddenException } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { AuthenticatedUser } from '../../auth/authenticated-user';
import { Role } from '../../users/role.enum';
import { MerchantApplication } from '../entities/merchant-application.entity';
import { ApplicationAccessPolicy } from './application-access.policy';

describe('ApplicationAccessPolicy', () => {
  const policy = new ApplicationAccessPolicy();
  const user = (role: Role, id = `${role.toLowerCase()}-1`): AuthenticatedUser => ({ id, role, email: `${id}@example.com` });
  const application = (overrides: Partial<MerchantApplication> = {}) =>
    ({ id: 'app-1', createdById: 'sales-1', assignedReviewerId: 'reviewer-1', ...overrides }) as MerchantApplication;

  describe('applyVisibilityScope', () => {
    const fakeQb = () => {
      const qb = { alias: 'app', andWhere: jest.fn() };
      qb.andWhere.mockReturnValue(qb);
      return qb;
    };
    const scope = (u: AuthenticatedUser) => {
      const qb = fakeQb();
      policy.applyVisibilityScope(qb as unknown as SelectQueryBuilder<MerchantApplication>, u);
      return qb.andWhere;
    };

    it('does not restrict ADMIN', () => {
      expect(scope(user(Role.ADMIN))).not.toHaveBeenCalled();
    });

    it('restricts SALES to applications they created', () => {
      expect(scope(user(Role.SALES))).toHaveBeenCalledWith('app.createdById = :scopeUserId', { scopeUserId: 'sales-1' });
    });

    it('restricts REVIEWER to applications assigned to them', () => {
      expect(scope(user(Role.REVIEWER))).toHaveBeenCalledWith('app.assignedReviewerId = :scopeUserId', {
        scopeUserId: 'reviewer-1',
      });
    });

    it('fails closed for an unknown role', () => {
      expect(scope(user('AUDITOR' as Role))).toHaveBeenCalledWith('1 = 0');
    });
  });

  describe('assertCanModify', () => {
    it('allows the SALES owner', () => {
      expect(() => policy.assertCanModify(user(Role.SALES), application())).not.toThrow();
    });

    it('allows an ADMIN', () => {
      expect(() => policy.assertCanModify(user(Role.ADMIN), application())).not.toThrow();
    });

    it('forbids another SALES user', () => {
      expect(() => policy.assertCanModify(user(Role.SALES, 'sales-2'), application())).toThrow(ForbiddenException);
    });

    it('forbids a REVIEWER, even the assigned one', () => {
      expect(() => policy.assertCanModify(user(Role.REVIEWER), application())).toThrow(ForbiddenException);
    });
  });

  describe('assertCanDecide', () => {
    it('allows the assigned REVIEWER', () => {
      expect(() => policy.assertCanDecide(user(Role.REVIEWER), application())).not.toThrow();
    });

    it('forbids a REVIEWER who is not assigned', () => {
      expect(() => policy.assertCanDecide(user(Role.REVIEWER, 'reviewer-2'), application())).toThrow(ForbiddenException);
    });

    it('forbids any REVIEWER when nobody is assigned', () => {
      expect(() => policy.assertCanDecide(user(Role.REVIEWER), application({ assignedReviewerId: null }))).toThrow(
        ForbiddenException,
      );
    });

    it('forbids ADMIN (only the assigned reviewer decides)', () => {
      expect(() => policy.assertCanDecide(user(Role.ADMIN), application())).toThrow(ForbiddenException);
    });

    it('forbids SALES, including the owner', () => {
      expect(() => policy.assertCanDecide(user(Role.SALES), application())).toThrow(ForbiddenException);
    });
  });

  describe('assertCanAssign', () => {
    it('allows only ADMIN', () => {
      expect(() => policy.assertCanAssign(user(Role.ADMIN))).not.toThrow();
      expect(() => policy.assertCanAssign(user(Role.SALES))).toThrow(ForbiddenException);
      expect(() => policy.assertCanAssign(user(Role.REVIEWER))).toThrow(ForbiddenException);
    });
  });
});

import { ApplicationStatus as S } from '../application.enums';
import { ApplicationAction as A, canPerform, EDITABLE_STATUSES, InvalidStateTransitionError, transition } from './application-state-machine';

describe('application state machine', () => {
  /** The complete set of allowed transitions. Anything not listed here must be rejected. */
  const allowed: Array<[S, A, S]> = [
    [S.DRAFT, A.EDIT, S.DRAFT],
    [S.NEEDS_INFORMATION, A.EDIT, S.NEEDS_INFORMATION],
    [S.DRAFT, A.SUBMIT, S.SUBMITTED],
    [S.NEEDS_INFORMATION, A.SUBMIT, S.SUBMITTED],
    [S.SUBMITTED, A.COMPLETE_RISK_REVIEW, S.UNDER_REVIEW],
    [S.SUBMITTED, A.ASSIGN_REVIEWER, S.SUBMITTED],
    [S.UNDER_REVIEW, A.ASSIGN_REVIEWER, S.UNDER_REVIEW],
    [S.NEEDS_INFORMATION, A.ASSIGN_REVIEWER, S.NEEDS_INFORMATION],
    [S.UNDER_REVIEW, A.APPROVE, S.APPROVED],
    [S.UNDER_REVIEW, A.REJECT, S.REJECTED],
    [S.UNDER_REVIEW, A.REQUEST_INFO, S.NEEDS_INFORMATION],
  ];

  it.each(allowed)('%s --%s--> %s', (from, action, to) => {
    expect(canPerform(from, action)).toBe(true);
    expect(transition(from, action)).toBe(to);
  });

  const allowedKeys = new Set(allowed.map(([from, action]) => `${from}:${action}`));
  const rejected = Object.values(S).flatMap((from) =>
    Object.values(A)
      .filter((action) => !allowedKeys.has(`${from}:${action}`))
      .map((action) => [from, action] as [S, A]),
  );

  it.each(rejected)('rejects %s --%s-->', (from, action) => {
    expect(canPerform(from, action)).toBe(false);
    expect(() => transition(from, action)).toThrow(InvalidStateTransitionError);
  });

  it('covers every (status, action) pair exactly once', () => {
    expect(allowed.length + rejected.length).toBe(Object.values(S).length * Object.values(A).length);
  });

  it('treats APPROVED and REJECTED as terminal', () => {
    for (const terminal of [S.APPROVED, S.REJECTED]) {
      for (const action of Object.values(A)) expect(canPerform(terminal, action)).toBe(false);
    }
  });

  it('never lets the risk check jump straight to a decision', () => {
    expect(transition(S.SUBMITTED, A.COMPLETE_RISK_REVIEW)).toBe(S.UNDER_REVIEW);
    expect(canPerform(S.SUBMITTED, A.APPROVE)).toBe(false);
    expect(canPerform(S.SUBMITTED, A.REJECT)).toBe(false);
  });

  it('exposes only DRAFT and NEEDS_INFORMATION as editable', () => {
    expect([...EDITABLE_STATUSES].sort()).toEqual([S.DRAFT, S.NEEDS_INFORMATION].sort());
  });

  it('produces a readable error message', () => {
    expect(() => transition(S.APPROVED, A.EDIT)).toThrow('Cannot edit an application in status APPROVED');
  });
});

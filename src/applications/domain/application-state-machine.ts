import { ApplicationStatus as S } from '../application.enums';

/**
 * Every state change of a merchant application goes through this table. It is pure (no I/O,
 * no framework), so the rules are unit-tested exhaustively and can be read in one place.
 *
 *   DRAFT ──submit──▶ SUBMITTED ──risk check done──▶ UNDER_REVIEW ──approve──▶ APPROVED
 *     ▲                   ▲                               │ ──reject───▶ REJECTED
 *     │                   └──────────submit──────┐        │
 *   (edit)                              NEEDS_INFORMATION ◀── request info
 *                                             (edit)
 */
export enum ApplicationAction {
  EDIT = 'EDIT',
  SUBMIT = 'SUBMIT',
  COMPLETE_RISK_REVIEW = 'COMPLETE_RISK_REVIEW',
  ASSIGN_REVIEWER = 'ASSIGN_REVIEWER',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  REQUEST_INFO = 'REQUEST_INFO',
}

interface Rule {
  from: readonly S[];
  /** Resulting status; omitted for actions that do not change the status (edit, assign). */
  to?: S;
}

const RULES: Record<ApplicationAction, Rule> = {
  [ApplicationAction.EDIT]: { from: [S.DRAFT, S.NEEDS_INFORMATION] },
  [ApplicationAction.SUBMIT]: { from: [S.DRAFT, S.NEEDS_INFORMATION], to: S.SUBMITTED },
  // Performed by the risk worker. It only moves the application into human review; it never decides.
  [ApplicationAction.COMPLETE_RISK_REVIEW]: { from: [S.SUBMITTED], to: S.UNDER_REVIEW },
  [ApplicationAction.ASSIGN_REVIEWER]: { from: [S.SUBMITTED, S.UNDER_REVIEW, S.NEEDS_INFORMATION] },
  [ApplicationAction.APPROVE]: { from: [S.UNDER_REVIEW], to: S.APPROVED },
  [ApplicationAction.REJECT]: { from: [S.UNDER_REVIEW], to: S.REJECTED },
  [ApplicationAction.REQUEST_INFO]: { from: [S.UNDER_REVIEW], to: S.NEEDS_INFORMATION },
};

export class InvalidStateTransitionError extends Error {
  constructor(
    readonly status: S,
    readonly action: ApplicationAction,
  ) {
    super(`Cannot ${action.toLowerCase().replace(/_/g, ' ')} an application in status ${status}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export function canPerform(status: S, action: ApplicationAction): boolean {
  return RULES[action].from.includes(status);
}

/** Returns the status after `action`, or throws if the action is not allowed from `status`. */
export function transition(status: S, action: ApplicationAction): S {
  if (!canPerform(status, action)) throw new InvalidStateTransitionError(status, action);
  return RULES[action].to ?? status;
}

export const EDITABLE_STATUSES: readonly S[] = RULES[ApplicationAction.EDIT].from;

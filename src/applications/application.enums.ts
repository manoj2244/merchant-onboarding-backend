export enum ApplicationStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  NEEDS_INFORMATION = 'NEEDS_INFORMATION',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** Risk status as seen on the application (NOT_STARTED until the first submission). */
export enum ApplicationRiskStatus {
  NOT_STARTED = 'NOT_STARTED',
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  CLEAR = 'CLEAR',
  FLAGGED = 'FLAGGED',
  FAILED = 'FAILED',
}

export enum BusinessType {
  SOLE_PROPRIETORSHIP = 'SOLE_PROPRIETORSHIP',
  PARTNERSHIP = 'PARTNERSHIP',
  LLC = 'LLC',
  CORPORATION = 'CORPORATION',
  NON_PROFIT = 'NON_PROFIT',
}

export enum DecisionType {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  REQUEST_INFO = 'REQUEST_INFO',
}

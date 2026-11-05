export enum RiskAssessmentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  CLEAR = 'CLEAR',
  FLAGGED = 'FLAGGED',
  FAILED = 'FAILED',
}

export const TERMINAL_RISK_STATUSES: readonly RiskAssessmentStatus[] = [
  RiskAssessmentStatus.CLEAR,
  RiskAssessmentStatus.FLAGGED,
  RiskAssessmentStatus.FAILED,
];

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

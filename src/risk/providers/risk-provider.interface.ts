import { BusinessType } from '../../applications/application.enums';
import { RiskLevel } from '../risk.enums';

/** DI token: the worker depends on this abstraction, never on a concrete vendor client. */
export const RISK_PROVIDER = Symbol('RISK_PROVIDER');

/**
 * What we send to the KYB provider. Deliberately minimal: owner PII (tax id, phone, email)
 * is not needed by the simulated provider, so it is not sent.
 */
export interface RiskCheckRequest {
  /** Stable per assessment; lets a real vendor deduplicate at-least-once redeliveries. */
  idempotencyKey: string;
  applicationId: string;
  submissionNumber: number;
  businessName: string;
  legalBusinessName: string;
  businessType: BusinessType;
  website: string | null;
  mcc: string;
  currency: string;
  requestedMonthlyVolume: number;
  averageTicketSize: number;
}

export interface RiskCheckResult {
  outcome: 'CLEAR' | 'FLAGGED';
  score: number;
  riskLevel: RiskLevel;
  /** Reason codes only, e.g. HIGH_RISK_MCC. */
  reasons: string[];
  providerReference: string;
}

export interface RiskProvider {
  assess(request: RiskCheckRequest): Promise<RiskCheckResult>;
}

/** A failure worth retrying (timeout, 5xx, rate limit). */
export class RiskProviderUnavailableError extends Error {
  constructor(message = 'Risk provider unavailable') {
    super(message);
    this.name = 'RiskProviderUnavailableError';
  }
}

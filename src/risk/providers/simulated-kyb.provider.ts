import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RiskLevel } from '../risk.enums';
import { RiskCheckRequest, RiskCheckResult, RiskProvider, RiskProviderUnavailableError } from './risk-provider.interface';

/** MCCs commonly treated as high risk by acquirers (gambling, crypto, money transfer, etc.). */
export const HIGH_RISK_MCCS: ReadonlySet<string> = new Set(['4829', '5967', '5993', '6051', '7995']);

/** Put this marker in the business name to simulate a provider outage (useful to demo retries). */
export const SIMULATE_OUTAGE_MARKER = '[simulate-provider-outage]';

/**
 * Stand-in for a third-party KYB/risk vendor. Fully deterministic — the same input always gives
 * the same result — so tests and demos are repeatable. Rules are intentionally simple.
 */
@Injectable()
export class SimulatedKybProvider implements RiskProvider {
  async assess(request: RiskCheckRequest): Promise<RiskCheckResult> {
    if (request.businessName.toLowerCase().includes(SIMULATE_OUTAGE_MARKER)) {
      throw new RiskProviderUnavailableError('Simulated provider outage');
    }

    let score = 10;
    const reasons: string[] = [];

    if (HIGH_RISK_MCCS.has(request.mcc)) {
      score += 50;
      reasons.push('HIGH_RISK_MCC');
    }
    if (request.requestedMonthlyVolume > 1_000_000) {
      score += 20;
      reasons.push('HIGH_MONTHLY_VOLUME');
    }
    if (request.averageTicketSize > 5_000) {
      score += 15;
      reasons.push('HIGH_AVERAGE_TICKET');
    }
    if (!request.website) {
      score += 10;
      reasons.push('NO_WEB_PRESENCE');
    }

    score = Math.min(score, 100);
    const riskLevel = score >= 50 ? RiskLevel.HIGH : score >= 30 ? RiskLevel.MEDIUM : RiskLevel.LOW;

    return {
      outcome: riskLevel === RiskLevel.HIGH ? 'FLAGGED' : 'CLEAR',
      score,
      riskLevel,
      reasons,
      providerReference: `sim-${createHash('sha256').update(`${request.applicationId}:${request.submissionNumber}`).digest('hex').slice(0, 16)}`,
    };
  }
}

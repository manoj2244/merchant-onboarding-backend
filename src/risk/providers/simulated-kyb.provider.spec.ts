import { BusinessType } from '../../applications/application.enums';
import { RiskLevel } from '../risk.enums';
import { RiskCheckRequest, RiskProviderUnavailableError } from './risk-provider.interface';
import { SIMULATE_OUTAGE_MARKER, SimulatedKybProvider } from './simulated-kyb.provider';

describe('SimulatedKybProvider', () => {
  const provider = new SimulatedKybProvider();
  const request = (overrides: Partial<RiskCheckRequest> = {}): RiskCheckRequest => ({
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    applicationId: '11111111-1111-4111-8111-111111111111',
    submissionNumber: 1,
    businessName: 'Example Coffee',
    legalBusinessName: 'Example Coffee LLC',
    businessType: BusinessType.LLC,
    website: 'https://coffee.example.com',
    mcc: '5814',
    currency: 'USD',
    requestedMonthlyVolume: 50_000,
    averageTicketSize: 25,
    ...overrides,
  });

  it('clears a low-risk merchant', async () => {
    await expect(provider.assess(request())).resolves.toMatchObject({
      outcome: 'CLEAR',
      score: 10,
      riskLevel: RiskLevel.LOW,
      reasons: [],
    });
  });

  it('flags a high-risk MCC', async () => {
    await expect(provider.assess(request({ mcc: '7995' }))).resolves.toMatchObject({
      outcome: 'FLAGGED',
      riskLevel: RiskLevel.HIGH,
      reasons: ['HIGH_RISK_MCC'],
    });
  });

  it('accumulates reasons and caps the score at 100', async () => {
    const result = await provider.assess(
      request({ mcc: '6051', requestedMonthlyVolume: 5_000_000, averageTicketSize: 10_000, website: null }),
    );
    expect(result.score).toBe(100);
    expect(result.reasons).toEqual(['HIGH_RISK_MCC', 'HIGH_MONTHLY_VOLUME', 'HIGH_AVERAGE_TICKET', 'NO_WEB_PRESENCE']);
  });

  it('scores medium risk as CLEAR (the human reviewer still decides)', async () => {
    const result = await provider.assess(request({ requestedMonthlyVolume: 2_000_000 }));
    expect(result).toMatchObject({ outcome: 'CLEAR', riskLevel: RiskLevel.MEDIUM, score: 30 });
  });

  it('is deterministic for the same input, including the provider reference', async () => {
    const [a, b] = await Promise.all([provider.assess(request()), provider.assess(request())]);
    expect(a).toEqual(b);
    const other = await provider.assess(request({ submissionNumber: 2 }));
    expect(other.providerReference).not.toBe(a.providerReference);
  });

  it('simulates an outage on demand', async () => {
    await expect(provider.assess(request({ businessName: `Shop ${SIMULATE_OUTAGE_MARKER}` }))).rejects.toThrow(
      RiskProviderUnavailableError,
    );
  });
});

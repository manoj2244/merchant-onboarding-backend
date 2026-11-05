import {
  RiskCheckRequest,
  RiskCheckResult,
  RiskProvider,
  RiskProviderUnavailableError,
} from '../../src/risk/providers/risk-provider.interface';
import { SimulatedKybProvider } from '../../src/risk/providers/simulated-kyb.provider';

/**
 * Test double for the KYB provider: delegates to the deterministic simulator but can be told to
 * fail the next N calls, fail forever, or respond slowly. Counts calls so tests can prove a
 * duplicate job did not reach the provider.
 */
export class ScriptedRiskProvider implements RiskProvider {
  calls = 0;
  private failuresRemaining = 0;
  private delayMs = 0;
  private readonly delegate = new SimulatedKybProvider();

  reset(): void {
    this.calls = 0;
    this.failuresRemaining = 0;
    this.delayMs = 0;
  }

  failNext(times: number): void {
    this.failuresRemaining = times;
  }

  failAlways(): void {
    this.failuresRemaining = Number.POSITIVE_INFINITY;
  }

  respondAfter(ms: number): void {
    this.delayMs = ms;
  }

  async assess(request: RiskCheckRequest): Promise<RiskCheckResult> {
    this.calls += 1;
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new RiskProviderUnavailableError('Scripted outage');
    }
    return this.delegate.assess(request);
  }
}

/** Polls until `predicate` holds (async work has no completion callback in the HTTP API). */
export async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timed out; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

import { Queue, UnrecoverableError } from 'bullmq';
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
  readonly idempotencyKeys: string[] = [];
  private failuresRemaining = 0;
  private delayMs = 0;
  private permanentError = false;
  private corruptResult = false;
  private readonly delegate = new SimulatedKybProvider();

  reset(): void {
    this.calls = 0;
    this.idempotencyKeys.length = 0;
    this.failuresRemaining = 0;
    this.delayMs = 0;
    this.permanentError = false;
    this.corruptResult = false;
  }

  /** Like a 4xx from a vendor: retrying cannot help, so BullMQ must not retry. */
  failPermanently(): void {
    this.permanentError = true;
  }

  /** Returns a result the database rejects (score NaN), so the job fails *after* the provider call. */
  returnCorruptResult(): void {
    this.corruptResult = true;
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
    this.idempotencyKeys.push(request.idempotencyKey);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.permanentError) throw new UnrecoverableError('Scripted permanent rejection');
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new RiskProviderUnavailableError('Scripted outage');
    }
    const result = await this.delegate.assess(request);
    return this.corruptResult ? { ...result, score: Number.NaN } : result;
  }
}

/** Waits until no job is waiting, running or scheduled for retry. */
export function waitForQueueIdle(queue: Queue): Promise<unknown> {
  return waitFor(
    () => queue.getJobCounts('active', 'waiting', 'delayed'),
    (c) => c.active + c.waiting + c.delayed === 0,
  );
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

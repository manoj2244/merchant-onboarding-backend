import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { EnvironmentVariables } from '../config/env.validation';
import { RISK_ASSESS_JOB, RISK_REVIEW_QUEUE } from './risk.constants';

export interface RiskJobData {
  assessmentId: string;
}

export interface AssessmentRef {
  id: string;
  applicationId: string;
  submissionNumber: number;
}

/** One deterministic job id per (application, submission): BullMQ ignores a second add with the same id. */
export const riskJobId = (ref: Pick<AssessmentRef, 'applicationId' | 'submissionNumber'>) =>
  `risk-${ref.applicationId}-${ref.submissionNumber}`;

@Injectable()
export class RiskReviewProducer {
  private readonly logger = new Logger(RiskReviewProducer.name);

  constructor(
    @InjectQueue(RISK_REVIEW_QUEUE) private readonly queue: Queue<RiskJobData>,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * Must be called only after the transaction that created the assessment has committed, so the
   * worker can never pick up a job whose row does not exist yet.
   *
   * @param replaceFinishedJob used by the admin retry: a failed job with the same id is still kept
   *   in Redis (for inspection) and would make the add a no-op, so it is removed first.
   */
  async enqueue(ref: AssessmentRef, opts: { replaceFinishedJob?: boolean } = {}): Promise<void> {
    const jobId = riskJobId(ref);
    await withTimeout(this.addJob(ref, jobId, opts.replaceFinishedJob ?? false), ENQUEUE_TIMEOUT_MS, 'Enqueue timed out (Redis unavailable?)');
    this.logger.log({ event: 'risk_job_enqueued', jobId, assessmentId: ref.id });
  }

  /** True while the submission's job is waiting, running, or scheduled for a retry. */
  async isInFlight(ref: Pick<AssessmentRef, 'applicationId' | 'submissionNumber'>): Promise<boolean> {
    const job = await this.queue.getJob(riskJobId(ref));
    if (!job) return false;
    return IN_FLIGHT_STATES.has(await job.getState());
  }

  private async addJob(ref: AssessmentRef, jobId: string, replaceFinishedJob: boolean): Promise<void> {
    if (replaceFinishedJob) {
      const existing = await this.queue.getJob(jobId);
      if (existing && ((await existing.isFailed()) || (await existing.isCompleted()))) {
        // A concurrent retry may have removed it already; the add below is deduplicated anyway.
        await existing.remove().catch(() => undefined);
      }
    }
    await this.queue.add(
      RISK_ASSESS_JOB,
      { assessmentId: ref.id },
      {
        jobId,
        attempts: this.config.get('RISK_JOB_ATTEMPTS'),
        backoff: { type: 'exponential', delay: this.config.get('RISK_JOB_BACKOFF_MS') },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
  }
}

/** ioredis would otherwise keep retrying for a long time and hang the HTTP request. */
const ENQUEUE_TIMEOUT_MS = 5_000;
const IN_FLIGHT_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  promise.catch(() => undefined); // a late rejection after the timeout must not go unhandled
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

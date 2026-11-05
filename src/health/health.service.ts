import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { RISK_REVIEW_QUEUE } from '../risk/risk.constants';

type Status = 'up' | 'down';

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(RISK_REVIEW_QUEUE) private readonly queue: Queue,
  ) {}

  async check(): Promise<{ database: Status; redis: Status }> {
    const [database, redis] = await Promise.all([this.pingDatabase(), this.pingRedis()]);
    return { database, redis };
  }

  private async pingDatabase(): Promise<Status> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async pingRedis(): Promise<Status> {
    try {
      // A real round-trip against the queue we depend on, not just a cached connection flag.
      await this.queue.getJobCounts('waiting');
      return 'up';
    } catch {
      return 'down';
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StatusService } from '../intents/status.service';
import { PayrollRunsService } from '../payroll/payroll-runs.service';
import { RedisService } from '@/redis/redis.service';

@Injectable()
export class PayrollProcessorService {
  private readonly logger = new Logger(PayrollProcessorService.name);
  private isProcessing = false;

  constructor(
    private readonly payrollRunsService: PayrollRunsService,
    private readonly statusService: StatusService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    await this.processPendingPayrollIntents();
  }

  async processPendingPayrollIntents(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug('Payroll processor already running, skipping');
      return;
    }

    this.isProcessing = true;
    try {
      const pending = await this.payrollRunsService.getPendingIntents();
      this.logger.debug(`Payroll: ${pending.length} pending intents`);

      for (const item of pending) {
        const lockKey = `payroll:intent:${item.entry_id}`;
        try {
          await this.redisService.withLock(
            lockKey,
            async () => this.processOne(item),
            60_000,
          );
        } catch (err: any) {
          if (err?.message?.includes('already locked')) continue;
          this.logger.warn(`Payroll intent ${item.entry_id}: ${err?.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error('Payroll processor error:', err?.message);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processOne(item: {
    entry_id: string;
    run_id: string;
    deposit_address: string;
    deadline: string | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    if (item.deadline && item.deadline < now) {
      await this.payrollRunsService.markEntryExpired(item.entry_id);
      return;
    }

    let result: { status: string; normalizedStatus: string; isComplete?: boolean; isFailed?: boolean; txHash?: string; raw?: any };
    try {
      result = await this.statusService.getNearIntentsStatus(item.deposit_address);
    } catch (err: any) {
      this.logger.debug(`Status check failed for entry ${item.entry_id}:`, err?.message);
      return;
    }

    if (result.normalizedStatus === 'processing') {
      await this.payrollRunsService.updateEntryStatus(item.entry_id, 'processing', {
        lastStatusPayload: result.raw,
      });
      return;
    }

    if (result.isComplete) {
      await this.payrollRunsService.updateEntryStatus(item.entry_id, 'completed', {
        txHash: result.txHash,
        lastStatusPayload: result.raw,
      });
      return;
    }

    if (result.isFailed) {
      await this.payrollRunsService.updateEntryStatus(item.entry_id, 'failed', {
        error: result.status,
        lastStatusPayload: result.raw,
      });
    }
  }
}

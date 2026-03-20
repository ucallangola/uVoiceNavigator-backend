import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EtlService } from './etl.service';

@Injectable()
export class EtlScheduler {
  private readonly logger = new Logger(EtlScheduler.name);

  constructor(
    private etlService: EtlService,
    private config:     ConfigService,
  ) {}

  // Default: run every hour at :00; overridable via ETL_CRON env var.
  // NestJS @Cron does not support dynamic expressions, so we use a fixed
  // every-minute check and delegate the schedule check to the service.
  @Cron('0 * * * *') // top of every hour
  async runScheduled() {
    this.logger.log('Scheduler triggered ETL run');
    await this.etlService.run('scheduler');
  }
}

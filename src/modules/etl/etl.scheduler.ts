import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EtlService } from './etl.service';

@Injectable()
export class EtlScheduler {
  private readonly logger = new Logger(EtlScheduler.name);

  constructor(private etlService: EtlService) {}

  @Cron('* * * * *') // every minute
  async runScheduled() {
    const schedule = await this.etlService.getSchedule();
    if (!schedule.enabled || !schedule.cronExpression) return;

    if (this.matchesCron(schedule.cronExpression)) {
      this.logger.log('Scheduler triggered ETL run (dynamic schedule)');
      await this.etlService.run('scheduler');
    }
  }

  private matchesCron(expression: string): boolean {
    try {
      const parts = expression.trim().split(/\s+/);
      if (parts.length < 5) return false;
      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
      const now = new Date();
      const match = (field: string, value: number) => field === '*' || parseInt(field) === value;
      const matchDow = (field: string) => {
        if (field === '*') return true;
        const days = field.split('-').map(Number);
        return days.length === 2
          ? now.getDay() >= days[0] && now.getDay() <= days[1]
          : parseInt(field) === now.getDay();
      };
      return match(minute, now.getMinutes()) && match(hour, now.getHours()) &&
             match(dayOfMonth, now.getDate()) && match(month, now.getMonth() + 1) && matchDow(dayOfWeek);
    } catch { return false; }
  }
}

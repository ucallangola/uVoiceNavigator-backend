import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { MssqlService } from '../../database/mssql.service';

@Injectable()
export class MssqlHealthIndicator extends HealthIndicator {
  constructor(private mssql: MssqlService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.mssql.query('SELECT 1 AS ok');
      return this.getStatus(key, true);
    } catch (err: any) {
      throw new HealthCheckError(
        'MssqlHealthIndicator failed',
        this.getStatus(key, false, { message: err.message }),
      );
    }
  }
}

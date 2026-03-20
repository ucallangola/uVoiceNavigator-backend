import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import * as fs from 'fs';

@Injectable()
export class EtlDirHealthIndicator extends HealthIndicator {
  constructor(private config: ConfigService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const sourceDir = this.config.get<string>('etl.sourceDir');
    try {
      fs.accessSync(sourceDir, fs.constants.R_OK);
      return this.getStatus(key, true, { sourceDir });
    } catch {
      throw new HealthCheckError(
        'ETL source directory not accessible',
        this.getStatus(key, false, { sourceDir }),
      );
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class MoverService {
  private readonly logger = new Logger(MoverService.name);

  constructor(private config: ConfigService) {}

  moveToProcessed(sourcePath: string, filename: string): void {
    const dest = path.join(this.config.get<string>('etl.processedDir'), filename);
    this.ensureDir(path.dirname(dest));
    this.moveFile(sourcePath, dest);
    this.logger.log(`Moved ${filename} → processed`);
  }

  moveToFailed(sourcePath: string, filename: string): void {
    const dest = path.join(this.config.get<string>('etl.failedDir'), filename);
    this.ensureDir(path.dirname(dest));
    try {
      this.moveFile(sourcePath, dest);
      this.logger.warn(`Moved ${filename} → failed`);
    } catch {
      this.logger.error(`Could not move ${filename} to failed dir`);
    }
  }

  private moveFile(src: string, dest: string): void {
    try {
      fs.renameSync(src, dest);
    } catch (err: any) {
      if (err.code === 'EXDEV') {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
      } else {
        throw err;
      }
    }
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

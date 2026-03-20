import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { createPaginatedResult } from '../../common/pagination/paginated-result.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { ScannerService } from './services/scanner.service';
import { UploaderService } from './services/uploader.service';
import { MoverService } from './services/mover.service';

@Injectable()
export class EtlService {
  private readonly logger = new Logger(EtlService.name);
  private running = false;

  constructor(
    private prisma:         PrismaService,
    private scanner:        ScannerService,
    private uploader:       UploaderService,
    private mover:          MoverService,
    private notifications:  NotificationsService,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  async run(triggeredBy: 'scheduler' | 'manual' = 'scheduler'): Promise<{ runId: string }> {
    if (this.running) {
      this.logger.warn('ETL already running — skipping');
      return { runId: '' };
    }

    this.running = true;

    const etlRun = await this.prisma.etlRun.create({
      data: { status: 'running' },
    });
    const runId = etlRun.id;

    await this.log(runId, 'info', `ETL run started (${triggeredBy})`);
    this.notifications.emit('etl:started', { runId });

    try {
      const files = await this.scanner.scan();
      await this.prisma.etlRun.update({ where: { id: runId }, data: { totalFiles: files.length } });
      await this.log(runId, 'info', `Found ${files.length} file(s) to process`);

      let uploaded = 0;
      let failed   = 0;
      let skipped  = 0;

      for (const file of files) {
        // Check if already in DB by filename
        const existing = await this.prisma.etlFile.findFirst({
          where: { filename: file.filename, status: { in: ['uploaded', 'moved'] } },
        });
        if (existing) {
          await this.log(runId, 'info', `Skipping ${file.filename} (already processed)`);
          skipped++;
          continue;
        }

        const dbFile = await this.prisma.etlFile.create({
          data: {
            runId:      runId,
            filename:   file.filename,
            sourcePath: file.sourcePath,
            fileSize:   file.fileSize,
            mimeType:   file.mimeType,
            status:     'pending',
          },
        });

        this.notifications.emit('etl:file:started', { runId, filename: file.filename });

        try {
          const result = await this.uploader.upload(file.sourcePath, file.filename, file.mimeType);

          // Save to Audio table as well
          const basename = path.basename(file.filename);
          await this.prisma.audio.create({
            data: {
              filename:      basename,
              source:        this.detectSource(basename),
              agentName:     this.extractAgent(basename),
              customerPhone: this.extractPhone(basename),
              duration:      0,
              wasabiUrl:     result.wasabiUrl,
              fileSize:      file.fileSize,
              status:        'processed',
              processedAt:   new Date(),
            },
          });

          this.mover.moveToProcessed(file.sourcePath, file.filename);

          await this.prisma.etlFile.update({
            where: { id: dbFile.id },
            data: {
              wasabiKey:   result.wasabiKey,
              wasabiUrl:   result.wasabiUrl,
              status:      'moved',
              processedAt: new Date(),
            },
          });

          await this.log(runId, 'info', `✓ ${file.filename} uploaded and moved`);
          this.notifications.emit('etl:file:done', { runId, filename: file.filename, url: result.wasabiUrl });
          uploaded++;
        } catch (err) {
          this.mover.moveToFailed(file.sourcePath, file.filename);
          await this.prisma.etlFile.update({
            where: { id: dbFile.id },
            data: { status: 'failed', errorMsg: err.message },
          });
          await this.log(runId, 'error', `✗ ${file.filename}: ${err.message}`);
          this.notifications.emit('etl:file:failed', { runId, filename: file.filename, error: err.message });
          failed++;
        }

        // Update run counters progressively
        await this.prisma.etlRun.update({
          where: { id: runId },
          data: { uploaded, failed, skipped },
        });
      }

      const finalStatus = failed > 0 && uploaded === 0 ? 'failed' : 'completed';
      await this.prisma.etlRun.update({
        where: { id: runId },
        data: { status: finalStatus, finishedAt: new Date(), uploaded, failed, skipped },
      });

      await this.log(runId, 'info', `ETL run ${finalStatus}: ${uploaded} uploaded, ${failed} failed, ${skipped} skipped`);
      this.notifications.emit('etl:completed', { runId, uploaded, failed, skipped, status: finalStatus });

      return { runId };
    } catch (err) {
      this.logger.error(`ETL run failed: ${err.message}`, err.stack);
      await this.log(runId, 'error', `ETL run aborted: ${err.message}`);
      await this.prisma.etlRun.update({
        where: { id: runId },
        data: { status: 'failed', finishedAt: new Date(), errorMsg: err.message },
      });
      this.notifications.emit('etl:failed', { runId, error: err.message });
      return { runId };
    } finally {
      this.running = false;
    }
  }

  async getStatus() {
    const lastRun = await this.prisma.etlRun.findFirst({
      orderBy: { startedAt: 'desc' },
    });
    const totalFiles     = await this.prisma.etlFile.count();
    const uploadedFiles  = await this.prisma.etlFile.count({ where: { status: { in: ['uploaded', 'moved'] } } });
    const failedFiles    = await this.prisma.etlFile.count({ where: { status: 'failed' } });

    return {
      running:       this.running,
      lastRun,
      totalFiles,
      uploadedFiles,
      failedFiles,
    };
  }

  async getRuns(page = 1, limit = 20) {
    const [data, total] = await Promise.all([
      this.prisma.etlRun.findMany({
        orderBy: { startedAt: 'desc' },
        skip:  (page - 1) * limit,
        take:  limit,
        include: { _count: { select: { files: true, logs: true } } },
      }),
      this.prisma.etlRun.count(),
    ]);
    return createPaginatedResult(data, total, page, limit);
  }

  async getFiles(runId?: string, page = 1, limit = 50) {
    const where = runId ? { runId } : {};
    const [data, total] = await Promise.all([
      this.prisma.etlFile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:  (page - 1) * limit,
        take:  limit,
      }),
      this.prisma.etlFile.count({ where }),
    ]);
    return createPaginatedResult(data, total, page, limit);
  }

  async getLogs(runId?: string, page = 1, limit = 100) {
    const where = runId ? { runId } : {};
    const [data, total] = await Promise.all([
      this.prisma.etlLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:  (page - 1) * limit,
        take:  limit,
      }),
      this.prisma.etlLog.count({ where }),
    ]);
    return createPaginatedResult(data, total, page, limit);
  }

  // Called by AlertsService to send instant alerts after ETL completion
  async getLastRunStats() {
    const run = await this.prisma.etlRun.findFirst({
      orderBy: { startedAt: 'desc' },
      where: { status: { in: ['completed', 'failed'] } },
    });
    return run;
  }

  private async log(runId: string, level: 'info' | 'warn' | 'error', message: string, metadata?: object) {
    await this.prisma.etlLog.create({ data: { runId, level, message, metadata } });
    this.notifications.emit('etl:log', { runId, level, message, timestamp: new Date().toISOString() });
  }

  private detectSource(filename: string): string {
    const upper = filename.toUpperCase();
    if (upper.includes('FIVE9')) return 'FIVE9';
    return 'GO_CONTACT';
  }

  private extractAgent(filename: string): string {
    // Attempt to parse agent name from filename pattern like: AGENT_NAME_DATE.mp3
    const parts = filename.replace(/\.[^.]+$/, '').split('_');
    if (parts.length >= 2) return parts.slice(0, 2).join(' ');
    return 'Unknown';
  }

  private extractPhone(filename: string): string {
    const match = filename.match(/\d{9,15}/);
    return match ? match[0] : '';
  }
}

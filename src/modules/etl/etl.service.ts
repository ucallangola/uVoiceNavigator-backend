import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
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
    private config:         ConfigService,
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
      let failedCount = 0;
      let skipped = 0;
      let retried = 0;

      // ── Retry previously failed files ─────────────────────────────────
      const failedFiles = await this.prisma.etlFile.findMany({
        where: { status: 'failed' },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });

      for (const failedFile of failedFiles) {
        let fileToProcess = failedFile.sourcePath;

        if (!fs.existsSync(failedFile.sourcePath)) {
          // Try failed dir
          const failedDir = this.config.get<string>('etl.failedDir');
          const basename = path.basename(failedFile.filename);
          const subdir = path.dirname(failedFile.filename);
          const inFailedDir = subdir && subdir !== '.'
            ? path.join(failedDir, subdir, basename)
            : path.join(failedDir, basename);

          if (!fs.existsSync(inFailedDir)) {
            await this.log(runId, 'warn', `Retry skip: file not found: ${failedFile.filename}`);
            continue;
          }

          // Move back to source for processing
          try {
            fs.renameSync(inFailedDir, failedFile.sourcePath);
          } catch {
            try {
              fs.copyFileSync(inFailedDir, failedFile.sourcePath);
              fs.unlinkSync(inFailedDir);
            } catch (e) {
              await this.log(runId, 'warn', `Cannot restore ${failedFile.filename} for retry: ${e.message}`);
              continue;
            }
          }
          fileToProcess = failedFile.sourcePath;
        }

        await this.prisma.etlFile.update({
          where: { id: failedFile.id },
          data: { status: 'pending', errorMsg: null, runId, attemptCount: { increment: 1 } },
        });
        await this.log(runId, 'info', `Retrying ${failedFile.filename} (attempt ${failedFile.attemptCount + 1})`);
        this.notifications.emit('etl:file:started', { runId, filename: failedFile.filename });

        try {
          const duration = await this.extractDuration(fileToProcess);
          const result = await this.uploader.upload(fileToProcess, failedFile.filename, failedFile.mimeType ?? 'audio/wav');
          const basename = path.basename(failedFile.filename);

          const existingAudio = await this.prisma.audio.findFirst({ where: { filename: basename } });
          if (!existingAudio) {
            await this.prisma.audio.create({
              data: {
                filename:      basename,
                source:        this.detectSource(basename),
                agentName:     this.extractAgent(basename),
                customerPhone: '', // customer phone not available in filename
                callId:        this.extractCallId(basename),
                duration,
                wasabiUrl:     result.wasabiUrl,
                fileSize:      failedFile.fileSize,
                status:        'processed',
                processedAt:   new Date(),
              },
            });
          } else {
            await this.prisma.audio.update({
              where: { id: existingAudio.id },
              data: {
                callId:      this.extractCallId(basename),
                wasabiUrl:   result.wasabiUrl,
                status:      'processed',
                processedAt: new Date(),
              },
            });
          }

          this.mover.moveToProcessed(fileToProcess, failedFile.filename);
          await this.prisma.etlFile.update({
            where: { id: failedFile.id },
            data: { wasabiKey: result.wasabiKey, wasabiUrl: result.wasabiUrl, status: 'moved', processedAt: new Date() },
          });
          await this.log(runId, 'info', `✓ Retry OK: ${failedFile.filename}`);
          this.notifications.emit('etl:file:done', { runId, filename: failedFile.filename, url: result.wasabiUrl });
          uploaded++;
          retried++;
        } catch (err) {
          this.mover.moveToFailed(fileToProcess, failedFile.filename);
          await this.prisma.etlFile.update({
            where: { id: failedFile.id },
            data: { status: 'failed', errorMsg: err.message },
          });
          await this.log(runId, 'error', `✗ Retry failed: ${failedFile.filename}: ${err.message}`);
          failedCount++;
        }

        await this.prisma.etlRun.update({ where: { id: runId }, data: { uploaded, failed: failedCount, retried } });
      }

      // ── Process new files ──────────────────────────────────────────────
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
          const duration = await this.extractDuration(file.sourcePath);
          const result = await this.uploader.upload(file.sourcePath, file.filename, file.mimeType);

          // Save to Audio table as well
          const basename = path.basename(file.filename);
          await this.prisma.audio.create({
            data: {
              filename:      basename,
              source:        this.detectSource(basename),
              agentName:     this.extractAgent(basename),
              customerPhone: '', // customer phone not available in Five9 filename
              callId:        this.extractCallId(basename),
              duration,
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

          // Persistent notification for individual file failure
          await this.prisma.notification.create({
            data: {
              type:         'etl:file:failed',
              title:        'Ficheiro falhou no ETL',
              message:      `${path.basename(file.filename)}: ${err.message}`,
              resourceType: 'etl_run',
              resourceId:   runId,
              read:         false,
            },
          });

          failedCount++;
        }

        // Update run counters progressively
        await this.prisma.etlRun.update({
          where: { id: runId },
          data: { uploaded, failed: failedCount, skipped },
        });
      }

      const finalStatus = failedCount > 0 && uploaded === 0 ? 'failed' : 'completed';
      await this.prisma.etlRun.update({
        where: { id: runId },
        data: { status: finalStatus, finishedAt: new Date(), uploaded, failed: failedCount, skipped },
      });

      await this.log(runId, 'info', `ETL run ${finalStatus}: ${uploaded} uploaded, ${failedCount} failed, ${skipped} skipped`);
      this.notifications.emit('etl:completed', { runId, uploaded, failed: failedCount, skipped, status: finalStatus });

      // Persistent notification for ETL run completion
      await this.prisma.notification.create({
        data: {
          type:         'etl:completed',
          title:        `ETL ${finalStatus === 'completed' ? 'Concluído' : 'Falhou'}`,
          message:      `${uploaded} enviados, ${failedCount} falhas, ${skipped} ignorados`,
          resourceType: 'etl_run',
          resourceId:   runId,
          read:         false,
        },
      });

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

  async getSchedule() {
    const schedule = await this.prisma.etlSchedule.findFirst({ orderBy: { createdAt: 'desc' } });
    return schedule ?? { enabled: false, cronExpression: '0 2 * * *', description: 'Executar às 02:00 todos os dias' };
  }

  async updateSchedule(data: { enabled: boolean; cronExpression: string; description?: string }) {
    const existing = await this.prisma.etlSchedule.findFirst();
    if (existing) {
      return this.prisma.etlSchedule.update({ where: { id: existing.id }, data });
    }
    return this.prisma.etlSchedule.create({ data });
  }

  private async log(runId: string, level: 'info' | 'warn' | 'error', message: string, metadata?: object) {
    await this.prisma.etlLog.create({ data: { runId, level, message, metadata } });
    this.notifications.emit('etl:log', { runId, level, message, timestamp: new Date().toISOString() });
  }

  private detectSource(_filename: string): string {
    return 'FIVE9';
  }

  private extractAgent(filename: string): string {
    const parts = filename.replace(/\.[^.]+$/, '').split('_');
    const emailPart = parts.find(p => p.includes('@'));
    if (emailPart) {
      const localPart = emailPart.split('@')[0];
      return localPart.split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
    return parts.length >= 2 ? parts.slice(0, 2).join(' ') : 'Unknown';
  }

  /**
   * Extracts the callId from a Five9 filename.
   * Filename format: {recordingId}_{callId}_{agentEmail}_{agentPhone}_{time}.ext
   * Example: 6290F70E..._100000000015497_agent@email.com_+244944149626_1_43_41 PM.wav
   *            → callId = "100000000015497"
   */
  private extractCallId(filename: string): string {
    const name = filename.replace(/\.[^.]+$/, ''); // strip extension
    const firstUnder = name.indexOf('_');
    if (firstUnder === -1) return '';
    const rest = name.slice(firstUnder + 1);
    const secondUnder = rest.indexOf('_');
    return secondUnder === -1 ? rest : rest.slice(0, secondUnder);
  }

  private async extractDuration(filePath: string): Promise<number> {
    try {
      const mm = await import('music-metadata');
      const metadata = await mm.parseFile(filePath, { duration: true });
      return Math.round(metadata.format.duration ?? 0);
    } catch {
      return 0;
    }
  }
}

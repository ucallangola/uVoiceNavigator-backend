import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertDto } from './dto/update-alert.dto';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
  ) {
    this.transporter = nodemailer.createTransport({
      host:    this.configService.get<string>('smtp.host'),
      port:    this.configService.get<number>('smtp.port'),
      secure:  this.configService.get<boolean>('smtp.secure'),
      auth: {
        user: this.configService.get<string>('smtp.user'),
        pass: this.configService.get<string>('smtp.pass'),
      },
      tls: { rejectUnauthorized: false },
    });
  }

  async findAll() {
    return this.prisma.emailAlert.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const alert = await this.prisma.emailAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException(`Email alert with ID ${id} not found`);
    return alert;
  }

  async create(createAlertDto: CreateAlertDto) {
    return this.prisma.emailAlert.create({ data: createAlertDto });
  }

  async update(id: string, updateAlertDto: UpdateAlertDto) {
    await this.findOne(id);
    return this.prisma.emailAlert.update({ where: { id }, data: updateAlertDto });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.emailAlert.delete({ where: { id } });
    return { message: `Alert ${id} deleted successfully` };
  }

  async sendTestEmail(id: string) {
    const alert = await this.findOne(id);
    const stats = await this.buildEmailReport();
    await this.sendAlertEmail(alert.recipientEmail, stats, true);
    return { message: `Test email sent successfully to ${alert.recipientEmail}` };
  }

  // ── Periodic: called by the jobs scheduler ───────────────────────────────
  async processScheduledAlerts() {
    const enabledAlerts = await this.prisma.emailAlert.findMany({
      where: { enabled: true, alertType: 'periodic' },
    });

    for (const alert of enabledAlerts) {
      if (!alert.schedule) continue;
      if (this.shouldSendNow(alert.schedule, alert.lastSent)) {
        try {
          const stats = await this.buildEmailReport();
          await this.sendAlertEmail(alert.recipientEmail, stats, false);
          await this.prisma.emailAlert.update({
            where: { id: alert.id },
            data: { lastSent: new Date() },
          });
          this.notificationsService.emit('alert:sent', { alertId: alert.id, email: alert.recipientEmail });
          this.notificationsService.emit('dashboard:refresh', {});
          this.logger.log(`Periodic alert sent to ${alert.recipientEmail}`);
        } catch (error) {
          this.logger.error(`Failed to send alert to ${alert.recipientEmail}: ${error.message}`);
        }
      }
    }
  }

  // ── Instant: called by EtlService after a run completes ─────────────────
  async sendInstantAlertsForEtl(etlStats: {
    runId: string;
    uploaded: number;
    failed: number;
    skipped: number;
    status: string;
  }) {
    const enabledAlerts = await this.prisma.emailAlert.findMany({
      where: { enabled: true, alertType: 'instant' },
    });

    if (!enabledAlerts.length) return;

    const audioStats = await this.buildEmailReport();

    for (const alert of enabledAlerts) {
      try {
        await this.sendEtlAlertEmail(alert.recipientEmail, audioStats, etlStats);
        await this.prisma.emailAlert.update({
          where: { id: alert.id },
          data: { lastSent: new Date() },
        });
        this.logger.log(`Instant ETL alert sent to ${alert.recipientEmail}`);
      } catch (error) {
        this.logger.error(`Failed instant alert to ${alert.recipientEmail}: ${error.message}`);
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private shouldSendNow(cronExpression: string, lastSent: Date | null): boolean {
    try {
      const now   = new Date();
      const parts = cronExpression.split(' ');
      if (parts.length < 5) return false;

      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
      const matchesMinute     = minute     === '*' || parseInt(minute)     === now.getMinutes();
      const matchesHour       = hour       === '*' || parseInt(hour)       === now.getHours();
      const matchesDayOfMonth = dayOfMonth === '*' || parseInt(dayOfMonth) === now.getDate();
      const matchesMonth      = month      === '*' || parseInt(month)      === now.getMonth() + 1;

      let matchesDayOfWeek = true;
      if (dayOfWeek !== '*') {
        const days = dayOfWeek.split('-').map(Number);
        matchesDayOfWeek = days.length === 2
          ? now.getDay() >= days[0] && now.getDay() <= days[1]
          : now.getDay() === parseInt(dayOfWeek);
      }

      return matchesMinute && matchesHour && matchesDayOfMonth && matchesMonth && matchesDayOfWeek;
    } catch {
      return false;
    }
  }

  private async buildEmailReport() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalAudiosToday, pendingAudios, processedAudios, failedAudios] = await Promise.all([
      this.prisma.audio.count({ where: { uploadedAt: { gte: today } } }),
      this.prisma.audio.count({ where: { status: 'pending' } }),
      this.prisma.audio.count({ where: { status: 'processed' } }),
      this.prisma.audio.count({ where: { status: 'error' } }),
    ]);

    return { totalAudiosToday, pendingAudios, processedAudios, failedAudios, reportDate: new Date().toISOString() };
  }

  private async sendAlertEmail(recipientEmail: string, stats: any, isTest: boolean): Promise<void> {
    const subject = isTest
      ? '[TEST] uVoice Navigator - Alerta de Teste'
      : `uVoice Navigator - Relatório Periódico ${new Date().toLocaleDateString('pt-PT')}`;

    await this.transporter.sendMail({
      from: `"${this.configService.get<string>('smtp.fromName')}" <${this.configService.get<string>('smtp.fromEmail')}>`,
      to: recipientEmail,
      subject,
      html: this.buildHtml(stats, isTest),
    });
  }

  private async sendEtlAlertEmail(recipientEmail: string, audioStats: any, etlStats: any): Promise<void> {
    const subject = `uVoice Navigator - ETL ${etlStats.status === 'completed' ? '✓ Concluído' : '✗ Falhou'} — ${new Date().toLocaleString('pt-PT')}`;

    const etlSection = `
      <h2>Resultado do ETL</h2>
      <div class="stat-row"><span class="stat-label">Status</span>
        <span class="stat-value" style="color:${etlStats.status === 'completed' ? '#16a34a' : '#dc2626'}">${etlStats.status}</span></div>
      <div class="stat-row"><span class="stat-label">Ficheiros enviados</span><span class="stat-value">${etlStats.uploaded}</span></div>
      <div class="stat-row"><span class="stat-label">Falhas</span><span class="stat-value">${etlStats.failed}</span></div>
      <div class="stat-row"><span class="stat-label">Ignorados (duplicados)</span><span class="stat-value">${etlStats.skipped}</span></div>
      <div class="stat-row"><span class="stat-label">Run ID</span><span style="font-size:11px;color:#6b7280">${etlStats.runId}</span></div>
    `;

    await this.transporter.sendMail({
      from: `"${this.configService.get<string>('smtp.fromName')}" <${this.configService.get<string>('smtp.fromEmail')}>`,
      to: recipientEmail,
      subject,
      html: this.buildHtml(audioStats, false, etlSection),
    });
  }

  private buildHtml(stats: any, isTest: boolean, extra = ''): string {
    return `
      <!DOCTYPE html><html><head><meta charset="utf-8">
      <style>
        body{font-family:Arial,sans-serif;color:#333}
        .container{max-width:600px;margin:0 auto;padding:20px}
        .header{background-color:#1a56db;color:white;padding:20px;border-radius:8px 8px 0 0}
        .content{background-color:#f9fafb;padding:20px;border:1px solid #e5e7eb}
        .stat-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #e5e7eb}
        .stat-label{font-weight:bold}
        .stat-value{color:#1a56db;font-size:18px;font-weight:bold}
        .footer{text-align:center;padding:15px;color:#6b7280;font-size:12px}
      </style></head><body>
      <div class="container">
        <div class="header">
          <h1>uVoice Navigator${isTest ? ' [TEST]' : ''}</h1>
          <p>${new Date().toLocaleDateString('pt-PT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div class="content">
          ${extra}
          <h2>Resumo de Áudios</h2>
          <div class="stat-row"><span class="stat-label">Áudios processados hoje</span><span class="stat-value">${stats.totalAudiosToday}</span></div>
          <div class="stat-row"><span class="stat-label">Total processados</span><span class="stat-value">${stats.processedAudios}</span></div>
          <div class="stat-row"><span class="stat-label">Pendentes</span><span class="stat-value">${stats.pendingAudios}</span></div>
          <div class="stat-row"><span class="stat-label">Com erros</span><span class="stat-value">${stats.failedAudios}</span></div>
        </div>
        <div class="footer">
          <p>Gerado automaticamente pelo uVoice Navigator em ${new Date().toLocaleString('pt-PT')}</p>
        </div>
      </div></body></html>
    `;
  }
}

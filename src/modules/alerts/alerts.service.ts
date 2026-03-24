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
    const stats = await this.buildDailyReport();
    await this.sendScheduledEmail(alert.recipientEmail, stats, true);
    return { message: `Test email sent successfully to ${alert.recipientEmail}` };
  }

  // ── Scheduled: called by the jobs scheduler ───────────────────────────
  async processScheduledAlerts() {
    const now = new Date();
    const enabledAlerts = await this.prisma.emailAlert.findMany({
      where: { enabled: true, alertType: 'scheduled' },
    });

    for (const alert of enabledAlerts) {
      if (alert.sendHour === null || alert.sendHour !== now.getHours()) continue;

      // Check not already sent today
      if (alert.lastSent) {
        const lastSentDate = new Date(alert.lastSent);
        if (lastSentDate.toDateString() === now.toDateString()) continue;
      }

      try {
        const stats = await this.buildDailyReport();
        await this.sendScheduledEmail(alert.recipientEmail, stats);
        await this.prisma.emailAlert.update({ where: { id: alert.id }, data: { lastSent: now } });
        this.notificationsService.emit('alert:sent', { alertId: alert.id, email: alert.recipientEmail });
        this.logger.log(`Scheduled alert sent to ${alert.recipientEmail}`);
      } catch (error) {
        this.logger.error(`Failed scheduled alert to ${alert.recipientEmail}: ${error.message}`);
      }
    }
  }

  // ── Instant: called by AudiosService on play/download ───────────────
  async sendInstantAlertsForAudioAccess(info: {
    audioId:   string;
    filename:  string;
    action:    string;
    userName:  string | null;
    userEmail: string | null;
    ipAddress: string | undefined;
  }) {
    const enabledAlerts = await this.prisma.emailAlert.findMany({
      where: { enabled: true, alertType: 'instant' },
    });

    if (!enabledAlerts.length) return;

    const actionLabel = info.action === 'play' ? 'reproduzido' : 'descarregado';
    const subject = `uVoice Navigator — Áudio ${actionLabel}: ${info.filename}`;

    const html = `
      <!DOCTYPE html><html><head><meta charset="utf-8">
      <style>
        body{font-family:Arial,sans-serif;color:#333}
        .container{max-width:600px;margin:0 auto;padding:20px}
        .header{background-color:#1a56db;color:white;padding:20px;border-radius:8px 8px 0 0}
        .content{background-color:#f9fafb;padding:20px;border:1px solid #e5e7eb}
        .stat-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #e5e7eb}
        .stat-label{font-weight:bold;color:#374151}
        .stat-value{color:#1a56db}
        .footer{text-align:center;padding:15px;color:#6b7280;font-size:12px}
      </style></head><body>
      <div class="container">
        <div class="header">
          <h1>uVoice Navigator</h1>
          <p>Acesso a Áudio — ${new Date().toLocaleString('pt-PT')}</p>
        </div>
        <div class="content">
          <h2>Ficheiro ${actionLabel}</h2>
          <div class="stat-row"><span class="stat-label">Ficheiro</span><span class="stat-value">${info.filename}</span></div>
          <div class="stat-row"><span class="stat-label">Ação</span><span class="stat-value">${info.action === 'play' ? 'Reprodução' : 'Download'}</span></div>
          <div class="stat-row"><span class="stat-label">Utilizador</span><span class="stat-value">${info.userName ?? '—'}</span></div>
          <div class="stat-row"><span class="stat-label">Email</span><span class="stat-value">${info.userEmail ?? '—'}</span></div>
          <div class="stat-row"><span class="stat-label">IP</span><span class="stat-value">${info.ipAddress ?? '—'}</span></div>
          <div class="stat-row"><span class="stat-label">ID do Áudio</span><span style="font-size:11px;color:#6b7280">${info.audioId}</span></div>
        </div>
        <div class="footer">
          <p>Gerado automaticamente pelo uVoice Navigator em ${new Date().toLocaleString('pt-PT')}</p>
        </div>
      </div></body></html>
    `;

    for (const alert of enabledAlerts) {
      try {
        await this.transporter.sendMail({
          from: `"${this.configService.get<string>('smtp.fromName')}" <${this.configService.get<string>('smtp.fromEmail')}>`,
          to:      alert.recipientEmail,
          subject,
          html,
        });
        this.logger.log(`Audio access alert sent to ${alert.recipientEmail}`);
      } catch (error) {
        this.logger.error(`Failed audio access alert to ${alert.recipientEmail}: ${error.message}`);
      }
    }
  }

  // ── Instant: called by EtlService after a run completes ─────────────
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

    // Fetch the per-file details for this run (cap at 100 rows to keep email manageable)
    const etlFiles = await this.prisma.etlFile.findMany({
      where:   { runId: etlStats.runId },
      orderBy: { createdAt: 'asc' },
      take:    100,
    });

    // Bulk-fetch matching Audio rows to get agentName and source
    const filenames = etlFiles.map(f => f.filename);
    const audioRows = await this.prisma.audio.findMany({
      where:  { filename: { in: filenames } },
      select: { filename: true, agentName: true, source: true },
    });
    const audioByFilename = new Map(audioRows.map(a => [a.filename, a]));

    for (const alert of enabledAlerts) {
      try {
        await this.sendEtlAlertEmail(alert.recipientEmail, etlStats, etlFiles, audioByFilename);
        await this.prisma.emailAlert.update({
          where: { id: alert.id },
          data:  { lastSent: new Date() },
        });
        this.logger.log(`Instant ETL alert sent to ${alert.recipientEmail}`);
      } catch (error) {
        this.logger.error(`Failed instant alert to ${alert.recipientEmail}: ${error.message}`);
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  private async buildDailyReport(isTest = false) {
    const yesterday = new Date();
    if (!isTest) {
      yesterday.setDate(yesterday.getDate() - 1);
    }
    yesterday.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);

    const runs = await this.prisma.etlRun.findMany({
      where: { startedAt: { gte: yesterday, lte: yesterdayEnd } },
      orderBy: { startedAt: 'asc' },
    });

    const totals = runs.reduce((acc, r) => ({
      uploaded: acc.uploaded + r.uploaded,
      failed:   acc.failed   + r.failed,
      skipped:  acc.skipped  + r.skipped,
    }), { uploaded: 0, failed: 0, skipped: 0 });

    return { runs, totals, date: yesterday.toLocaleDateString('pt-PT') };
  }

  private async sendScheduledEmail(recipientEmail: string, stats: any, isTest = false): Promise<void> {
    const subject = isTest
      ? '[TEST] uVoice Navigator - Alerta de Teste'
      : `uVoice Navigator - Relatório Diário ${stats.date}`;

    await this.transporter.sendMail({
      from: `"${this.configService.get<string>('smtp.fromName')}" <${this.configService.get<string>('smtp.fromEmail')}>`,
      to: recipientEmail,
      subject,
      html: this.buildDailyHtml(stats, isTest),
    });
  }

  private async sendEtlAlertEmail(
    recipientEmail: string,
    etlStats: { runId: string; uploaded: number; failed: number; skipped: number; status: string },
    etlFiles: Array<{ filename: string; status: string; errorMsg?: string | null }>,
    audioByFilename: Map<string, { agentName: string; source: string }>,
  ): Promise<void> {
    const statusIcon = etlStats.status === 'completed' ? '✓ Concluído' : '✗ Falhou';
    const subject    = `uVoice Navigator — ETL ${statusIcon} — ${new Date().toLocaleString('pt-PT')}`;
    const html       = this.buildEtlHtml(etlStats, etlFiles, audioByFilename);

    await this.transporter.sendMail({
      from: `"${this.configService.get<string>('smtp.fromName')}" <${this.configService.get<string>('smtp.fromEmail')}>`,
      to:      recipientEmail,
      subject,
      html,
    });
  }

  private buildDailyHtml(stats: any, isTest: boolean): string {
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
          <p>Relatório de ${stats.date}</p>
        </div>
        <div class="content">
          <h2>Resumo ETL</h2>
          <div class="stat-row"><span class="stat-label">Ficheiros enviados</span><span class="stat-value">${stats.totals.uploaded}</span></div>
          <div class="stat-row"><span class="stat-label">Falhas</span><span class="stat-value">${stats.totals.failed}</span></div>
          <div class="stat-row"><span class="stat-label">Ignorados</span><span class="stat-value">${stats.totals.skipped}</span></div>
          <div class="stat-row"><span class="stat-label">Execuções ETL</span><span class="stat-value">${stats.runs.length}</span></div>
        </div>
        <div class="footer">
          <p>Gerado automaticamente pelo uVoice Navigator em ${new Date().toLocaleString('pt-PT')}</p>
        </div>
      </div></body></html>
    `;
  }

  private buildEtlHtml(
    etlStats: { runId: string; uploaded: number; failed: number; skipped: number; status: string },
    etlFiles: Array<{ filename: string; status: string; errorMsg?: string | null }>,
    audioByFilename: Map<string, { agentName: string; source: string }>,
  ): string {
    const total     = etlStats.uploaded + etlStats.failed + etlStats.skipped;
    const dateLabel = new Date().toLocaleDateString('pt-PT');
    const statusColor = etlStats.status === 'completed' ? '#16a34a' : '#dc2626';
    const truncated   = etlFiles.length === 100;

    const rows = etlFiles.map(f => {
      const audio      = audioByFilename.get(f.filename);
      const agentName  = audio?.agentName ?? '—';
      const source     = audio?.source    ?? '—';
      const isOk       = f.status === 'uploaded' || f.status === 'moved';
      const stateHtml  = isOk
        ? `<span style="color:#16a34a;font-weight:600">✓ OK</span>`
        : `<span style="color:#dc2626;font-weight:600" title="${f.errorMsg ?? ''}">✗ Erro</span>`;

      return `
        <tr style="border-bottom:1px solid #e5e7eb">
          <td style="padding:6px 4px;font-family:monospace;font-size:11px">${f.filename}</td>
          <td style="padding:6px 4px;font-size:12px">${agentName}</td>
          <td style="padding:6px 4px;font-size:12px">${source}</td>
          <td style="padding:6px 4px;font-size:12px">${stateHtml}</td>
        </tr>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>uVoice Navigator — ETL</title></head>
<body style="font-family:Arial,sans-serif;color:#333;margin:0;padding:0;background:#f3f4f6">
<div style="max-width:680px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.12)">

  <!-- Header -->
  <div style="background:#1a56db;color:#fff;padding:20px 24px">
    <h1 style="margin:0 0 4px;font-size:20px">uVoice Navigator</h1>
    <p style="margin:0;font-size:13px;opacity:.85">ETL concluído em ${new Date().toLocaleString('pt-PT')}</p>
  </div>

  <!-- Body -->
  <div style="padding:24px">

    <!-- Status badge -->
    <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:${statusColor}">
      ${etlStats.status === 'completed' ? '✓ Processamento concluído com sucesso' : '✗ Processamento concluído com erros'}
    </p>

    <!-- Summary heading -->
    <p style="margin:0 0 10px;font-weight:600;color:#111">Resumo de Processamento — ${dateLabel}</p>

    <!-- 3-column stat grid -->
    <table width="100%" cellpadding="0" cellspacing="8" style="margin-bottom:20px">
      <tr>
        <td width="33%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;text-align:center;padding:12px 8px">
          <p style="margin:0;font-size:22px;font-weight:700;color:#1a56db">${total}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#6b7280">Processados</p>
        </td>
        <td width="33%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;text-align:center;padding:12px 8px">
          <p style="margin:0;font-size:22px;font-weight:700;color:#16a34a">${etlStats.uploaded}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#6b7280">Sucesso</p>
        </td>
        <td width="33%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;text-align:center;padding:12px 8px">
          <p style="margin:0;font-size:22px;font-weight:700;color:#dc2626">${etlStats.failed}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#6b7280">Erros</p>
        </td>
      </tr>
    </table>

    <!-- Per-file table -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="border-bottom:2px solid #e5e7eb">
          <th style="text-align:left;padding:6px 4px;color:#6b7280;font-weight:600">Ficheiro</th>
          <th style="text-align:left;padding:6px 4px;color:#6b7280;font-weight:600">Agente</th>
          <th style="text-align:left;padding:6px 4px;color:#6b7280;font-weight:600">Fonte</th>
          <th style="text-align:left;padding:6px 4px;color:#6b7280;font-weight:600">Estado</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="4" style="padding:10px 4px;color:#6b7280">Sem ficheiros neste run.</td></tr>'}
      </tbody>
    </table>
    ${truncated ? `<p style="margin:8px 0 0;font-size:11px;color:#6b7280">* Mostrando os primeiros 100 ficheiros. Run ID: ${etlStats.runId}</p>` : `<p style="margin:8px 0 0;font-size:11px;color:#6b7280">Run ID: ${etlStats.runId}</p>`}

  </div>

  <!-- Footer -->
  <div style="border-top:1px solid #e5e7eb;padding:12px 24px;text-align:center;color:#9ca3af;font-size:11px">
    Gerado automaticamente pelo uVoice Navigator em ${new Date().toLocaleString('pt-PT')}
  </div>

</div>
</body></html>`;
  }
}

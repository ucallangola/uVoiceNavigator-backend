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
      host: this.configService.get<string>('smtp.host'),
      port: this.configService.get<number>('smtp.port'),
      secure: this.configService.get<boolean>('smtp.secure'),
      auth: {
        user: this.configService.get<string>('smtp.user'),
        pass: this.configService.get<string>('smtp.pass'),
      },
      tls: { rejectUnauthorized: false },
    });
  }

  async findAll() {
    return this.prisma.emailAlert.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const alert = await this.prisma.emailAlert.findUnique({ where: { id } });

    if (!alert) {
      throw new NotFoundException(`Email alert with ID ${id} not found`);
    }

    return alert;
  }

  async create(createAlertDto: CreateAlertDto) {
    return this.prisma.emailAlert.create({
      data: createAlertDto,
    });
  }

  async update(id: string, updateAlertDto: UpdateAlertDto) {
    await this.findOne(id);

    return this.prisma.emailAlert.update({
      where: { id },
      data: updateAlertDto,
    });
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

  async processScheduledAlerts() {
    const enabledAlerts = await this.prisma.emailAlert.findMany({
      where: { enabled: true },
    });

    for (const alert of enabledAlerts) {
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
          this.logger.log(`Alert sent successfully to ${alert.recipientEmail}`);
        } catch (error) {
          this.logger.error(`Failed to send alert to ${alert.recipientEmail}: ${error.message}`);
        }
      }
    }
  }

  private shouldSendNow(cronExpression: string, lastSent: Date | null): boolean {
    // Simple implementation: check if the cron matches current time
    // In production, use a proper cron parser like 'cronstrue' or 'cron-parser'
    try {
      const now = new Date();
      const parts = cronExpression.split(' ');

      if (parts.length < 5) return false;

      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

      const matchesMinute = minute === '*' || parseInt(minute) === now.getMinutes();
      const matchesHour = hour === '*' || parseInt(hour) === now.getHours();
      const matchesDayOfMonth = dayOfMonth === '*' || parseInt(dayOfMonth) === now.getDate();
      const matchesMonth = month === '*' || parseInt(month) === now.getMonth() + 1;

      let matchesDayOfWeek = true;
      if (dayOfWeek !== '*') {
        const days = dayOfWeek.split('-').map(Number);
        if (days.length === 2) {
          matchesDayOfWeek = now.getDay() >= days[0] && now.getDay() <= days[1];
        } else {
          matchesDayOfWeek = now.getDay() === parseInt(dayOfWeek);
        }
      }

      return matchesMinute && matchesHour && matchesDayOfMonth && matchesMonth && matchesDayOfWeek;
    } catch {
      return false;
    }
  }

  private async buildEmailReport() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalAudiosToday,
      totalInteractions,
      totalInbound,
      totalOutbound,
      totalAbandoned,
      pendingAudios,
    ] = await Promise.all([
      this.prisma.audio.count({ where: { uploadedAt: { gte: today } } }),
      this.prisma.interaction.count(),
      this.prisma.interaction.count({ where: { recordType: 'inbound' } }),
      this.prisma.interaction.count({ where: { recordType: 'outbound' } }),
      this.prisma.interaction.count({ where: { abandoned: true } }),
      this.prisma.audio.count({ where: { status: 'pending' } }),
    ]);

    return {
      totalAudiosToday,
      totalInteractions,
      totalInbound,
      totalOutbound,
      totalAbandoned,
      pendingAudios,
      reportDate: new Date().toISOString(),
    };
  }

  private async sendAlertEmail(
    recipientEmail: string,
    stats: any,
    isTest: boolean,
  ): Promise<void> {
    const subject = isTest
      ? '[TEST] uVoice Navigator - Email Alert Test'
      : `uVoice Navigator - Daily Report ${new Date().toLocaleDateString('pt-BR')}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #1a56db; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background-color: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
          .stat-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
          .stat-label { font-weight: bold; }
          .stat-value { color: #1a56db; font-size: 18px; font-weight: bold; }
          .footer { text-align: center; padding: 15px; color: #6b7280; font-size: 12px; }
          .badge { background-color: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>uVoice Navigator${isTest ? ' <span class="badge">TEST</span>' : ''}</h1>
            <p>Relatório Diário - ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <div class="content">
            <h2>Resumo de Áudios</h2>
            <div class="stat-row">
              <span class="stat-label">Áudios processados hoje</span>
              <span class="stat-value">${stats.totalAudiosToday}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Áudios pendentes</span>
              <span class="stat-value">${stats.pendingAudios}</span>
            </div>
            <h2>Resumo de Interações</h2>
            <div class="stat-row">
              <span class="stat-label">Total de interações</span>
              <span class="stat-value">${stats.totalInteractions}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Chamadas receptivas (inbound)</span>
              <span class="stat-value">${stats.totalInbound}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Chamadas ativas (outbound)</span>
              <span class="stat-value">${stats.totalOutbound}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Chamadas abandonadas</span>
              <span class="stat-value">${stats.totalAbandoned}</span>
            </div>
          </div>
          <div class="footer">
            <p>Este email foi enviado automaticamente pelo sistema uVoice Navigator.</p>
            <p>Gerado em: ${new Date().toLocaleString('pt-BR')}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const info = await this.transporter.sendMail({
      from: `"${this.configService.get<string>('smtp.fromName')}" <${this.configService.get<string>('smtp.fromEmail')}>`,
      to: recipientEmail,
      subject,
      html,
    });

    this.logger.log(`Email sent to ${recipientEmail} — MessageId: ${info.messageId} | Response: ${info.response}`);
  }
}

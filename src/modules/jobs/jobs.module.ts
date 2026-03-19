import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { AlertsModule } from '../alerts/alerts.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AUDIO_PROCESSING_QUEUE } from './processors/audio-processing.processor';
import { EMAIL_ALERT_QUEUE } from './processors/email-alert.processor';
import { AudioProcessingProcessor } from './processors/audio-processing.processor';
import { EmailAlertProcessor } from './processors/email-alert.processor';
import { JobsService } from './jobs.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.registerQueue(
      { name: EMAIL_ALERT_QUEUE },
      { name: AUDIO_PROCESSING_QUEUE },
    ),
    AlertsModule,
    DashboardModule,
    NotificationsModule,
  ],
  providers: [
    JobsService,
    EmailAlertProcessor,
    AudioProcessingProcessor,
    PrismaService,
  ],
  exports: [JobsService],
})
export class JobsModule {}

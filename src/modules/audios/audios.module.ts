import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { MssqlService } from '../../database/mssql.service';
import { UploaderService } from '../etl/services/uploader.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AlertsModule } from '../alerts/alerts.module';
import { AudiosController } from './audios.controller';
import { AudiosService } from './audios.service';

@Module({
  imports: [ConfigModule, NotificationsModule, AlertsModule],
  controllers: [AudiosController],
  providers: [AudiosService, PrismaService, MssqlService, UploaderService],
  exports: [AudiosService],
})
export class AudiosModule {}

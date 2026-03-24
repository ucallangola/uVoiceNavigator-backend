import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { EtlService } from './etl.service';
import { EtlScheduler } from './etl.scheduler';
import { EtlController } from './etl.controller';
import { ScannerService } from './services/scanner.service';
import { UploaderService } from './services/uploader.service';
import { MoverService } from './services/mover.service';

@Module({
  imports: [NotificationsModule, ConfigModule],
  controllers: [EtlController],
  providers: [
    PrismaService,
    EtlService,
    EtlScheduler,
    ScannerService,
    UploaderService,
    MoverService,
  ],
  exports: [EtlService],
})
export class EtlModule {}

import { Module } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MssqlService } from '../../database/mssql.service';
import { AudiosController } from './audios.controller';
import { AudiosService } from './audios.service';

@Module({
  controllers: [AudiosController],
  providers: [AudiosService, PrismaService, MssqlService],
  exports: [AudiosService],
})
export class AudiosModule {}

import { Module } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MssqlService } from '../../database/mssql.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers:   [DashboardService, PrismaService, MssqlService],
  exports:     [DashboardService],
})
export class DashboardModule {}

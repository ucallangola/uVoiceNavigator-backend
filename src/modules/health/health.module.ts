import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaService } from '../../database/prisma.service';
import { MssqlService } from '../../database/mssql.service';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health-indicator';
import { MssqlHealthIndicator } from './mssql.health-indicator';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator,
    MssqlHealthIndicator,
    PrismaService,
    MssqlService,
  ],
})
export class HealthModule {}

import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaHealthIndicator } from './prisma.health-indicator';
import { MssqlHealthIndicator } from './mssql.health-indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health:          HealthCheckService,
    private prismaIndicator: PrismaHealthIndicator,
    private mssqlIndicator:  MssqlHealthIndicator,
    private memory:          MemoryHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Check API health status (database, SQL Server, memory)' })
  @ApiResponse({ status: 200, description: 'All systems healthy.' })
  @ApiResponse({ status: 503, description: 'One or more systems unhealthy.' })
  check() {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('postgres'),
      () => this.mssqlIndicator.isHealthy('sqlserver'),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss',  1024 * 1024 * 1024),
    ]);
  }
}

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Get dashboard statistics for a given period' })
  @ApiQuery({
    name: 'period',
    required: false,
    description: 'Time period',
    enum: ['7d', '14d', '30d', '90d'],
    example: '7d',
  })
  @ApiResponse({ status: 200, description: 'Dashboard statistics.' })
  getStats(@Query('period') period: string = '7d') {
    return this.dashboardService.getStats(period);
  }

  @Get('trends')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Get daily trend data for a given period' })
  @ApiQuery({
    name: 'period',
    required: false,
    description: 'Time period',
    enum: ['7d', '14d', '30d', '90d'],
    example: '7d',
  })
  @ApiResponse({ status: 200, description: 'Daily trend data array.' })
  getTrends(@Query('period') period: string = '7d') {
    return this.dashboardService.getTrends(period);
  }

  @Get('hourly')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Get hourly interaction and audio volume data for today' })
  @ApiResponse({ status: 200, description: 'Hourly volume data (24 entries).' })
  getHourlyData() {
    return this.dashboardService.getHourlyData();
  }

  @Get('agents')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Get top agents statistics for a given period' })
  @ApiQuery({
    name: 'period',
    required: false,
    description: 'Time period',
    enum: ['7d', '14d', '30d', '90d'],
    example: '7d',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of top agents to return',
    example: 10,
  })
  @ApiResponse({ status: 200, description: 'Top agents statistics.' })
  getTopAgents(
    @Query('period') period: string = '7d',
    @Query('limit') limit: number = 10,
  ) {
    return this.dashboardService.getTopAgents(period, Number(limit) || 10);
  }

  @Get('sources')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Get audio source distribution (GO_CONTACT vs FIVE9)' })
  @ApiResponse({ status: 200, description: 'Audio source distribution.' })
  getSourceDistribution() {
    return this.dashboardService.getSourceDistribution();
  }
}

import {
  Controller, Get, Post, Query, Param, ParseIntPipe, DefaultValuePipe, Sse,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { MessageEvent } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { EtlService } from './etl.service';
import { NotificationsService } from '../notifications/notifications.service';

@ApiTags('ETL')
@ApiBearerAuth()
@Controller('etl')
export class EtlController {
  constructor(
    private etlService:          EtlService,
    private notificationsService: NotificationsService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Get ETL pipeline status' })
  async getStatus() {
    return this.etlService.getStatus();
  }

  @Post('run')
  @ApiOperation({ summary: 'Manually trigger an ETL run' })
  async triggerRun() {
    if (this.etlService.isRunning()) {
      return { message: 'ETL already running', running: true };
    }
    // Fire and forget — return immediately
    this.etlService.run('manual').catch(() => {});
    return { message: 'ETL run started', running: true };
  }

  @Get('runs')
  @ApiOperation({ summary: 'List ETL run history' })
  @ApiQuery({ name: 'page',  required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getRuns(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.etlService.getRuns(page, limit);
  }

  @Get('files')
  @ApiOperation({ summary: 'List ETL files' })
  @ApiQuery({ name: 'runId', required: false })
  @ApiQuery({ name: 'page',  required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getFiles(
    @Query('runId') runId?: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number = 50,
  ) {
    return this.etlService.getFiles(runId, page, limit);
  }

  @Get('logs')
  @ApiOperation({ summary: 'List ETL logs' })
  @ApiQuery({ name: 'runId', required: false })
  @ApiQuery({ name: 'page',  required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getLogs(
    @Query('runId') runId?: string,
    @Query('page',  new DefaultValuePipe(1),   ParseIntPipe) page:  number = 1,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number = 100,
  ) {
    return this.etlService.getLogs(runId, page, limit);
  }

  @Sse('stream')
  @Public()
  @ApiOperation({ summary: 'SSE stream for real-time ETL events' })
  stream(): Observable<MessageEvent> {
    return this.notificationsService.getStream();
  }
}

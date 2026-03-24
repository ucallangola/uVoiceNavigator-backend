import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions, Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AudiosService } from './audios.service';
import { CreateAudioDto } from './dto/create-audio.dto';
import { QueryAudiosDto } from './dto/query-audios.dto';

@ApiTags('audios')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('audios')
export class AudiosController {
  constructor(private readonly audiosService: AudiosService) {}

  @Get()
  @Permissions('audios:read')
  @ApiOperation({ summary: 'List audio files with pagination and filters' })
  @ApiResponse({ status: 200, description: 'Paginated list of audio files.' })
  findAll(@Query() query: QueryAudiosDto) {
    return this.audiosService.findAll(query);
  }

  @Get('dashboard-stats')
  @Permissions('audios:read')
  @ApiOperation({ summary: 'Get dashboard statistics for audio files and interactions' })
  @ApiResponse({ status: 200, description: 'Dashboard stats.' })
  getDashboardStats() {
    return this.audiosService.getDashboardStats();
  }

  @Get('access-logs')
  @Permissions('audios:manage')
  @ApiOperation({ summary: 'Get audio access logs' })
  async getAccessLogs(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.audiosService.getAccessLogs(page, limit);
  }

  @Get(':id/stream')
  @Permissions('audios:read')
  @ApiOperation({ summary: 'Stream audio transcoded to PCM WAV (browser-compatible)' })
  @ApiParam({ name: 'id', description: 'Audio UUID' })
  async streamAudio(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { body, contentType } = await this.audiosService.streamAudio(id);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');

    res.status(200);
    (body as Readable).pipe(res);
  }

  @Get(':id/stream-url')
  @Permissions('audios:read')
  @ApiOperation({ summary: 'Get a pre-signed Wasabi URL for streaming/downloading an audio file' })
  @ApiParam({ name: 'id', description: 'Audio UUID' })
  @ApiResponse({ status: 200, description: 'Pre-signed URL (expires in 1 hour).' })
  getStreamUrl(@Param('id') id: string) {
    return this.audiosService.getStreamUrl(id);
  }

  @Get(':id')
  @Permissions('audios:read')
  @ApiOperation({ summary: 'Get audio file by ID' })
  @ApiParam({ name: 'id', description: 'Audio UUID' })
  @ApiResponse({ status: 200, description: 'Audio file found.' })
  @ApiResponse({ status: 404, description: 'Audio file not found.' })
  findOne(@Param('id') id: string) {
    return this.audiosService.findOne(id);
  }

  @Post()
  @Roles('admin', 'supervisor')
  @Permissions('audios:write')
  @ApiOperation({ summary: 'Register a new audio file' })
  @ApiResponse({ status: 201, description: 'Audio file registered.' })
  create(@Body() createAudioDto: CreateAudioDto) {
    return this.audiosService.create(createAudioDto);
  }

  @Post(':id/log-access')
  @ApiOperation({ summary: 'Log a play or download access to an audio file' })
  async logAccess(
    @Param('id') id: string,
    @Body() body: { action: 'play' | 'download' },
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id;
    const ip = req.ip;
    const ua = req.headers['user-agent'];
    await this.audiosService.logAccess(id, userId, body.action, ip, ua);
    return { ok: true };
  }

  @Put(':id')
  @Roles('admin', 'supervisor')
  @Permissions('audios:write')
  @ApiOperation({ summary: 'Update audio file status or metadata' })
  @ApiParam({ name: 'id', description: 'Audio UUID' })
  @ApiResponse({ status: 200, description: 'Audio file updated.' })
  @ApiResponse({ status: 404, description: 'Audio file not found.' })
  update(
    @Param('id') id: string,
    @Body() updateDto: Partial<CreateAudioDto>,
  ) {
    return this.audiosService.update(id, updateDto);
  }

  @Delete(':id')
  @Roles('admin')
  @Permissions('audios:delete')
  @ApiOperation({ summary: 'Delete an audio file' })
  @ApiParam({ name: 'id', description: 'Audio UUID' })
  @ApiResponse({ status: 200, description: 'Audio file deleted.' })
  @ApiResponse({ status: 404, description: 'Audio file not found.' })
  remove(@Param('id') id: string) {
    return this.audiosService.remove(id);
  }
}

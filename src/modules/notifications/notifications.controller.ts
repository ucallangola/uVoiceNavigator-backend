import {
  Controller,
  Get,
  Logger,
  MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * SSE stream endpoint — manual implementation to avoid the NestJS @Sse()
   * "Cannot set headers after they are sent to the client" bug that occurs
   * when the Observable completes after client disconnect.
   */
  @Public()
  @Get()
  stream(
    @Query('token') token: string,
    @Res() res: Response,
  ): void {
    if (!token) {
      res.status(401).json({ message: 'Token required' });
      return;
    }
    try {
      this.jwtService.verify(token);
    } catch {
      res.status(401).json({ message: 'Invalid token' });
      return;
    }

    // Set SSE headers before any data is written
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Safe write: silently drops writes to a closed/ended connection
    const safeWrite = (event: MessageEvent) => {
      if (res.destroyed || res.writableEnded) return;
      try {
        const data =
          typeof event.data === 'string'
            ? event.data
            : JSON.stringify(event.data);
        if (event.type) res.write(`event: ${event.type}\n`);
        res.write(`data: ${data}\n\n`);
      } catch {
        // Socket closed between the guard check and the write — ignore
      }
    };

    const safeEnd = () => {
      if (!res.destroyed && !res.writableEnded) {
        try {
          res.end();
        } catch {
          // Already ended
        }
      }
    };

    const subscription = this.notificationsService.getStream().subscribe({
      next: safeWrite,
      error: safeEnd,
      complete: safeEnd,
    });

    res.on('close', () => {
      this.logger.log('SSE client disconnected');
      subscription.unsubscribe();
    });
  }

  // ── Persistent notifications ──────────────────────────────────────────────

  @Get('list')
  async list(@Req() req: Request, @Query('cursor') cursor?: string) {
    const userId = (req as any).user?.sub;
    const where: any = { OR: [{ userId }, { userId: null }] };
    if (cursor) where.createdAt = { lt: new Date(cursor) };

    const items = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      items,
      nextCursor:
        items.length === 10
          ? items[items.length - 1].createdAt.toISOString()
          : null,
    };
  }

  @Post(':id/read')
  async markRead(@Param('id') id: string) {
    await this.prisma.notification.update({ where: { id }, data: { read: true } });
    return { ok: true };
  }

  @Post('read-all')
  async markAllRead(@Req() req: Request) {
    const userId = (req as any).user?.sub;
    await this.prisma.notification.updateMany({
      where: { OR: [{ userId }, { userId: null }], read: false },
      data: { read: true },
    });
    return { ok: true };
  }
}

import { Controller, Logger, MessageEvent, Query, Res, Sse, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { Public } from '../../common/decorators/public.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly jwtService: JwtService,
  ) {}

  @Public()
  @Sse()
  stream(
    @Query('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Observable<MessageEvent> {
    if (!token) {
      throw new UnauthorizedException('Token required');
    }

    try {
      this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    res.on('close', () => {
      this.logger.log('SSE client disconnected');
    });

    return this.notificationsService.getStream();
  }
}

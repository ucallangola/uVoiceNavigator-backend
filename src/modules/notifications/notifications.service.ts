import { Injectable } from '@nestjs/common';
import { MessageEvent } from '@nestjs/common';
import { interval, merge, Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class NotificationsService {
  private readonly subject = new Subject<MessageEvent>();

  emit(type: string, data: Record<string, unknown>): void {
    this.subject.next({
      type,
      data: JSON.stringify(data),
    });
  }

  getStream(): Observable<MessageEvent> {
    const heartbeat$ = interval(30000).pipe(
      map(() => ({
        type: 'heartbeat',
        data: JSON.stringify({ timestamp: new Date().toISOString() }),
      })),
    );

    return merge(this.subject.asObservable(), heartbeat$);
  }
}

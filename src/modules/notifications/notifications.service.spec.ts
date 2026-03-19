import { Test, TestingModule } from '@nestjs/testing';
import { firstValueFrom, take } from 'rxjs';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsService],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getStream() returns an Observable', () => {
    const stream$ = service.getStream();
    expect(typeof stream$.subscribe).toBe('function');
  });

  it('emit() pushes event with correct type', (done) => {
    service.getStream().pipe(take(1)).subscribe((event) => {
      expect(event.type).toBe('audio:processed');
      done();
    });

    service.emit('audio:processed', { audioId: 'abc', filename: 'test.wav' });
  });

  it('emit() serializes data as JSON string', (done) => {
    const payload = { audioId: 'xyz', filename: 'call.mp3' };

    service.getStream().pipe(take(1)).subscribe((event) => {
      expect(typeof event.data).toBe('string');
      expect(JSON.parse(event.data as string)).toEqual(payload);
      done();
    });

    service.emit('audio:processed', payload);
  });

  it('emit() with empty payload serializes to "{}"', (done) => {
    service.getStream().pipe(take(1)).subscribe((event) => {
      expect(event.data).toBe('{}');
      done();
    });

    service.emit('dashboard:refresh', {});
  });

  it('multiple subscribers all receive the same event', (done) => {
    const received: string[] = [];

    service.getStream().pipe(take(1)).subscribe(() => {
      received.push('A');
      if (received.length === 2) done();
    });

    service.getStream().pipe(take(1)).subscribe(() => {
      received.push('B');
      if (received.length === 2) done();
    });

    service.emit('alert:sent', { alertId: '1', email: 'a@b.com' });
  });

  it('sequential emits are received in order', async () => {
    const stream$ = service.getStream().pipe(take(3));

    // Collect via promise
    const collectPromise = new Promise<string[]>((resolve) => {
      const types: string[] = [];
      stream$.subscribe({
        next: (e) => types.push(e.type as string),
        complete: () => resolve(types),
      });
    });

    service.emit('audio:processed', { audioId: '1' });
    service.emit('audio:error', { audioId: '2' });
    service.emit('dashboard:refresh', {});

    const types = await collectPromise;
    expect(types).toEqual(['audio:processed', 'audio:error', 'dashboard:refresh']);
  });
});

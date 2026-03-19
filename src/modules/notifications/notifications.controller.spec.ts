import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let jwtService: jest.Mocked<JwtService>;

  const mockRes = {
    setHeader: jest.fn(),
    on: jest.fn(),
  } as unknown as Response;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        NotificationsService,
        {
          provide: JwtService,
          useValue: { verify: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
    jwtService = module.get(JwtService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('stream() — auth', () => {
    it('throws UnauthorizedException when token is empty string', () => {
      expect(() => controller.stream('', mockRes)).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when token is undefined', () => {
      expect(() => controller.stream(undefined as any, mockRes)).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when JwtService.verify throws', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      expect(() => controller.stream('expired-token', mockRes)).toThrow(UnauthorizedException);
    });

    it('does NOT call verify when no token provided', () => {
      try { controller.stream('', mockRes); } catch { /* expected */ }
      expect(jwtService.verify).not.toHaveBeenCalled();
    });
  });

  describe('stream() — success path', () => {
    beforeEach(() => {
      jwtService.verify.mockReturnValue({ sub: 'user-id', email: 'user@test.com' });
    });

    it('returns an Observable when token is valid', () => {
      const result = controller.stream('valid-token', mockRes);
      expect(result).toBeDefined();
      expect(typeof result.subscribe).toBe('function');
    });

    it('sets Cache-Control: no-cache header', () => {
      controller.stream('valid-token', mockRes);
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    });

    it('sets X-Accel-Buffering: no header', () => {
      controller.stream('valid-token', mockRes);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    });

    it('registers a close event listener on the response', () => {
      controller.stream('valid-token', mockRes);
      expect(mockRes.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('calls JwtService.verify with the provided token', () => {
      controller.stream('my-jwt-token', mockRes);
      expect(jwtService.verify).toHaveBeenCalledWith('my-jwt-token');
    });
  });
});

import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { ScheduleModule } from '@nestjs/schedule';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import etlConfig from './config/etl.config';
import jwtConfig from './config/jwt.config';
import mssqlConfig from './config/mssql.config';
import redisConfig from './config/redis.config';
import smtpConfig from './config/smtp.config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { PrismaService } from './database/prisma.service';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AudiosModule } from './modules/audios/audios.module';
import { AuthModule } from './modules/auth/auth.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { InteractionsModule } from './modules/interactions/interactions.module';
import { EtlModule } from './modules/etl/etl.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RolesModule } from './modules/roles/roles.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [appConfig, databaseConfig, etlConfig, jwtConfig, mssqlConfig, redisConfig, smtpConfig],
    }),

    // Winston Logger
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logDir = configService.get<string>('app.logDir') || 'logs';
        const logLevel = configService.get<string>('app.logLevel') || 'debug';

        return {
          transports: [
            new winston.transports.Console({
              level: logLevel,
              format: winston.format.combine(
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, context, trace }) => {
                  return `${timestamp} [${context || 'Application'}] ${level}: ${message}${trace ? '\n' + trace : ''}`;
                }),
              ),
            }),
            new winston.transports.File({
              filename: `${logDir}/error.log`,
              level: 'error',
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json(),
              ),
            }),
            new winston.transports.File({
              filename: `${logDir}/combined.log`,
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json(),
              ),
            }),
          ],
        };
      },
    }),

    // Rate Limiting
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('THROTTLE_TTL') || 60000,
            limit: configService.get<number>('THROTTLE_LIMIT') || 100,
          },
        ],
      }),
    }),

    // Bull Queue (Redis)
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
          password: configService.get<string>('redis.password') || undefined,
          db: configService.get<number>('redis.db'),
        },
      }),
    }),

    // Scheduled tasks
    ScheduleModule.forRoot(),

    // Health Check
    HealthModule,

    // Feature Modules
    NotificationsModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    InteractionsModule,
    AudiosModule,
    AlertsModule,
    DashboardModule,
    EtlModule,
    JobsModule,
  ],
  providers: [
    PrismaService,

    // Global JWT Auth Guard (applied to all routes, use @Public() to bypass)
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },

    // Global Rate Limiting
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },

    // Global Exception Filter
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },

    // Global Logging Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },

    // Global Transform Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule {}

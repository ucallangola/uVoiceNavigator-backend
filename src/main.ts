import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { createValidationPipe } from './common/pipes/validation.pipe';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use Winston as the default logger
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') || 3000;
  const apiVersion = configService.get<string>('app.apiVersion') || 'v1';
  const frontendUrl = configService.get<string>('app.frontendUrl') || 'http://localhost:5173';
  const nodeEnv = configService.get<string>('app.nodeEnv') || 'development';

  // Set global prefix
  app.setGlobalPrefix(`api/${apiVersion}`);

  // Security: Helmet
  app.use(helmet());

  // CORS
  app.enableCors({
    origin: [
      frontendUrl,
      'http://localhost:3000',
      'http://localhost:4200',
      'http://localhost:5173',
      'http://localhost:8080',
      'http://localhost:8081',
      'http://localhost:8082',
      'https://uvoice.ucall.co.ao',
      'https://uvoice.ucall.co.ao/'
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
  });

  // Global Validation Pipe
  app.useGlobalPipes(createValidationPipe());

  // Swagger Documentation
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('uVoice Navigator API')
      .setDescription(
        'Enterprise API for uVoice Navigator - Audio Processing and BCB Interaction Management Platform',
      )
      .setVersion('1.0')
      .addTag('auth', 'Authentication endpoints')
      .addTag('users', 'User management')
      .addTag('roles', 'Role management')
      .addTag('permissions', 'Permission management')
      .addTag('interactions', 'BCB interaction management')
      .addTag('audios', 'Audio file management')
      .addTag('alerts', 'Email alert configuration')
      .addTag('dashboard', 'Dashboard statistics')
      .addTag('health', 'Health check')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter your JWT access token',
          in: 'header',
        },
        'JWT-auth',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });

    Logger.log('Swagger docs available at /api/docs', 'Bootstrap');
  }

  await app.listen(port);

  Logger.log(
    `uVoice Navigator API running on port ${port} (${nodeEnv})`,
    'Bootstrap',
  );
  Logger.log(`API Base URL: http://localhost:${port}/api/${apiVersion}`, 'Bootstrap');
}

bootstrap();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadKmsSecrets } from './common/kms-secrets';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Decrypt KMS-protected secrets into process.env before NestJS reads config
  await loadKmsSecrets();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  // HTTP security headers
  app.use(helmet());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // CORS configuration — no localhost fallback in production
  const rawCorsOrigins = configService.get<string>('CORS_ORIGIN', isProduction ? '' : 'http://localhost:3000');
  const corsOrigins = rawCorsOrigins.split(',').map((o) => o.trim()).filter(Boolean);
  if (isProduction && corsOrigins.length === 0) {
    logger.warn('CORS_ORIGIN is not set — all cross-origin requests will be blocked');
  }
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  // Start server
  const port = configService.get<number>('PORT', 3001);
  await app.listen(port);

  logger.log(`🚀 Loofta Backend running on http://localhost:${port}`);

  // Swagger — disabled in production (API schema is internal)
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Loofta Swap API')
      .setDescription('Backend API for Loofta Swap - Cross-chain payment infrastructure')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'x-privy-user-id', in: 'header' }, 'privy-auth')
      .addTag('organizations', 'Organization management')
      .addTag('claims', 'Payment claims and deposits')
      .addTag('intents', 'Cross-chain intent operations')
      .addTag('tokens', 'Token information')
      .addTag('status', 'Transaction status tracking')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    logger.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
  }
}

bootstrap();

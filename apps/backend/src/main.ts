import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadKmsSecrets } from './common/kms-secrets';
import { assertEnvironmentCoherence } from './common/env-coherence-guard';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Decrypt KMS-protected secrets into process.env before NestJS reads config
  await loadKmsSecrets();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // Railway terminates TLS and proxies with a single hop — without this, Express's req.ip
  // resolves to Railway's internal proxy address for every request, collapsing the IP-keyed
  // rate limiters (ThrottlerModule, RateLimitGuard's request.ip fallback) into one shared
  // bucket across all users instead of one bucket per real client.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const configService = app.get(ConfigService);
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  // See ENVIRONMENTS.md — refuses to boot if the loaded env mixes production Supabase with a
  // non-production Solana fee payer, or vice versa.
  assertEnvironmentCoherence(configService);

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

bootstrap().catch((err) => {
  // Without this, a thrown/rejected bootstrap() relies on Node's default unhandled-rejection
  // handling to surface the error — which doesn't always print a clear message before exit,
  // making a healthcheck failure look like a silent crash with no cause in the logs.
  // eslint-disable-next-line no-console
  console.error('Fatal error during backend bootstrap:', err);
  process.exit(1);
});

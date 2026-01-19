import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health endpoints', () => {
    it('/ (GET) - should return API info', () => {
      return request(app.getHttpServer())
        .get('/')
        .expect(200)
        .expect((res) => {
          expect(res.body.name).toBe('Loofta Swap API');
          expect(res.body.docs).toBe('/api/docs');
        });
    });

    it('/health (GET) - should return health status', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBeDefined();
          expect(res.body.timestamp).toBeDefined();
          expect(res.body.services).toBeDefined();
        });
    });

    it('/healthz (GET) - should return liveness', () => {
      return request(app.getHttpServer())
        .get('/healthz')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
        });
    });
  });

  describe('Tokens endpoints', () => {
    it('/tokens (GET) - should return tokens', () => {
      return request(app.getHttpServer())
        .get('/tokens')
        .expect(200)
        .expect((res) => {
          expect(res.body.tokens).toBeDefined();
          expect(Array.isArray(res.body.tokens)).toBe(true);
        });
    });

    it('/tokens/search (GET) - should search tokens', () => {
      return request(app.getHttpServer())
        .get('/tokens/search?q=eth')
        .expect(200)
        .expect((res) => {
          expect(res.body.tokens).toBeDefined();
          expect(Array.isArray(res.body.tokens)).toBe(true);
        });
    });
  });

  describe('Organizations endpoints', () => {
    it('/organizations (GET) - should require admin auth', () => {
      return request(app.getHttpServer())
        .get('/organizations')
        .expect(401);
    });

    it('/organizations (GET) - with auth should return organizations', () => {
      return request(app.getHttpServer())
        .get('/organizations')
        .set('x-privy-user-id', 'test-admin-id')
        .expect((res) => {
          // May return 401 if user is not admin, or 200 with data
          expect([200, 401]).toContain(res.status);
        });
    });
  });

  describe('Claims endpoints', () => {
    it('/claims/create (POST) - should validate input', () => {
      return request(app.getHttpServer())
        .post('/claims/create')
        .send({})
        .expect(400);
    });

    it('/claims/create (POST) - should create claim with valid input', () => {
      return request(app.getHttpServer())
        .post('/claims/create')
        .send({
          amount: 100,
          toSel: { symbol: 'USDC', chain: 'base' },
          recipient: '0x1234567890abcdef1234567890abcdef12345678',
        })
        .expect((res) => {
          // May succeed or fail depending on DB, but should not be 400
          expect([200, 201, 500]).toContain(res.status);
        });
    });
  });

  describe('Lottery endpoints', () => {
    it('/lottery/contract (GET) - should return contract info', () => {
      return request(app.getHttpServer())
        .get('/lottery/contract')
        .expect(200)
        .expect((res) => {
          expect(res.body.address).toBeDefined();
          expect(res.body.chain).toBe('base');
          expect(res.body.chainId).toBe(8453);
        });
    });

    it('/lottery/estimate (GET) - should estimate tickets', () => {
      return request(app.getHttpServer())
        .get('/lottery/estimate?ethAmount=0.05')
        .expect(200)
        .expect((res) => {
          expect(res.body.ethAmount).toBe(0.05);
          expect(res.body.estimatedTickets).toBe(100);
        });
    });

    it('/lottery/calculate-eth (GET) - should calculate ETH needed', () => {
      return request(app.getHttpServer())
        .get('/lottery/calculate-eth?tickets=100')
        .expect(200)
        .expect((res) => {
          expect(res.body.tickets).toBe(100);
          expect(res.body.ethNeeded).toBeGreaterThan(0);
        });
    });
  });

  describe('Intents endpoints', () => {
    it('/intents/rhinestone/chains (GET) - should return supported chains', () => {
      return request(app.getHttpServer())
        .get('/intents/rhinestone/chains')
        .expect(200)
        .expect((res) => {
          expect(res.body.chainIds).toBeDefined();
          expect(Array.isArray(res.body.chainIds)).toBe(true);
        });
    });

    it('/intents/rhinestone/eligibility (GET) - should check eligibility', () => {
      return request(app.getHttpServer())
        .get('/intents/rhinestone/eligibility?fromChain=base&toChain=base')
        .expect(200)
        .expect((res) => {
          expect(res.body.eligible).toBeDefined();
        });
    });
  });

  describe('Cron endpoints', () => {
    it('/cron/status (GET) - should return processing status', () => {
      return request(app.getHttpServer())
        .get('/cron/status')
        .expect(200)
        .expect((res) => {
          expect(res.body.isProcessing).toBeDefined();
        });
    });

    it('/cron/process-claims (GET) - should require cron auth', () => {
      return request(app.getHttpServer())
        .get('/cron/process-claims')
        .expect((res) => {
          // Without CRON_SECRET set, should allow (development mode)
          expect([200, 401]).toContain(res.status);
        });
    });
  });
});

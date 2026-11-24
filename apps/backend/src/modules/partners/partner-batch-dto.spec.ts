import { ValidationPipe } from '@nestjs/common';
import { CreatePartnerBatchDto } from './dto/partner-batch.dto';
import { SetWebhookDto } from './dto/partner.dto';

// The same pipe options the app runs with (whitelist + forbidNonWhitelisted + transform).
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const check = <T>(type: new () => T, value: unknown) => pipe.transform(value, { type: 'body', metatype: type });

const row = { recipient_type: 'email', recipient_identifier: 'a@b.co', amount: 5 };

describe('CreatePartnerBatchDto as the SDK sends it', () => {
  it('accepts a scheduled batch (ISO time from Date.toISOString)', async () => {
    const out = await check(CreatePartnerBatchDto, { idempotency_key: 'k', scheduled_for: new Date(Date.now() + 3_600_000).toISOString(), rows: [row] });
    expect(out.scheduled_for).toBeDefined();
  });

  it('accepts a batch with no schedule, and with the field sent as undefined (JSON drops it)', async () => {
    await expect(check(CreatePartnerBatchDto, { idempotency_key: 'k', rows: [row] })).resolves.toBeDefined();
    await expect(check(CreatePartnerBatchDto, JSON.parse(JSON.stringify({ idempotency_key: 'k', scheduled_for: undefined, rows: [row] })))).resolves.toBeDefined();
  });

  it('rejects a schedule that is not a date', async () => {
    for (const bad of ['tomorrow', '2026-13-45', 12345, '']) {
      await expect(check(CreatePartnerBatchDto, { idempotency_key: 'k', scheduled_for: bad, rows: [row] })).rejects.toBeDefined();
    }
  });

  it('accepts a batch of 1,000 payouts and rejects 1,001', async () => {
    await expect(check(CreatePartnerBatchDto, { idempotency_key: 'k', rows: Array.from({ length: 1000 }, () => row) })).resolves.toBeDefined();
    await expect(check(CreatePartnerBatchDto, { idempotency_key: 'k', rows: Array.from({ length: 1001 }, () => row) })).rejects.toBeDefined();
  });

  it('still rejects unknown fields', async () => {
    await expect(check(CreatePartnerBatchDto, { idempotency_key: 'k', rows: [row], approve: true })).rejects.toBeDefined();
  });
});

describe('SetWebhookDto', () => {
  it('accepts a url or null (to turn webhooks off)', async () => {
    await expect(check(SetWebhookDto, { url: 'https://x.co/h' })).resolves.toBeDefined();
    await expect(check(SetWebhookDto, { url: null })).resolves.toBeDefined();
  });
  it('rejects a non-string url', async () => {
    await expect(check(SetWebhookDto, { url: 42 })).rejects.toBeDefined();
  });
});

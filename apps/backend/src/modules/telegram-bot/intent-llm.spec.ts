import { ConfigService } from '@nestjs/config';
import { IntentLlmService, parseLlmJson, intentToSentence, LlmIntent } from './intent-llm';

const intent = (over: Partial<LlmIntent> = {}): LlmIntent => ({ isPayment: true, isPrivate: false, delayMinutes: null, split: null, payments: [], ...over });

describe('parseLlmJson', () => {
  it('reads a well formed answer, even wrapped in a code fence', () => {
    const raw = '```json\n{"is_payment":true,"private":false,"delay_minutes":null,"split":null,"payments":[{"handle":"@Alice_W","amount":5}]}\n```';
    expect(parseLlmJson(raw)).toEqual(intent({ payments: [{ handle: 'alice_w', amount: 5 }] }));
  });
  it('treats garbage as no answer', () => {
    expect(parseLlmJson('sure! here you go')).toBeNull();
    expect(parseLlmJson('{"is_payment":"yes"}')?.isPayment).toBe(false);
  });
  it('caps the number of payments', () => {
    const p = Array.from({ length: 9 }, (_, i) => ({ handle: `user_${i}aaa`, amount: 1 }));
    expect(parseLlmJson(JSON.stringify({ is_payment: true, payments: p }))?.payments).toHaveLength(5);
  });
});

describe('intentToSentence: never trusts the model beyond what the person wrote', () => {
  it('rebuilds a complete request as a normal sentence', () => {
    const i = intent({ payments: [{ handle: 'alice_w', amount: 5 }, { handle: 'bob_wh', amount: 10 }] });
    expect(intentToSentence(i, 'send five bucks to alice_w and ten to bob_wh')).toBe('pay $5 to @alice_w, $10 to @bob_wh');
  });
  it('keeps private, delay and split', () => {
    const i = intent({ isPrivate: true, delayMinutes: 30, split: 4, payments: [{ handle: 'alice_w', amount: 5 }] });
    expect(intentToSentence(i, 'secretly give alice_w 5 dollars, 30 minutes, 4 parts')).toBe('payprivately $5 to @alice_w delay 30m split 4');
  });
  it('rejects a name the person never wrote (a made up recipient)', () => {
    const i = intent({ payments: [{ handle: 'attacker_x', amount: 5 }] });
    expect(intentToSentence(i, 'send five bucks to my friend')).toBeNull();
  });
  it('rejects silly amounts', () => {
    expect(intentToSentence(intent({ payments: [{ handle: 'alice_w', amount: 9999 }] }), 'pay alice_w 9999')).toBeNull();
    expect(intentToSentence(intent({ payments: [{ handle: 'alice_w', amount: -5 }] }), 'pay alice_w -5')).toBeNull();
    expect(intentToSentence(intent({ payments: [{ handle: 'alice_w', amount: 1.234 }] }), 'pay alice_w 1.234')).toBeNull();
  });
  it('hands back only what is known so the bot asks for the rest', () => {
    expect(intentToSentence(intent({ payments: [{ handle: 'alice_w', amount: null }] }), 'i want to pay alice_w')).toBe('pay @alice_w');
    expect(intentToSentence(intent({ payments: [{ handle: null, amount: 5 }] }), 'i want to send five')).toBe('pay $5');
  });
  it('is nothing when it is not a payment', () => {
    expect(intentToSentence(intent({ isPayment: false }), 'what is the weather')).toBeNull();
  });
});

describe('IntentLlmService', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  const svc = (env: Record<string, string>) => new IntentLlmService({ get: (k: string) => env[k] } as unknown as ConfigService);
  const ok = (content: object) => ({ status: 200, ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) } as any);

  it('is off without a key, and never calls out', async () => {
    global.fetch = jest.fn() as any;
    const s = svc({});
    expect(s.enabled).toBe(false);
    expect(await s.interpret('pay five to alice_w', 1)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls through to the next model when the first is rate limited, and rests the first', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (_u: any, init: any) => {
      const model = JSON.parse(init.body).model;
      calls.push(model);
      return model === 'm1' ? ({ status: 429, ok: false } as any) : ok({ is_payment: true, payments: [{ handle: 'alice_w', amount: 5 }] });
    }) as any;
    const s = svc({ LLM_API_KEY: 'k', LLM_MODELS: 'm1,m2' });
    expect((await s.interpret('pay five to alice_w', 1))?.payments[0]).toEqual({ handle: 'alice_w', amount: 5 });
    expect(calls).toEqual(['m1', 'm2']);
    await s.interpret('pay five to alice_w', 1);
    expect(calls).toEqual(['m1', 'm2', 'm2']); // m1 is resting for a minute
  });

  it('survives every provider failing: no answer, no throw', async () => {
    global.fetch = jest.fn(async () => { throw new Error('network down'); }) as any;
    expect(await svc({ LLM_API_KEY: 'k', LLM_MODELS: 'm1,m2' }).interpret('pay five to alice_w', 1)).toBeNull();
  });

  it('limits one person, and the whole day, to protect the free quota', async () => {
    global.fetch = jest.fn(async () => ok({ is_payment: false, payments: [] })) as any;
    const s = svc({ LLM_API_KEY: 'k', LLM_MODELS: 'm1', LLM_USER_PER_MINUTE: '2', LLM_DAILY_LIMIT: '3' });
    await s.interpret('a b c', 7); await s.interpret('a b c', 7);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(await s.interpret('a b c', 7)).toBeNull(); // per-person limit
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await s.interpret('a b c', 8);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(await s.interpret('a b c', 9)).toBeNull(); // daily limit
  });
});

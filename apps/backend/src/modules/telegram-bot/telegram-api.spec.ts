import { TelegramApi } from './telegram-api';

describe('TelegramApi HTML fallback', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('retries as plain text when Telegram cannot parse the HTML, so the user still gets a reply', async () => {
    const bodies: any[] = [];
    global.fetch = jest.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      const bad = body.parse_mode === 'HTML';
      return { status: bad ? 400 : 200, json: async () => (bad ? { ok: false, description: "Bad Request: can't parse entities" } : { ok: true, result: { message_id: 1 } }) } as any;
    }) as any;

    const res = await new TelegramApi('t').sendMessage(1, '<b>Total</b> &lt;$0.01 &amp; more');
    expect(res).toEqual({ message_id: 1 });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].parse_mode).toBeUndefined();
    expect(bodies[1].text).toBe('Total <$0.01 & more');
  });

  it('does not retry on other errors', async () => {
    global.fetch = jest.fn(async () => ({ status: 403, json: async () => ({ ok: false, description: 'Forbidden: bot was blocked by the user' }) })) as any;
    await expect(new TelegramApi('t').sendMessage(1, 'hi')).rejects.toThrow('blocked');
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });
});

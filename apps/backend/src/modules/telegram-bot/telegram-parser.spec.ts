import { parseSendCommand } from './telegram-parser';

const BOT = 'looftapay_bot';
const ok = (amount: number, handle: string | null, extra: Record<string, unknown> = {}) => ({
  ok: true, amount, handle, isPrivate: false, delayMs: null, split: null, ...extra,
});
const priv = (amount: number, handle: string | null, extra: Record<string, unknown> = {}) =>
  ok(amount, handle, { isPrivate: true, ...extra });

describe('parseSendCommand', () => {
  it.each([
    ['send $5 to @alice_w', ok(5, 'alice_w')],
    ['Send 5 usdc to alice_w', ok(5, 'alice_w')],
    ['/send 2.5 @alice_w', ok(2.5, 'alice_w')],
    ['/send@looftapay_bot $10 @alice_w', ok(10, 'alice_w')],
    ['/send @alice_w 7', ok(7, 'alice_w')],
    ['@looftapay_bot pay 3 to @alice_w', ok(3, 'alice_w')],
    ['/pay 5', ok(5, null)],
    ['pay $1.25', ok(1.25, null)],
    ['send 1$ to @lisabeyy', ok(1, 'lisabeyy')],
    ['pay 1$ to @lisabeyy', ok(1, 'lisabeyy')],
    ['pay @lisabeyy 1$', ok(1, 'lisabeyy')],
    ['/pay 5$ to @alice_w', ok(5, 'alice_w')],
    ['/pay@looftapay_bot 5$ to @alice_w', ok(5, 'alice_w')],
    ['Pay 2.50 dollars to lisabeyy', ok(2.5, 'lisabeyy')],
    ['send 5$ privately to @someone', priv(5, 'someone')],
    ['pay $5 to @someone privately', priv(5, 'someone')],
    ['/pay 5 private @someone', priv(5, 'someone')],
    ['/payprivately 5 @someone', priv(5, 'someone')],
    ['/payprivately@looftapay_bot 5$ to @someone', priv(5, 'someone')],
    ['payprivately $5 to @someone delay 1h', priv(5, 'someone', { delayMs: 3_600_000 })],
    ['/pay_privately 5', priv(5, null)],
    ['sendprivately 5 to @someone', priv(5, 'someone')],
    ['pay 5$ private to @someone', priv(5, 'someone')],
    ['pay 5 privately to @someone delay 30m split 4', priv(5, 'someone', { delayMs: 30 * 60_000, split: 4 })],
    ['pay 5 privately to @someone delay 2 hours', priv(5, 'someone', { delayMs: 2 * 3_600_000 })],
    ['pay 5 privately to @someone split random', priv(5, 'someone')],
    ['/pay 5 privately', priv(5, null)],
  ])('parses %s', (text, expected) => {
    expect(parseSendCommand(text, BOT)).toEqual(expected);
  });

  it('returns null for text that is not a payment command', () => {
    expect(parseSendCommand('hello there', BOT)).toBeNull();
    expect(parseSendCommand('/balance', BOT)).toBeNull();
    expect(parseSendCommand('tip 5', BOT)).toBeNull();
    expect(parseSendCommand('send me money', BOT)).toBeNull();
  });

  it('rejects bad amounts and handles', () => {
    expect(parseSendCommand('send $1.234 to @alice_w', BOT)).toMatchObject({ ok: false });
    expect(parseSendCommand('send $0 to @alice_w', BOT)).toMatchObject({ ok: false });
    expect(parseSendCommand('send $501 to @alice_w', BOT)).toMatchObject({ ok: false });
    expect(parseSendCommand('send $5 to @abc', BOT)).toMatchObject({ ok: false });
    expect(parseSendCommand('pay 5 to @someone delay 30m', BOT)).toMatchObject({ ok: false });
    expect(parseSendCommand('pay 0.5 privately to @someone', BOT)).toMatchObject({ ok: false });
    expect(parseSendCommand('pay 5 privately to @someone split 40', BOT)).toMatchObject({ ok: false });
    expect(parseSendCommand('pay 5 privately to @someone delay 5s', BOT)).toMatchObject({ ok: false });
  });
});

describe('parseSendCommand with several people', () => {
  const multi = (payments: Array<[string, number]>, extra: Record<string, unknown> = {}) => ({
    ok: true,
    amount: payments.reduce((t, [, a]) => t + a, 0),
    handle: null,
    isPrivate: false,
    delayMs: null,
    split: null,
    payments: payments.map(([handle, amount]) => ({ handle, amount })),
    ...extra,
  });

  it.each([
    ['pay $5 to @alice_w, $10 to @bob_wh and $2 to @carol_w', multi([['alice_w', 5], ['bob_wh', 10], ['carol_w', 2]])],
    ['send 5$ to @alice_w and 3$ to @bob_wh', multi([['alice_w', 5], ['bob_wh', 3]])],
    ['pay @alice_w 5, @bob_wh 10', multi([['alice_w', 5], ['bob_wh', 10]])],
    ['pay 5 to @alice_w @bob_wh @carol_w', multi([['alice_w', 5], ['bob_wh', 5], ['carol_w', 5]])],
    ['pay $5 each to @alice_w, @bob_wh', multi([['alice_w', 5], ['bob_wh', 5]])],
    ['pay $5 to @alice_w, @bob_wh, $2 to @carol_w', multi([['alice_w', 5], ['bob_wh', 5], ['carol_w', 2]])],
    ['pay @alice_w, @bob_wh 5', multi([['alice_w', 5], ['bob_wh', 5]])],
    ['/pay@looftapay_bot 1 to @alice_w and 2 to @bob_wh', multi([['alice_w', 1], ['bob_wh', 2]])],
    ['pay 5$ privately to @alice_w and 3$ to @bob_wh delay 30m split 4', multi([['alice_w', 5], ['bob_wh', 3]], { isPrivate: true, delayMs: 30 * 60_000, split: 4 })],
    ['/payprivately 5 to @alice_w, 6 to @bob_wh', multi([['alice_w', 5], ['bob_wh', 6]], { isPrivate: true })],
  ])('parses %s', (text, expected) => {
    expect(parseSendCommand(text, 'looftapay_bot')).toEqual(expected);
  });

  it('allows five people and refuses six', () => {
    const five = 'pay $1 to @user_aaa, $1 to @user_bbb, $1 to @user_ccc, $1 to @user_ddd, $1 to @user_eee';
    expect(parseSendCommand(five, 'looftapay_bot')).toMatchObject({ ok: true });
    expect(parseSendCommand(five + ', $1 to @user_fff', 'looftapay_bot')).toMatchObject({ ok: false, error: expect.stringContaining('up to 5') });
  });

  it('refuses unclear sentences instead of guessing', () => {
    const p = (t: string) => parseSendCommand(t, 'looftapay_bot');
    expect(p('pay @alice_w, @bob_wh')).toMatchObject({ ok: false });
    expect(p('pay $5 and $6 to @alice_w, @bob_wh')).toMatchObject({ ok: false });
    expect(p('pay $5 to @alice_w, hello @bob_wh')).toMatchObject({ ok: false });
    expect(p('pay $5 to @alice_w, $6 to @alice_w')).toMatchObject({ ok: false, error: expect.stringContaining('once') });
    expect(p('pay $0.5 privately to @alice_w, $5 to @bob_wh')).toMatchObject({ ok: false });
    expect(p('pay $501 to @alice_w, $5 to @bob_wh')).toMatchObject({ ok: false });
  });
});

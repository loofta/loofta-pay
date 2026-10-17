import { parseSendCommand } from './telegram-parser';

const BOT = 'looftapay_bot';
const ok = (amount: number, handle: string | null) => ({ ok: true, amount, handle });

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
  });
});

import { distinctRecents, recipientKeyboard, parseRecipientText, amountCard, commandForAmount, SEND_AMOUNTS } from './send-flow';
import { parseSendCommand } from './telegram-parser';

describe('send flow', () => {
  it('lists the last different people paid, newest first, without the same name twice', () => {
    const rows = ['alice_w', 'bob_wh', 'alice_w', 'carol_w', 'dave_xx', 'erin_yy'].map((recipient_handle) => ({ recipient_handle }));
    expect(distinctRecents(rows, 4)).toEqual(['alice_w', 'bob_wh', 'carol_w', 'dave_xx']);
    expect(distinctRecents(rows, 4, 'ALICE_W')).toEqual(['bob_wh', 'carol_w', 'dave_xx', 'erin_yy']);
    expect(distinctRecents([], 4)).toEqual([]);
  });

  it("offers Telegram's own people picker first, asking for the username, then recent people two to a row", () => {
    const k = recipientKeyboard(['alice_w', 'bob_wh', 'carol_w']);
    expect(k.keyboard[0][0]).toMatchObject({ text: 'Choose from Telegram', request_users: { user_is_bot: false, max_quantity: 1, request_username: true } });
    expect(k.keyboard.slice(1)).toEqual([[{ text: '@alice_w' }, { text: '@bob_wh' }], [{ text: '@carol_w' }]]);
    expect(k.one_time_keyboard).toBe(true);
  });

  it('reads a typed or tapped recipient, and nothing else', () => {
    expect(parseRecipientText('@Alice_W')).toBe('alice_w');
    expect(parseRecipientText('alice_w')).toBe('alice_w');
    expect(parseRecipientText('pay 5')).toBeNull();
    expect(parseRecipientText('@abc')).toBeNull(); // too short to be a Telegram username
  });

  it('the amount card has the privacy choice, five amounts and custom, with private selected by default', () => {
    const rows = amountCard('alice_w', true).keyboard.inline_keyboard;
    expect(rows[0].map((b) => b.text)).toEqual(['[Private]', 'Not private']);
    expect(rows[1].map((b) => b.text)).toEqual(['$5', '$10', '$50', '$100', '$200']);
    expect(rows[2].map((b) => b.text)).toEqual(['Custom amount', 'Change person']);
    expect(amountCard('alice_w', false).keyboard.inline_keyboard[0].map((b) => b.text)).toEqual(['Private', '[Not private]']);
    // every button's data fits Telegram's 64 byte limit
    for (const row of rows) for (const b of row) expect(Buffer.byteLength(b.callback_data!)).toBeLessThanOrEqual(64);
  });

  it('shows the balance on the card when it is known, and nothing when it is not', () => {
    expect(amountCard('alice_w', true, 12.5).text).toContain('Your balance: <b>$12.50</b>');
    expect(amountCard('alice_w', true).text).not.toContain('balance');
    expect(amountCard('alice_w', true, 0).text).toContain('$0.00');
  });

  it('every amount builds a command the normal parser accepts, private or not', () => {
    for (const a of SEND_AMOUNTS) {
      expect(parseSendCommand(commandForAmount('alice_w', true, a), 'looftapay_bot')).toMatchObject({ ok: true, amount: a, handle: 'alice_w', isPrivate: true });
      expect(parseSendCommand(commandForAmount('alice_w', false, a), 'looftapay_bot')).toMatchObject({ ok: true, amount: a, isPrivate: false });
    }
  });
});

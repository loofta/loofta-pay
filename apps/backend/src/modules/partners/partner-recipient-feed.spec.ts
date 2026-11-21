import { BadRequestException } from '@nestjs/common';
import { FEED_MAX_ROWS, parseCsv, parseRecipientFeed, toRecipient } from './partner-recipient-feed';

describe('recipient feed parsing', () => {
  it('reads a JSON array and ignores every field it does not know', () => {
    const { rows } = parseRecipientFeed(JSON.stringify([{ email: ' Mira@Example.com ', name: 'Mira', role: 'admin', is_admin: true, metadata: { x: 1 } }]), 'application/json');
    expect(rows).toEqual([{ email: 'mira@example.com', name: 'Mira' }]);
  });

  it('reads {"recipients": [...]} and handles with a platform', () => {
    const { rows } = parseRecipientFeed(JSON.stringify({ recipients: [{ handle: '@jon', platform: 'Twitter' }] }), 'application/json');
    expect(rows).toEqual([{ handle: 'jon', handle_platform: 'twitter' }]);
  });

  it('skips bad rows and reports them without failing the list', () => {
    const { rows, errors } = parseRecipientFeed(JSON.stringify([{ email: 'nope' }, { handle: 'x' }, {}, 'text', { email: 'ok@example.com' }]), 'application/json');
    expect(rows).toEqual([{ email: 'ok@example.com' }]);
    expect(errors.map((e) => e.row)).toEqual([1, 2, 3, 4]);
  });

  it('drops duplicates inside one list', () => {
    const { rows } = parseRecipientFeed(JSON.stringify([{ email: 'a@b.co' }, { email: 'A@B.co' }]), 'application/json');
    expect(rows).toHaveLength(1);
  });

  it('reads CSV with a header, quotes and CRLF', () => {
    const { rows } = parseRecipientFeed('email,name\r\nmira@example.com,"Okafor, Mira"\r\njon@example.com,Jon\r\n', 'text/csv');
    expect(rows).toEqual([{ email: 'mira@example.com', name: 'Okafor, Mira' }, { email: 'jon@example.com', name: 'Jon' }]);
  });

  it('refuses CSV without a header naming email or handle, and invalid JSON', () => {
    expect(() => parseRecipientFeed('a@b.co\nc@d.co', 'text/csv')).toThrow(BadRequestException);
    expect(() => parseRecipientFeed('{ nope', 'application/json')).toThrow(BadRequestException);
    expect(() => parseRecipientFeed('{"a":1}', 'application/json')).toThrow(BadRequestException);
  });

  it('refuses a list over the cap, in JSON and CSV', () => {
    expect(() => parseRecipientFeed(JSON.stringify(Array.from({ length: FEED_MAX_ROWS + 1 }, (_, i) => ({ email: `u${i}@example.com` }))), 'application/json')).toThrow(/more than/);
    expect(() => parseCsv(`email\n${Array.from({ length: FEED_MAX_ROWS + 5 }, (_, i) => `u${i}@example.com`).join('\n')}`)).toThrow(/more than/);
  });

  it('caps the length of every field', () => {
    const r = toRecipient({ email: 'a@b.co', name: 'x'.repeat(500), external_user_id: 'y'.repeat(500) });
    expect(r.ok && r.row.name?.length).toBe(120);
    expect(r.ok && r.row.external_user_id?.length).toBe(200);
  });
});

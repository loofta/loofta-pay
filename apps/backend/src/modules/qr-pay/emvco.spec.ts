import { crc16, parseEmvcoQr, QrParseError } from './emvco';

function tlv(tag: string, value: string) {
  return tag + String(value.length).padStart(2, '0') + value;
}

function build(fields: string[]) {
  const body = fields.join('') + '6304';
  return body + crc16(body);
}

describe('parseEmvcoQr', () => {
  it('computes the standard CRC test vector', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('parses a PIX static QR', () => {
    const qr = build([
      tlv('00', '01'),
      tlv('01', '11'),
      tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', 'maria@example.com')),
      tlv('52', '5411'),
      tlv('53', '986'),
      tlv('54', '25.50'),
      tlv('58', 'BR'),
      tlv('59', 'MARIA LTDA'),
      tlv('60', 'SAO PAULO'),
      tlv('62', tlv('05', 'ORDER42')),
    ]);
    const p = parseEmvcoQr(qr);
    expect(p).toMatchObject({
      scheme: 'PIX',
      currency: 'BRL',
      amount: 25.5,
      country: 'BR',
      merchantName: 'MARIA LTDA',
      isStatic: true,
      reference: 'ORDER42',
    });
    expect(p.payee.key).toBe('maria@example.com');
  });

  it('parses a PromptPay QR without an amount', () => {
    const qr = build([
      tlv('00', '01'),
      tlv('01', '11'),
      tlv('29', tlv('00', 'A000000677010111') + tlv('01', '0066812345678')),
      tlv('53', '764'),
      tlv('58', 'TH'),
      tlv('59', 'Som Tam Shop'),
      tlv('60', 'Bangkok'),
    ]);
    const p = parseEmvcoQr(qr);
    expect(p.scheme).toBe('PROMPTPAY');
    expect(p.currency).toBe('THB');
    expect(p.amount).toBeNull();
    expect(p.payee.mobile).toBe('0066812345678');
  });

  it('parses a VietQR payload', () => {
    const qr = build([
      tlv('00', '01'),
      tlv('01', '12'),
      tlv('38', tlv('00', 'A000000727') + tlv('01', tlv('00', '970436') + tlv('01', '0011001932418')) + tlv('02', 'QRIBFTTA')),
      tlv('53', '704'),
      tlv('54', '50000'),
      tlv('58', 'VN'),
    ]);
    const p = parseEmvcoQr(qr);
    expect(p.scheme).toBe('VIETQR');
    expect(p.isStatic).toBe(false);
    expect(p.payee).toMatchObject({ bin: '970436', account: '0011001932418', service: 'QRIBFTTA' });
  });

  it('parses a QR Ph merchant QR', () => {
    const qr = build([
      tlv('00', '01'),
      tlv('27', tlv('00', 'ph.ppmi.p2m') + tlv('01', '12345')),
      tlv('53', '608'),
      tlv('58', 'PH'),
    ]);
    expect(parseEmvcoQr(qr).scheme).toBe('QRPH');
  });

  it('treats a Colombian COP code as Bre-B', () => {
    const qr = build([tlv('00', '01'), tlv('53', '170'), tlv('54', '15000'), tlv('58', 'CO'), tlv('59', 'Tienda')]);
    const p = parseEmvcoQr(qr);
    expect(p.scheme).toBe('BREB');
    expect(p.currency).toBe('COP');
  });

  it('rejects a damaged checksum', () => {
    const qr = build([tlv('00', '01'), tlv('53', '986'), tlv('58', 'BR'), tlv('59', 'X')]);
    const bad = qr.slice(0, -1) + (qr.endsWith('0') ? '1' : '0');
    expect(() => parseEmvcoQr(bad)).toThrow(QrParseError);
  });

  it('rejects non-EMVCo text', () => {
    expect(() => parseEmvcoQr('https://example.com/some/long/link/here')).toThrow(QrParseError);
  });
});

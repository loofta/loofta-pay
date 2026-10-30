/** EMVCo merchant-presented QR (MPM) parser. PIX, PromptPay, VietQR, QR Ph, QRIS and SGQR are all
 * profiles of this one TLV format, so a single parser covers every rail; only the payout provider differs. */

export type QrScheme = 'PIX' | 'PROMPTPAY' | 'VIETQR' | 'QRPH' | 'QRIS' | 'SGQR' | 'BREB' | 'UNKNOWN';

export interface ParsedQr {
  scheme: QrScheme;
  country: string | null;
  currency: string | null;
  amount: number | null;
  merchantName: string | null;
  merchantCity: string | null;
  mcc: string | null;
  isStatic: boolean;
  reference: string | null;
  /** Scheme-specific payee data (PIX key, PromptPay proxy, VietQR bank BIN + account, ...). */
  payee: Record<string, string>;
}

export class QrParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrParseError';
  }
}

const CURRENCY_BY_NUMERIC: Record<string, string> = {
  '986': 'BRL',
  '764': 'THB',
  '704': 'VND',
  '608': 'PHP',
  '360': 'IDR',
  '458': 'MYR',
  '702': 'SGD',
  '170': 'COP',
};

export function readTlv(data: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < data.length) {
    if (i + 4 > data.length) throw new QrParseError('Truncated QR data');
    const tag = data.slice(i, i + 2);
    const lenStr = data.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenStr)) throw new QrParseError('Not an EMVCo QR code');
    const len = parseInt(lenStr, 10);
    if (i + 4 + len > data.length) throw new QrParseError('Truncated QR data');
    out.set(tag, data.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

/** CRC-16/CCITT-FALSE over everything up to and including the "6304" CRC tag header. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function safeTlv(data: string): Map<string, string> {
  try {
    return readTlv(data);
  } catch {
    return new Map();
  }
}

function mapToRecord(m: Map<string, string>): Record<string, string> {
  return Object.fromEntries(m.entries());
}

export function parseEmvcoQr(raw: string): ParsedQr {
  const text = (raw ?? '').trim();
  if (text.length < 20 || text.length > 1024) throw new QrParseError('Not an EMVCo QR code');

  const crcAt = text.length - 8;
  if (text.slice(crcAt, crcAt + 4) !== '6304') throw new QrParseError('QR code is missing its checksum');
  if (crc16(text.slice(0, crcAt + 4)) !== text.slice(crcAt + 4).toUpperCase()) {
    throw new QrParseError('QR checksum does not match, the code may be damaged');
  }

  const root = readTlv(text);
  if (root.get('00') !== '01') throw new QrParseError('Unsupported QR payload format');

  const currency = CURRENCY_BY_NUMERIC[root.get('53') ?? ''] ?? null;
  if (!currency) throw new QrParseError(`Unsupported QR currency ${root.get('53') ?? ''}`);

  const amountRaw = root.get('54');
  let amount: number | null = null;
  if (amountRaw !== undefined) {
    if (!/^\d+(\.\d+)?$/.test(amountRaw)) throw new QrParseError('Invalid amount in QR code');
    amount = Number(amountRaw);
    if (!(amount > 0)) amount = null;
  }

  const extra = safeTlv(root.get('62') ?? '');

  let scheme: QrScheme = 'UNKNOWN';
  let payee: Record<string, string> = {};

  for (let t = 2; t <= 51; t++) {
    const tag = String(t).padStart(2, '0');
    const val = root.get(tag);
    if (!val) continue;
    const sub = safeTlv(val);
    const gui = (sub.get('00') ?? '').toLowerCase();

    if (gui === 'br.gov.bcb.pix') {
      scheme = 'PIX';
      payee = { key: sub.get('01') ?? '', url: sub.get('25') ?? '', description: sub.get('02') ?? '' };
    } else if (gui === 'a000000677010111' || gui === 'a000000677010112' || gui === 'a000000677010114') {
      scheme = 'PROMPTPAY';
      payee = { mobile: sub.get('01') ?? '', taxId: sub.get('02') ?? '', ewallet: sub.get('03') ?? '' };
    } else if (gui === 'a000000727') {
      scheme = 'VIETQR';
      const acct = safeTlv(sub.get('01') ?? '');
      payee = { bin: acct.get('00') ?? '', account: acct.get('01') ?? '', service: sub.get('02') ?? '' };
    } else if (gui.startsWith('ph.ppmi')) {
      scheme = 'QRPH';
      payee = mapToRecord(sub);
    } else if (gui === 'id.co.qris.www') {
      scheme = 'QRIS';
      payee = mapToRecord(sub);
    } else if (gui.startsWith('sg.sgqr') || gui.startsWith('sg.paynow')) {
      scheme = 'SGQR';
      payee = mapToRecord(sub);
    } else {
      continue;
    }
    break;
  }

  const country = root.get('58') ?? null;
  // Bre-B's merchant GUI string is unconfirmed, so a COP code from Colombia with no known rail is treated as Bre-B.
  if (scheme === 'UNKNOWN' && country === 'CO' && currency === 'COP') scheme = 'BREB';

  return {
    scheme,
    country,
    currency,
    amount,
    merchantName: root.get('59') ?? null,
    merchantCity: root.get('60') ?? null,
    mcc: root.get('52') ?? null,
    isStatic: root.get('01') !== '12',
    reference: extra.get('05') ?? null,
    payee,
  };
}

import { BadRequestException } from '@nestjs/common';
import { enabledMethods, normalizeDisabledMethods } from './partner-withdraw-options';

describe('withdraw options', () => {
  it('everything is on by default, including rows from before the column existed', () => {
    expect(enabledMethods([])).toEqual(['usdc', 'token', 'bank', 'p2p']);
    expect(enabledMethods(undefined)).toEqual(['usdc', 'token', 'bank', 'p2p']);
    expect(enabledMethods(null)).toEqual(['usdc', 'token', 'bank', 'p2p']);
  });
  it('drops the switched-off routes', () => {
    expect(enabledMethods(['bank', 'p2p'])).toEqual(['usdc', 'token']);
  });
  it('removes repeats and rejects unknown names', () => {
    expect(normalizeDisabledMethods(['p2p', 'p2p'])).toEqual(['p2p']);
    expect(() => normalizeDisabledMethods(['paypal'])).toThrow(BadRequestException);
    expect(() => normalizeDisabledMethods('p2p')).toThrow(BadRequestException);
  });
  it('never lets every route be switched off', () => {
    expect(() => normalizeDisabledMethods(['usdc', 'token', 'bank', 'p2p'])).toThrow(BadRequestException);
    expect(normalizeDisabledMethods(['token', 'bank', 'p2p'])).toHaveLength(3);
  });
});

import { demoQuote } from './partner-demo';

describe('demo partner options from the link', () => {
  it('shows every route and history by default', () => {
    const q = demoQuote();
    expect(q.methods).toEqual(['usdc', 'token', 'bank', 'p2p']);
    expect(q.history_enabled).toBe(true);
    expect(q.history.length).toBeGreaterThan(0);
  });
  it('takes a chosen set of routes and can hide history', () => {
    const q = demoQuote({ methods: 'usdc,bank,nonsense', history: '0' });
    expect(q.methods).toEqual(['usdc', 'bank']);
    expect(q.history_enabled).toBe(false);
    expect(q.history).toEqual([]);
  });
  it('falls back to everything if no valid route is given', () => {
    expect(demoQuote({ methods: 'x,y' }).methods).toHaveLength(4);
  });
});

describe('demo partner set up from the link', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { demoQuote } = require('./partner-demo');

  it('takes name, color, fees and prize from the link, clamped and sanitised', () => {
    const q = demoQuote({ name: '<b>Acme</b> Games', color: '3b82f6', fee: '0.5', pct: '2', prize: '400' });
    expect(q.partner.name).toBe('bAcmeb Games');
    expect(q.partner.brand_color).toBe('#3b82f6');
    expect(q.gross_usdc).toBe(400);
    expect(q.partner_fee_usdc).toBe(8.5); // 0.50 flat + 2% of 400
    expect(q.net_usdc).toBe(391.5);
  });

  it('ignores junk and keeps the default sample', () => {
    const q = demoQuote({ color: 'javascript', fee: 'x', pct: '-4', prize: '999999' });
    expect(q.partner.brand_color).toBe('#ff7a2a');
    expect(q.partner.fee_fixed_usd).toBe(0.25);
    expect(q.partner.fee_percent_bps).toBe(0);
    expect(q.gross_usdc).toBe(10000);
  });
});

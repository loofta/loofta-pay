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

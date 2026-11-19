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

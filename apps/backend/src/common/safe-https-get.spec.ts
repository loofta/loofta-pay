import { BadRequestException } from '@nestjs/common';
import { isPrivateIp } from './assert-safe-public-url';
import { guardedLookup, safeHttpsGet } from './safe-https-get';

describe('isPrivateIp', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1'])('blocks %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '151.101.1.1'])('allows %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('safeHttpsGet refuses before any request is made', () => {
  it.each([
    'http://example.com/list.json',
    'https://localhost/list.json',
    'https://127.0.0.1/list.json',
    'https://[::1]/list.json',
    'https://169.254.169.254/latest/meta-data',
    'https://user:pass@example.com/list.json',
    'https://example.com:8443/list.json',
    'https://intranet/list.json',
    'https://thing.internal/list.json',
    'https://thing.local/list.json',
    'ftp://example.com/x',
    'not a url',
  ])('%s', async (url) => {
    await expect(safeHttpsGet(url)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('guardedLookup (the address used for the real connection)', () => {
  it('blocks a hostname that resolves to a private address', async () => {
    const err = await new Promise<Error | null>((resolve) => guardedLookup('localhost', { all: true }, (e) => resolve(e)));
    expect(err).toBeTruthy();
  });
});

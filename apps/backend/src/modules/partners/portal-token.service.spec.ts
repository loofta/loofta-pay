import { UnauthorizedException } from '@nestjs/common';
import { PortalTokenService } from './portal-token.service';

const make = (secret = 'test-secret') =>
  new PortalTokenService({ get: (k: string) => (k === 'INTEGRATOR_KEY_PEPPER' ? secret : undefined) } as never);

describe('PortalTokenService', () => {
  it('round-trips an email session', () => {
    const svc = make();
    const { token } = svc.mint({ partnerId: 'p1', email: 'a@b.co' });
    expect(svc.verify(token)).toEqual({ partnerId: 'p1', email: 'a@b.co' });
  });

  it('round-trips a handle session with a return url', () => {
    const svc = make();
    const { token } = svc.mint({ partnerId: 'p1', platform: 'twitter', handle: 'bob', returnUrl: 'https://x.co/back' });
    expect(svc.verify(token)).toEqual({ partnerId: 'p1', platform: 'twitter', handle: 'bob', returnUrl: 'https://x.co/back' });
  });

  it('refuses to mint without an identity', () => {
    expect(() => make().mint({ partnerId: 'p1' })).toThrow();
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = make('a').mint({ partnerId: 'p1', email: 'a@b.co' });
    expect(() => make('b').verify(token)).toThrow(UnauthorizedException);
  });

  it('rejects a tampered payload (swapped identity)', () => {
    const svc = make();
    const { token } = svc.mint({ partnerId: 'p1', email: 'a@b.co' });
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ pid: 'p1', em: 'victim@b.co', aud: 'loofta-portal-v2', exp: 9999999999 })).toString('base64url');
    expect(() => svc.verify(`${h}.${forged}.${s}`)).toThrow(UnauthorizedException);
  });

  it('rejects an expired token', () => {
    const svc = make();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
    const { token } = svc.mint({ partnerId: 'p1', email: 'a@b.co' });
    spy.mockReturnValue(1_000_000_000_000 + 16 * 60 * 1000);
    expect(() => svc.verify(token)).toThrow(UnauthorizedException);
    spy.mockRestore();
  });
});

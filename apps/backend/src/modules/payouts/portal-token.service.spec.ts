import { UnauthorizedException } from '@nestjs/common';
import { PortalTokenService } from './portal-token.service';

const make = (pepper = 'test-pepper') =>
  new PortalTokenService({ get: (k: string) => (k === 'INTEGRATOR_KEY_PEPPER' ? pepper : undefined) } as never);

describe('PortalTokenService', () => {
  it('round-trips a session', () => {
    const svc = make();
    const { token } = svc.mint({ recipientId: 'r1', integratorId: 'i1' });
    expect(svc.verify(token)).toEqual({ recipientId: 'r1', integratorId: 'i1' });
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = make('a').mint({ recipientId: 'r1', integratorId: 'i1' });
    expect(() => make('b').verify(token)).toThrow(UnauthorizedException);
  });

  it('rejects a tampered payload (swapped recipient)', () => {
    const svc = make();
    const { token } = svc.mint({ recipientId: 'r1', integratorId: 'i1' });
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'r2', iid: 'i1', aud: 'loofta-portal', exp: 9999999999 })).toString('base64url');
    expect(() => svc.verify(`${h}.${forged}.${s}`)).toThrow(UnauthorizedException);
  });

  it('rejects an expired token', () => {
    const svc = make();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
    const { token } = svc.mint({ recipientId: 'r1', integratorId: 'i1' });
    spy.mockReturnValue(1_000_000_000_000 + 16 * 60 * 1000);
    expect(() => svc.verify(token)).toThrow(UnauthorizedException);
    spy.mockRestore();
  });
});

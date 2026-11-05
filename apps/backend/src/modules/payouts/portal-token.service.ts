import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

export const PORTAL_TOKEN_TTL_SECONDS = 15 * 60;

export interface PortalSession {
  /** partner_recipients.id */
  recipientId: string;
  /** integrators.id */
  integratorId: string;
  /** Where the hosted portal's "back" link goes; signed into the token so it can't be swapped. */
  returnUrl?: string;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/**
 * Short-lived HS256 tokens that let one partner end user see and withdraw their own payouts in the
 * embedded portal, with no Loofta account. Minted only by the partner's server (API key); the
 * browser never holds anything longer-lived or broader than one recipient for 15 minutes.
 */
@Injectable()
export class PortalTokenService {
  constructor(private readonly config: ConfigService) {}

  private key(): string {
    // Derived from the integrator pepper (server-only) so no new secret needs provisioning, and
    // domain-separated so a portal token can never double as anything else signed with the pepper.
    const pepper = this.config.get<string>('PARTNER_PORTAL_SECRET') || this.config.get<string>('INTEGRATOR_KEY_PEPPER');
    if (!pepper) throw new Error('PARTNER_PORTAL_SECRET or INTEGRATOR_KEY_PEPPER must be configured');
    return createHmac('sha256', pepper).update('loofta-partner-portal-v1').digest('hex');
  }

  mint(session: PortalSession): { token: string; expires_at: string } {
    const exp = Math.floor(Date.now() / 1000) + PORTAL_TOKEN_TTL_SECONDS;
    const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64(JSON.stringify({ sub: session.recipientId, iid: session.integratorId, aud: 'loofta-portal', exp, ...(session.returnUrl ? { ret: session.returnUrl } : {}) }));
    const sig = createHmac('sha256', this.key()).update(`${header}.${payload}`).digest('base64url');
    return { token: `${header}.${payload}.${sig}`, expires_at: new Date(exp * 1000).toISOString() };
  }

  verify(token: string): PortalSession {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Invalid portal token.');
    const [header, payload, sig] = parts;
    const expected = createHmac('sha256', this.key()).update(`${header}.${payload}`).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('Invalid portal token.');
    }
    let claims: { sub?: string; iid?: string; aud?: string; exp?: number; ret?: string };
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid portal token.');
    }
    if (claims.aud !== 'loofta-portal' || !claims.sub || !claims.iid || !claims.exp || claims.exp < Date.now() / 1000) {
      throw new UnauthorizedException('Portal token expired.');
    }
    return { recipientId: claims.sub, integratorId: claims.iid, ...(claims.ret ? { returnUrl: claims.ret } : {}) };
  }
}

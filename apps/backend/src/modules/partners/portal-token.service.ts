import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

export const PORTAL_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Who the embedded widget is showing. The partner's server asserts the identity (the email or
 * social handle it paid), so this never grants more than "payouts THIS partner made to that
 * identity". Withdrawing still needs the person to sign in as that identity on Loofta.
 */
export interface PortalSession {
  /** partners.id */
  partnerId: string;
  email?: string;
  platform?: string;
  handle?: string;
  /** Where the widget's "back" link goes; signed into the token so it cannot be swapped. */
  returnUrl?: string;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/**
 * Short-lived HS256 tokens for the embedded widget. Minted only by the partner's server (API key);
 * the browser holds one identity for 15 minutes and nothing else.
 */
@Injectable()
export class PortalTokenService {
  constructor(private readonly config: ConfigService) {}

  private key(): string {
    // Derived from a server-only secret and domain-separated so a portal token can never double as
    // anything else signed with it.
    const secret = this.config.get<string>('PARTNER_PORTAL_SECRET') || this.config.get<string>('INTEGRATOR_KEY_PEPPER');
    if (!secret) throw new Error('PARTNER_PORTAL_SECRET or INTEGRATOR_KEY_PEPPER must be configured');
    return createHmac('sha256', secret).update('loofta-partner-portal-v2').digest('hex');
  }

  mint(session: PortalSession): { token: string; expires_at: string } {
    if (!session.email && !(session.platform && session.handle)) throw new Error('A portal token needs an email or a handle.');
    const exp = Math.floor(Date.now() / 1000) + PORTAL_TOKEN_TTL_SECONDS;
    const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64(
      JSON.stringify({
        pid: session.partnerId,
        ...(session.email ? { em: session.email } : { pl: session.platform, hd: session.handle }),
        aud: 'loofta-portal-v2',
        exp,
        ...(session.returnUrl ? { ret: session.returnUrl } : {}),
      }),
    );
    const sig = createHmac('sha256', this.key()).update(`${header}.${payload}`).digest('base64url');
    return { token: `${header}.${payload}.${sig}`, expires_at: new Date(exp * 1000).toISOString() };
  }

  verify(token: string): PortalSession {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Invalid portal token.');
    const [header, payload, sig] = parts;
    const expected = createHmac('sha256', this.key()).update(`${header}.${payload}`).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException('Invalid portal token.');
    let c: { pid?: string; em?: string; pl?: string; hd?: string; aud?: string; exp?: number; ret?: string };
    try {
      c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid portal token.');
    }
    if (c.aud !== 'loofta-portal-v2' || !c.pid || !c.exp || c.exp < Date.now() / 1000 || (!c.em && !(c.pl && c.hd))) {
      throw new UnauthorizedException('Portal token expired.');
    }
    return {
      partnerId: c.pid,
      ...(c.em ? { email: c.em } : { platform: c.pl, handle: c.hd }),
      ...(c.ret ? { returnUrl: c.ret } : {}),
    };
  }
}

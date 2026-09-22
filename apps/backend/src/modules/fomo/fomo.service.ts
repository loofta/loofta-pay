import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_BASE_URL = 'https://getfomoapi.fun';
// The upstream answers in ~1.8s on a hit and ~2.9s on a miss (measured 2026-09-22), and this sits
// in front of someone typing into a form. 15s just meant a bad vendor day left the field spinning;
// give up sooner and show the "no verified wallet" state instead.
const REQUEST_TIMEOUT_MS = 8_000;
// getfomoapi.fun is a flat-fee plan (5 req/s), but resolutions are stable, so cache to stay well
// under the rate limit and keep the pay page snappy. A linked wallet effectively never changes
// (fomo.family wallets are Privy embedded), so a long positive TTL is safe; a negative result
// (handle not found, or found with no wallet yet) is cached briefly so a newly-linked wallet
// starts resolving within minutes rather than hours.
const POSITIVE_TTL_MS = 6 * 60 * 60_000;
const NEGATIVE_TTL_MS = 5 * 60_000;

export interface FomoResolution {
  handle: string;
  /** The handle exists on fomo.family. */
  found: boolean;
  /** found AND a Solana wallet is linked — i.e. we can actually pay them. */
  resolvable: boolean;
  displayName: string | null;
  solanaAddress: string | null;
  profilePicture: string | null;
  fomoUserId: string | null;
}

interface CacheEntry {
  value: FomoResolution;
  expiresAt: number;
}

@Injectable()
export class FomoService {
  private readonly logger = new Logger(FomoService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('FOMO_API_BASE_URL', DEFAULT_BASE_URL);
  }

  private get apiKey(): string {
    const key = this.config.get<string>('FOMO_API_KEY', '');
    if (!key) this.logger.warn('FOMO_API_KEY not set — Fomo handle resolution will fail');
    return key;
  }

  /** Strip a leading @, lowercase, and keep only the characters a fomo handle can contain. */
  normalizeHandle(raw: string): string {
    return String(raw || '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '')
      .slice(0, 64);
  }

  async resolve(rawHandle: string): Promise<FomoResolution> {
    const handle = this.normalizeHandle(rawHandle);
    if (!handle) {
      return { handle: '', found: false, resolvable: false, displayName: null, solanaAddress: null, profilePicture: null, fomoUserId: null };
    }

    const cached = this.cache.get(handle);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const value = await this.fetchResolution(handle);
    this.cache.set(handle, {
      value,
      expiresAt: Date.now() + (value.resolvable ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
    });
    return value;
  }

  private async fetchResolution(handle: string): Promise<FomoResolution> {
    const notFound: FomoResolution = {
      handle, found: false, resolvable: false, displayName: null, solanaAddress: null, profilePicture: null, fomoUserId: null,
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/users/${encodeURIComponent(handle)}`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-API-Key': this.apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(`Fomo resolve network error for "${handle}": ${(err as Error)?.message}`);
      return notFound;
    }

    const text = await res.text();

    // Non-2xx means "we can't resolve this", not a Loofta error. Note the upstream CANNOT
    // distinguish "no such handle" from "handle exists but has no verified wallet": it returns the
    // same 502 {"detail":"Upstream authentication failed"} for both. Verified 2026-09-22 against
    // `test` and `lisa`, which fomoscan.sh confirms exist with solanaAddress: null, yet getfomoapi
    // 502s for each. So `found: false` here means "not payable", never "this person isn't on Fomo" —
    // the UI must not tell the user their handle doesn't exist.
    if (!res.ok) {
      this.logger.warn(`Fomo resolve "${handle}" upstream HTTP ${res.status}: ${text.slice(0, 300)}`);
      return notFound;
    }

    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      this.logger.warn(`Fomo resolve "${handle}" upstream returned non-JSON: ${text.slice(0, 300)}`);
      return notFound;
    }

    const user = body?.responseObject;
    this.logger.log(
      `Fomo resolve "${handle}" upstream 200: success=${body?.success} message=${JSON.stringify(body?.message)} ` +
        `id=${user?.id ?? null} displayName=${JSON.stringify(user?.displayName ?? null)} solana=${user?.solana ?? null} evm=${user?.evm ?? null}`,
    );
    if (!body?.success || !user || typeof user !== 'object') return notFound;

    const solanaAddress = typeof user.solana === 'string' && user.solana.length > 0 ? user.solana : null;
    return {
      handle,
      found: true,
      resolvable: !!solanaAddress,
      displayName: typeof user.displayName === 'string' && user.displayName.length > 0 ? user.displayName : null,
      solanaAddress,
      profilePicture: typeof user.profilePictureLink === 'string' && user.profilePictureLink.length > 0 ? user.profilePictureLink : null,
      fomoUserId: typeof user.id === 'string' ? user.id : null,
    };
  }
}

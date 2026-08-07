import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Server-side Giphy lookup for the winner-claim congrats message. Separate from
 * MessageInput.tsx's client-side GiphyFetch usage (that one runs in the browser against
 * NEXT_PUBLIC_GIPHY_API_KEY) — this needs to run at winner-selection time on the backend, with no
 * browser involved, so it hits Giphy's REST API directly with its own key.
 */
@Injectable()
export class GiveawayGiphyService {
  private readonly logger = new Logger(GiveawayGiphyService.name);

  constructor(private readonly configService: ConfigService) {}

  /** First search result's GIF url, or null if unconfigured/not found — never blocks the payout on a Giphy failure. */
  async getFirstGifUrl(query: string): Promise<string | null> {
    const apiKey = this.configService.get<string>('GIPHY_API_KEY');
    if (!apiKey) return null;
    try {
      const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&limit=1&rating=g`;
      const res = await fetch(url);
      if (!res.ok) {
        this.logger.warn(`[GiveawayGiphy] search failed: ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { data?: Array<{ images?: { original?: { url?: string } } }> };
      return body.data?.[0]?.images?.original?.url ?? null;
    } catch (e) {
      this.logger.warn(`[GiveawayGiphy] search error (non-fatal): ${String(e)}`);
      return null;
    }
  }
}

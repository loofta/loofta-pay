import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';

const MELD_API_VERSION = '2026-05-01';
const BUY_METHODS = ['APPLE_PAY', 'GOOGLE_PAY', 'CREDIT_DEBIT_CARD'];
const MIN_AMOUNT_USD = 1;
const MAX_AMOUNT_USD = 100_000;

interface MeldQuote {
  serviceProvider: string;
  destinationAmount: number;
  totalFee?: number;
  paymentMethodType?: string;
}

export interface BuyOption {
  /** Provider id. Sent back when the session opens, never shown to the person. */
  id: string;
  method: string;
  label: string;
  eta: string;
  /** USDC the person receives. */
  receive: number;
  /** All-in cost in dollars: what they pay minus the USDC they get (USDC is about a dollar). */
  fee: number;
}

const METHOD_LABELS: Record<string, string> = {
  CREDIT_DEBIT_CARD: 'Debit or credit card',
  APPLE_PAY: 'Apple Pay',
  GOOGLE_PAY: 'Google Pay',
  ACH: 'Bank transfer (ACH)',
  BANK_TRANSFER: 'Bank transfer',
  SEPA: 'Bank transfer (SEPA)',
};

/** Typical arrival per rail. Meld gives no timing, so this is the usual, not a promise. */
const eta = (type: string): string => (['CREDIT_DEBIT_CARD', 'APPLE_PAY', 'GOOGLE_PAY'].includes(type) ? 'a few minutes' : type === 'ACH' ? '1 to 3 business days' : 'up to 1 business day');

/**
 * Buy USDC with Apple Pay, Google Pay or a card through Meld. Ported from the main app's Next routes
 * (apps/frontend/src/app/api/meld) so the mini app, which has no server of its own for secrets, can use it.
 * The money goes to the caller's own Loofta wallet: the wallet is read from the account, never taken from the request.
 * The Meld webhook stays in the main app. It matches user_deposits.provider_order_id and marks the deposit complete.
 */
@Injectable()
export class MeldOnrampService {
  private readonly logger = new Logger(MeldOnrampService.name);
  private readonly base = process.env.MELD_API_BASE || 'https://api.meld.io';

  constructor(
    private readonly supabase: SupabaseService,
    private readonly users: UsersService,
  ) {}

  private key(): string {
    const k = process.env.MELD_API_KEY;
    if (!k) throw new HttpException("Card deposits aren't configured yet.", HttpStatus.SERVICE_UNAVAILABLE);
    return k;
  }

  private async meld<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T | null }> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `BASIC ${this.key()}`, 'Meld-Version': MELD_API_VERSION },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => null)) as T | null };
  }

  /** Meld words the minimum as "below the minimum allowed, which is 5.00 USD". Pass the number on. */
  private minimumFrom(data: unknown): string | null {
    const q = data as { code?: string; message?: string } | null;
    const m = q?.message?.match(/minimum[^0-9]*([0-9.]+)\s*(USD|USDC)/i);
    return q?.code?.startsWith('INVALID_AMOUNT') && m ? `The minimum is ${Number(m[1])} ${m[2].toUpperCase()}. Enter a bit more.` : null;
  }

  private amountOf(raw: unknown): number {
    const n = Number(raw);
    if (!(n >= MIN_AMOUNT_USD) || n > MAX_AMOUNT_USD) throw new BadRequestException('Enter an amount.');
    return n;
  }

  private countryOf(country?: string): string {
    return country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : 'US';
  }

  /** Every way to pay for this amount, best first, so the person can choose before anything opens. */
  async quote(amountRaw: unknown, country?: string): Promise<{ country: string; options: BuyOption[]; error?: string }> {
    const amount = this.amountOf(amountRaw);
    const cc = this.countryOf(country);
    // A quote with no method only returns each provider's default, so ask for each wallet and the card by name,
    // plus the plain quote to catch bank transfer. Keep the best provider per method.
    const ask = (method?: string) =>
      this.meld<{ quotes?: MeldQuote[] }>('/payments/crypto/quote', {
        countryCode: cc,
        sourceCurrencyCode: 'USD',
        sourceAmount: String(amount),
        destinationCurrencyCode: 'USDC_SOLANA',
        ...(method ? { paymentMethodType: method } : {}),
      });
    let results;
    try {
      results = await Promise.all([...BUY_METHODS.map((m) => ask(m)), ask()]);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.warn(`quote failed: ${(e as Error).message}`);
      throw new HttpException("Couldn't load options. Try again.", HttpStatus.BAD_GATEWAY);
    }
    const best = new Map<string, MeldQuote>();
    for (const q of results.flatMap((r) => r.data?.quotes ?? [])) {
      const key = q.paymentMethodType ?? 'CREDIT_DEBIT_CARD';
      const cur = best.get(key);
      if (!cur || q.destinationAmount > cur.destinationAmount) best.set(key, q);
    }
    if (best.size === 0) {
      const failed = results.find((r) => !r.ok)?.data ?? results[0].data;
      return { country: cc, options: [], error: this.minimumFrom(failed) ?? undefined };
    }
    const options = [...best.values()]
      .sort((a, b) => b.destinationAmount - a.destinationAmount)
      .map((q) => {
        const method = q.paymentMethodType ?? 'CREDIT_DEBIT_CARD';
        return {
          id: q.serviceProvider,
          method,
          label: METHOD_LABELS[method] ?? method.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
          eta: eta(method),
          receive: q.destinationAmount,
          fee: Math.max(Number(q.totalFee ?? 0), Math.round((amount - q.destinationAmount) * 100) / 100),
        };
      });
    return { country: cc, options };
  }

  /** Opens a Meld checkout that delivers USDC on Solana to the caller's own wallet. Returns the page to open. */
  async session(
    userId: string,
    p: { amount: unknown; serviceProvider?: string; paymentMethodType?: string; country?: string; redirectUrl?: string; clientIp?: string },
  ): Promise<{ widgetUrl: string }> {
    const amount = this.amountOf(p.amount);
    const cc = this.countryOf(p.country);
    const walletAddress = await this.users.getSolanaWalletAddress(userId);
    const method = p.paymentMethodType && /^[A-Z_]{3,40}$/.test(p.paymentMethodType) ? p.paymentMethodType : undefined;
    // After paying, Meld sends the person back. Only a Telegram link is allowed, which reopens the mini app.
    const redirectUrl = p.redirectUrl && /^https:\/\/t\.me\/[\w./?=&-]{1,200}$/.test(p.redirectUrl) ? p.redirectUrl : undefined;

    const quote = await this.meld<{ quotes?: MeldQuote[] }>('/payments/crypto/quote', {
      countryCode: cc,
      sourceCurrencyCode: 'USD',
      sourceAmount: String(amount),
      destinationCurrencyCode: 'USDC_SOLANA',
      ...(method ? { paymentMethodType: method } : {}),
    });
    const ranked = [...(quote.data?.quotes ?? [])].sort((a, b) => b.destinationAmount - a.destinationAmount);
    // The person picked an option: try that provider first, the rest only as a fallback.
    if (p.serviceProvider) ranked.sort((a, b) => Number(b.serviceProvider === p.serviceProvider) - Number(a.serviceProvider === p.serviceProvider));
    if (!quote.ok || ranked.length === 0) {
      throw new HttpException(this.minimumFrom(quote.data) ?? `Card deposits aren't available for this amount or country yet (ref quote ${quote.status}).`, HttpStatus.BAD_GATEWAY);
    }

    const externalSessionId = `dep_${randomUUID()}`;
    let widgetUrl: string | undefined;
    let lastFailure = '';
    for (const q of ranked) {
      const res = await this.meld<{ widgetUrl?: string; code?: string }>('/crypto/session/widget', {
        sessionType: 'BUY',
        externalCustomerId: userId,
        externalSessionId,
        sessionData: {
          countryCode: cc,
          serviceProvider: q.serviceProvider,
          sourceCurrencyCode: 'USD',
          destinationCurrencyCode: 'USDC_SOLANA',
          walletAddress,
          ...(p.clientIp ? { clientIpAddress: p.clientIp } : {}),
          sourceAmount: String(amount),
          ...(method ? { paymentMethodType: method } : {}),
          ...(redirectUrl ? { redirectUrl } : {}),
        },
      });
      if (res.ok && res.data?.widgetUrl) {
        widgetUrl = res.data.widgetUrl;
        break;
      }
      lastFailure = `${res.status}${res.data?.code ? ` ${res.data.code}` : ''}`;
      this.logger.warn(`${q.serviceProvider} refused the session (${lastFailure})`);
    }
    if (!widgetUrl) throw new HttpException(`Couldn't start the card deposit${lastFailure ? ` (ref ${lastFailure})` : ''}.`, HttpStatus.BAD_GATEWAY);

    // Same row the main app writes, so history shows it from the first minute and the webhook can complete it.
    const { error } = await this.supabase.getClient().from('user_deposits').insert({
      user_id: userId,
      type: 'card-onramp',
      status: 'pending',
      amount_usdc: null,
      deposit_address: walletAddress,
      provider_order_id: externalSessionId,
    });
    if (error) this.logger.warn(`deposit row failed (history will miss this one): ${error.message}`);
    return { widgetUrl };
  }
}

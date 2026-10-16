import { Injectable, Logger, BadRequestException, ServiceUnavailableException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '@/modules/users/users.service';
import { ClaimsService } from '@/modules/claims/claims.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import type { AuthenticatedIntegrator } from '@/modules/integrators/integrators.service';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';

// Same 8-char base62 short_id generator as claims.service.ts / send-payment.service.ts /
// twitter-payments.service.ts — copy-pasted per this codebase's existing convention (no shared
// helper) rather than imported.
const SHORT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHORT_ID_MAX_VALID = Math.floor(256 / SHORT_ID_ALPHABET.length) * SHORT_ID_ALPHABET.length;
function generateShortId(length = 8): string {
  let result = '';
  while (result.length < length) {
    const bytes = randomBytes(length - result.length + 4);
    for (const byte of bytes) {
      if (byte < SHORT_ID_MAX_VALID && result.length < length) {
        result += SHORT_ID_ALPHABET[byte % SHORT_ID_ALPHABET.length];
      }
    }
  }
  return result;
}

@Injectable()
export class PaymentLinksService {
  private readonly logger = new Logger(PaymentLinksService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly claimsService: ClaimsService,
  ) {}

  /**
   * Creates a `payments` row with direction='from_recipient' and the calling integrator's owner
   * as recipient — the same shape apps/frontend/src/app/api/claims/create/route.ts already
   * inserts for the human "Get Paid" flow, just reachable by API key instead of a Privy session.
   * Burner minting is delegated to ClaimsService.mintBurnerForExternalCreation — the one piece of
   * this that touches key material — never reimplemented here.
   */
  async create(
    dto: CreatePaymentLinkDto,
    integrator: AuthenticatedIntegrator,
    requestOrigin?: string,
  ): Promise<{ shortId: string; url: string; amount: number; message: string | null; webhookSecret: string | null }> {
    if (!integrator.ownerUserId) {
      // Should be unreachable — only self-serve integrators carry the payment_links:create scope
      // (see IntegratorsService.provisionSelfServe) — but never trust that a client-supplied
      // recipient is safe to fall back to if it somehow isn't set.
      throw new BadRequestException('This API key has no owner to receive payments on behalf of.');
    }

    // Per-link setting, defaults to public — the recipient can already choose to claim privately
    // at claim time, so a payer-side private link is opt-in, not the default. Only the private
    // path has a $1 floor — a plain public transfer has no such constraint.
    const isPrivate = dto.is_private === true;
    if (isPrivate && dto.amount < 1) {
      throw new BadRequestException('Private payment links require a $1 minimum.');
    }

    const recipientAddress = await this.usersService.getSolanaWalletAddress(integrator.ownerUserId);

    // Snapshotted onto the row below (not looked up again at checkout render time) — see the
    // migration comment for why: an already-shared link keeps its original branding even if the
    // merchant changes their logo later.
    let merchantName: string | null = null;
    let merchantLogoUrl: string | null = null;
    if (integrator.organizationId) {
      const { data: org } = await this.supabaseService.organizations
        .select('name, logo_url')
        .eq('id', integrator.organizationId)
        .maybeSingle();
      merchantName = org?.name ?? null;
      merchantLogoUrl = org?.logo_url ?? null;
    }

    const burner = this.claimsService.mintBurnerForExternalCreation();
    if (!burner) {
      throw new ServiceUnavailableException('Could not prepare this payment link right now. Please try again in a moment.');
    }

    // Shown once in the response, same convention as the API key itself — only its value is
    // needed later (to sign each outgoing webhook), so nothing is lost by not storing it in
    // plaintext anywhere retrievable via the API.
    const webhookSecret = dto.webhook_url ? randomBytes(24).toString('hex') : null;

    const shortId = generateShortId();
    const { error } = await this.supabaseService.payments
      .insert({
        amount: Number(dto.amount),
        direction: 'from_recipient',
        recipient_address: recipientAddress,
        created_by: integrator.ownerUserId,
        sender_user_id: null,
        recipient_user_id: integrator.ownerUserId,
        status: 'OPEN',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        to_chain: 'solana',
        to_token: 'USDC',
        is_devnet: isSolanaDevnetFromConfig(this.configService),
        description: dto.message ? dto.message.slice(0, 1000) : null,
        short_id: shortId,
        is_private: isPrivate,
        // Payer always covers any fee — the recipient nets exactly `amount` either way.
        fee_on_sender: true,
        burner_address: burner.claim_burner_address,
        burner_encrypted_secret: burner.claim_burner_encrypted_secret,
        integrator_id: integrator.id,
        webhook_url: dto.webhook_url ?? null,
        webhook_secret: webhookSecret,
        merchant_name: merchantName,
        merchant_logo_url: merchantLogoUrl,
      })
      .select('id')
      .single();
    if (error) {
      this.logger.error(`Failed to create payment link for integrator ${integrator.id}: ${error.message}`);
      throw new Error(`Database error: ${error.message}`);
    }

    // A browser-originated call (e.g. the Developer/demo pages testing their own key) sends
    // Origin — use that so the returned link matches wherever you're actually testing from
    // (localhost included) instead of always pointing at the configured prod URL. A real
    // server-to-server integration call has no Origin header, so it falls through to the
    // configured NEXT_PUBLIC_BASE_URL as before.
    const configuredOrigin = this.configService.get<string>('NEXT_PUBLIC_BASE_URL', 'https://pay.loofta.com');
    const origin = requestOrigin && /^https?:\/\//.test(requestOrigin) ? requestOrigin : configuredOrigin;
    const checkoutUrl = new URL(`${origin}/checkout/${shortId}`);
    if (dto.return_url) checkoutUrl.searchParams.set('callback', dto.return_url);
    return { shortId, url: checkoutUrl.toString(), amount: dto.amount, message: dto.message ?? null, webhookSecret };
  }

  /**
   * Poll status by short_id — the alternative to webhook_url for merchants who'd rather check
   * than be pushed to. Scoped to the calling integrator's own links: 404 (not 403) on a real
   * short_id belonging to someone else, so this can't be used to probe which short_ids exist.
   */
  async getStatus(
    shortId: string,
    integrator: AuthenticatedIntegrator,
  ): Promise<{ shortId: string; status: string; paid: boolean; amount: number; message: string | null; paidAt: string | null }> {
    const { data: row } = await this.supabaseService.payments
      .select('short_id, status, amount, description, paid_at, integrator_id')
      .eq('short_id', shortId)
      .maybeSingle();
    if (!row || row.integrator_id !== integrator.id) {
      throw new NotFoundException('Payment link not found');
    }
    // `status` is Loofta's own internal state — PRIVATE_TRANSFER_PENDING means the customer's
    // payment already landed and only the *recipient's* claim/sweep into their own wallet is still
    // outstanding, which has nothing to do with whether the merchant's order is paid. `paid` is the
    // one field integrators should actually check: true the moment the customer's leg settles,
    // matching what the checkout page's own postMessage/redirect callback already reports.
    const paid = row.status === 'SUCCESS' || row.status === 'PRIVATE_TRANSFER_PENDING';
    return {
      shortId: row.short_id,
      status: row.status,
      paid,
      amount: Number(row.amount),
      message: row.description ?? null,
      paidAt: row.paid_at ?? null,
    };
  }
}

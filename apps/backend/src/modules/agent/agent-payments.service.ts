import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { UsersService } from '../users/users.service';
import { TwitterAutopayService, UncertainPaymentError, type RecipientRef } from '../twitter-autopay/twitter-autopay.service';
import { TELEGRAM_HANDLE_RE, MAX_RECIPIENTS, MAX_COMMAND_AMOUNT_USD, MIN_PRIVATE_AMOUNT_USD } from '../telegram-bot/telegram-parser';
import type { AgentSession } from './agent-auth.service';

const APPROVAL_TTL_MS = 30 * 60 * 1000;

export interface PayRequest {
  payments: Array<{ recipient: string; amount_usd: number }>;
  /** Pay privately (MagicBlock): hides the link between the person's wallet and the recipient's. */
  privately?: boolean;
  delay_minutes?: number;
  split?: number;
}

/** A structured refusal an agent can act on: a stable code plus a plain sentence. */
export const agentError = (code: string, message: string, status: 'bad' | 'forbidden' | 'conflict' = 'bad') => {
  const body = { code, message };
  return status === 'forbidden' ? new ForbiddenException(body) : status === 'conflict' ? new ConflictException(body) : new BadRequestException(body);
};

const money = (n: number) => Math.round(n * 100) / 100;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HANDLE_RULES: Record<RecipientRef['kind'], { re: RegExp; what: string }> = {
  username: { re: /^[a-z0-9][a-z0-9_.-]{1,31}$/, what: 'a Loofta username' },
  email: { re: EMAIL_RE, what: 'an email address' },
  x: { re: /^[a-z0-9_]{1,15}$/, what: 'an X handle' },
  telegram: { re: TELEGRAM_HANDLE_RE, what: 'a Telegram username (5 to 32 letters, numbers or underscores)' },
  discord: { re: /^[a-z0-9_.]{2,32}$/, what: 'a Discord username' },
  github: { re: /^[a-z0-9-]{1,39}$/, what: 'a GitHub username' },
};
const PREFIXES: Record<string, RecipientRef['kind']> = {
  loofta: 'username', username: 'username', x: 'x', twitter: 'x', telegram: 'telegram', tg: 'telegram', discord: 'discord', github: 'github', email: 'email',
};

/**
 * Who to pay, in the forms people actually use: "@alice" or "alice" is a Loofta username, an email
 * address is an email, and "x:alice", "telegram:alice", "discord:alice", "github:alice" name a handle
 * on that platform. Someone who is not on Loofta yet gets a claim link, like in the app.
 */
export function parseRecipient(input: unknown): { ref: RecipientRef; key: string; label: string } | null {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return null;
  let kind: RecipientRef['kind'];
  let value: string;
  const m = raw.match(/^([a-z]+):(.+)$/);
  if (m && PREFIXES[m[1]]) {
    kind = PREFIXES[m[1]];
    value = m[2].trim();
  } else if (EMAIL_RE.test(raw)) {
    kind = 'email';
    value = raw;
  } else {
    kind = 'username';
    value = raw;
  }
  value = value.replace(/^@/, '');
  if (!HANDLE_RULES[kind].re.test(value)) return null;
  const key = `${kind}:${value}`;
  const label = kind === 'email' ? value : kind === 'username' ? `@${value}` : `${kind}:@${value}`;
  return { ref: { kind, value }, key, label };
}

/**
 * What an agent can do with the person's money, with the same machinery as the Telegram bot (fees,
 * signing, double-charge safety), and three extra rules: a session has its own limits inside the
 * person's; anything above the auto-approve amount, or to someone new, waits for the person to approve
 * it in the app; and every request carries an idempotency key so a retry can never pay twice.
 */
@Injectable()
export class AgentPaymentsService {
  private readonly logger = new Logger(AgentPaymentsService.name);

  constructor(
    private readonly db: SupabaseService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly autopay: TwitterAutopayService,
  ) {}

  private get appUrl() {
    return (this.config.get<string>('NEXT_PUBLIC_APP_URL') || this.config.get<string>('NEXT_PUBLIC_BASE_URL') || 'https://pay.loofta.xyz').replace(/\/$/, '');
  }
  private get isDevnet() {
    return isSolanaDevnetFromConfig(this.config);
  }

  private requireScope(session: AgentSession, scope: 'read' | 'pay') {
    if (!session.scopes.includes(scope)) throw agentError('missing_scope', `This session was not granted '${scope}'. Log in again and approve it.`, 'forbidden');
  }

  // ---------------------------------------------------------------------------------------------
  // Read

  async me(session: AgentSession) {
    this.requireScope(session, 'read');
    const [address, bal, payer, spentToday] = await Promise.all([
      this.users.getSolanaWalletAddress(session.userId).catch(() => null),
      this.users.getSolanaWalletBalanceAndAddress(session.userId).then((r) => r.balanceUSD).catch(() => null),
      this.autopay.resolvePayerByUserId(session.userId),
      this.spentByAgentToday(session.id),
    ]);
    return {
      wallet_address: address,
      balance_usd: bal,
      auto_pay_on: !!payer?.signerGranted,
      session: {
        id: session.id,
        label: session.label,
        scopes: session.scopes,
        per_payment_cap_usd: session.perPaymentCapUsd,
        daily_cap_usd: session.dailyCapUsd,
        auto_approve_usd: session.autoApproveUsd,
        spent_today_usd: spentToday,
        remaining_today_usd: money(Math.max(0, session.dailyCapUsd - spentToday)),
        expires_at: session.expiresAt,
      },
    };
  }

  /** People this account has paid before (through agents or the Telegram bot), most recent first. */
  async contacts(session: AgentSession, limit = 30) {
    this.requireScope(session, 'read');
    const supabase = this.db.getClient();
    const [a, b] = await Promise.all([
      supabase.from('agent_actions').select('handles, created_at').eq('user_id', session.userId).in('status', ['paid', 'partial']).order('created_at', { ascending: false }).limit(100),
      supabase.from('telegram_bot_actions').select('recipient_handle, created_at').eq('privy_user_id', session.userId).eq('kind', 'pay').eq('status', 'paid').order('created_at', { ascending: false }).limit(100),
    ]);
    const seen = new Map<string, { recipient: string; last_paid_at: string }>();
    const add = (key: string, at: string) => {
      const who = parseRecipient(key);
      if (who && !seen.has(who.key)) seen.set(who.key, { recipient: key.startsWith('username:') ? who.label : key, last_paid_at: at });
    };
    for (const r of a.data ?? []) for (const h of r.handles ?? []) add(h, r.created_at);
    for (const r of b.data ?? []) if (r.recipient_handle) add(`telegram:${r.recipient_handle}`, r.created_at);
    return [...seen.values()].sort((x, y) => y.last_paid_at.localeCompare(x.last_paid_at)).slice(0, Math.min(100, Math.max(1, limit)));
  }

  /** Whether someone is on Loofta, so the agent knows if they get the money directly or a claim link. */
  async lookup(session: AgentSession, recipient: string) {
    this.requireScope(session, 'read');
    const who = parseRecipient(recipient);
    if (!who) throw agentError('bad_recipient', `"${recipient}" is not a recipient I can pay. Use a Loofta username (@alice), an email address, or x:alice, telegram:alice, discord:alice, github:alice.`);
    const plan = await this.autopay.planPayment(who.ref, false, this.isDevnet, 0);
    return { recipient: who.label, on_loofta: plan.registered, delivery: plan.delivery };
  }

  private async spentByAgentToday(sessionId: string): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await this.db
      .getClient()
      .from('agent_actions')
      .select('amount_usd')
      .eq('session_id', sessionId)
      .in('status', ['paid', 'partial', 'processing', 'unconfirmed'])
      .gte('created_at', since);
    return money((data ?? []).reduce((t: number, r: any) => t + Number(r.amount_usd ?? 0), 0));
  }

  // ---------------------------------------------------------------------------------------------
  // Quote and pay

  /** Reads and checks a request. Everything that can be refused is refused here, before any money moves. */
  private normalize(session: AgentSession, req: PayRequest) {
    const list = Array.isArray(req?.payments) ? req.payments : [];
    if (list.length < 1) throw agentError('no_payments', 'Give at least one payment: a recipient and an amount in USD.');
    if (list.length > MAX_RECIPIENTS) throw agentError('too_many', `At most ${MAX_RECIPIENTS} people per request.`);
    const isPrivate = req.privately === true;
    const items = list.map((p) => {
      const who = parseRecipient(p?.recipient);
      const amount = money(Number(p?.amount_usd));
      if (!who) throw agentError('bad_recipient', `"${p?.recipient}" is not a recipient I can pay. Use a Loofta username (@alice), an email address, or x:alice, telegram:alice, discord:alice, github:alice.`);
      if (!(amount > 0) || Math.abs(amount - Number(p.amount_usd)) > 1e-9) throw agentError('bad_amount', 'Amounts are in USD with at most 2 decimals, more than 0.');
      if (amount > MAX_COMMAND_AMOUNT_USD) throw agentError('bad_amount', `The most one payment can be is $${MAX_COMMAND_AMOUNT_USD}.`);
      if (isPrivate && amount < MIN_PRIVATE_AMOUNT_USD) throw agentError('bad_amount', `Private payments start at $${MIN_PRIVATE_AMOUNT_USD}.`);
      if (amount > session.perPaymentCapUsd) throw agentError('over_session_limit', `$${amount} is over this session's $${session.perPaymentCapUsd} per-payment limit.`, 'forbidden');
      return { ...who, amount };
    });
    if (new Set(items.map((i) => i.key)).size !== items.length) throw agentError('duplicate_recipient', 'Each person can only be paid once per request.');
    const delay = req.delay_minutes != null ? Math.round(Number(req.delay_minutes)) : null;
    const split = req.split != null ? Math.round(Number(req.split)) : null;
    if ((delay != null || split != null) && !isPrivate) throw agentError('private_only', 'delay_minutes and split only apply to private payments.');
    if (delay != null && !(delay >= 1 && delay <= 1440)) throw agentError('bad_delay', 'delay_minutes must be between 1 and 1440.');
    if (split != null && !(split >= 1 && split <= 15)) throw agentError('bad_split', 'split must be between 1 and 15.');
    return { items, isPrivate, delay, split, total: money(items.reduce((t, i) => t + i.amount, 0)) };
  }

  /** What the request would cost and how it would be delivered. Moves nothing. */
  async quote(session: AgentSession, req: PayRequest) {
    this.requireScope(session, 'pay');
    const n = this.normalize(session, req);
    const plans = await Promise.all(n.items.map((i) => this.autopay.planPayment(i.ref, n.isPrivate, this.isDevnet, i.amount)));
    const feesTotal = money(plans.reduce((t, p) => t + p.totalUsd - 0, 0)) - n.total;
    const needsApproval = await this.needsApproval(session, n.items, n.total);
    return {
      recipients: n.items.map((i, k) => ({
        recipient: i.label,
        amount_usd: i.amount,
        on_loofta: plans[k].registered,
        delivery: plans[k].delivery, // instant, claim (they get a link) or private
        loofta_fee_usd: money(plans[k].looftaFeeUsd),
        claim_fee_usd: money(plans[k].claimFeeUsd),
        private_fee_usd: money(plans[k].privateFeeUsd),
      })),
      total_amount_usd: n.total,
      total_fees_usd: money(feesTotal),
      total_from_wallet_usd: money(plans.reduce((t, p) => t + p.totalUsd, 0)),
      private: n.isPrivate,
      needs_approval: needsApproval.needs,
      approval_reason: needsApproval.reason,
    };
  }

  private async needsApproval(session: AgentSession, items: Array<{ key: string; label: string }>, total: number): Promise<{ needs: boolean; reason: string | null }> {
    if (total > session.autoApproveUsd) {
      return { needs: true, reason: session.autoApproveUsd > 0 ? `Over the $${session.autoApproveUsd} this session may send without asking.` : 'This session asks before every payment.' };
    }
    for (const i of items) {
      if (!(await this.isKnownRecipient(session.userId, i.key))) return { needs: true, reason: `${i.label} has not been paid from this account before.` };
    }
    return { needs: false, reason: null };
  }

  private async isKnownRecipient(userId: string, key: string): Promise<boolean> {
    const supabase = this.db.getClient();
    const telegramHandle = key.startsWith('telegram:') ? key.slice('telegram:'.length) : null;
    const [a, b] = await Promise.all([
      supabase.from('agent_actions').select('id').eq('user_id', userId).in('status', ['paid', 'partial']).contains('handles', [key]).limit(1),
      telegramHandle
        ? supabase.from('telegram_bot_actions').select('id').eq('privy_user_id', userId).eq('kind', 'pay').eq('recipient_handle', telegramHandle).eq('status', 'paid').limit(1)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    return !!(a.data?.length || b.data?.length);
  }

  async pay(session: AgentSession, req: PayRequest, idempotencyKey: string) {
    this.requireScope(session, 'pay');
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      throw agentError('idempotency_key_required', 'Send an idempotency_key (8 to 100 characters, unique per intended payment). Retrying with the same key never pays twice.');
    }
    const n = this.normalize(session, req);
    const handles = n.items.map((i) => i.key);

    // A retry of something already asked for: hand back what happened, never run it again.
    const existing = await this.findByKey(session.id, idempotencyKey);
    if (existing) {
      const same = existing.amount_usd === n.total && JSON.stringify([...existing.handles].sort()) === JSON.stringify([...handles].sort());
      if (!same) throw agentError('idempotency_key_reused', 'That idempotency_key was already used for a different request.', 'conflict');
      return this.view(existing);
    }

    const payer = await this.autopay.resolvePayerByUserId(session.userId);
    if (!payer?.signerGranted) throw agentError('auto_pay_off', `Turn on auto-pay first: ${this.appUrl}/app/auto-pay`, 'forbidden');

    // Limits: this session's, then the person's own.
    const spent = await this.spentByAgentToday(session.id);
    if (spent + n.total > session.dailyCapUsd) {
      throw agentError('over_session_limit', `That would take this session past its $${session.dailyCapUsd} daily limit ($${spent} already used in the last 24 hours).`, 'forbidden');
    }
    try {
      for (const i of n.items) await this.autopay.assertWithinLimits(payer, i.amount, { dailyTotalUsd: n.total });
    } catch (e) {
      if (e instanceof BadRequestException) throw agentError('over_account_limit', (e.getResponse() as any)?.message ?? e.message, 'forbidden');
      throw e;
    }
    const plans = await Promise.all(n.items.map((i) => this.autopay.planPayment(i.ref, n.isPrivate, this.isDevnet, i.amount)));
    const balance = await this.users.getSolanaWalletBalanceAndAddress(session.userId).then((r) => r.balanceUSD).catch(() => null);
    const need = money(plans.reduce((t, p) => t + p.totalUsd, 0));
    if (balance != null && balance + 1e-9 < need) throw agentError('insufficient_balance', `The wallet has $${money(balance)} and this needs $${need} with fees.`, 'forbidden');

    const approval = await this.needsApproval(session, n.items, n.total);
    const payload = {
      recipients: n.items.map((i, k) => ({ handle: i.key, label: i.label, ref: i.ref, amount_usd: i.amount, delivery: plans[k].delivery, total_usd: money(plans[k].totalUsd) })),
      options: { delay_minutes: n.delay, split: n.split },
      total_from_wallet_usd: need,
      approval_reason: approval.reason,
      results: [] as any[],
    };
    const { data: row, error } = await this.db.getClient().from('agent_actions').insert({
      session_id: session.id,
      user_id: session.userId,
      kind: 'pay',
      idempotency_key: idempotencyKey,
      status: approval.needs ? 'needs_approval' : 'processing',
      amount_usd: n.total,
      is_private: n.isPrivate,
      handles,
      payload,
      expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
    }).select('*').single();
    if (error || !row) {
      if (error?.code === '23505') { // a parallel request with the same key won the race
        const again = await this.findByKey(session.id, idempotencyKey);
        if (again) return this.view(again);
      }
      this.logger.error(`pay insert failed: ${error?.message}`);
      throw agentError('failed', 'Could not record the payment. Nothing was sent. Try again.');
    }
    if (approval.needs) return this.view(row);
    return this.run(row);
  }

  // ---------------------------------------------------------------------------------------------
  // Run, approve, read back

  /** Pays each recipient in turn. The row is already 'processing' (the lock), so it cannot run twice. */
  private async run(row: any) {
    const supabase = this.db.getClient();
    const payer = await this.autopay.resolvePayerByUserId(row.user_id);
    const opts = row.payload.options ?? {};
    const results: any[] = [];
    let unconfirmed = false;
    try {
      if (!payer?.signerGranted) throw agentError('auto_pay_off', 'Auto-pay is turned off.', 'forbidden');
      await this.autopay.assertWithinLimits(payer, row.amount_usd, { excludeAgentActionId: row.id, dailyTotalUsd: row.amount_usd });
    } catch (e) {
      const msg = e instanceof BadRequestException || e instanceof ForbiddenException ? String((e.getResponse() as any)?.message ?? e.message) : 'Could not start the payment.';
      await supabase.from('agent_actions').update({ status: 'failed', error: msg, updated_at: new Date().toISOString() }).eq('id', row.id);
      return this.view({ ...row, status: 'failed', error: msg });
    }

    for (const r of row.payload.recipients) {
      if (unconfirmed) { results.push({ handle: r.handle, status: 'not_attempted' }); continue; }
      try {
        const res = await this.autopay.executePayment({
          senderUserId: row.user_id,
          recipient: r.ref,
          description: 'Sent from an AI agent via Loofta',
          amountUsd: r.amount_usd,
          isPrivate: row.is_private,
          isDevnet: this.isDevnet,
          splitOverride: opts.split ?? null,
          maxDelayMsOverride: opts.delay_minutes ? opts.delay_minutes * 60_000 : null,
        });
        results.push({
          handle: r.handle,
          status: 'sent',
          payment_id: res.paymentId,
          link: res.shortId ? `${this.appUrl}/share/${res.shortId}` : res.claimLink,
          claim_link: res.claimLink,
        });
      } catch (e) {
        if (e instanceof UncertainPaymentError) {
          this.logger.error(`Agent payment ${row.id} to ${r.label ?? r.handle} UNCONFIRMED: ${e.message}`);
          results.push({ handle: r.handle, status: 'unconfirmed', error: 'Could not confirm whether it went through. Check the wallet balance before retrying.' });
          unconfirmed = true;
        } else {
          const msg = e instanceof BadRequestException ? String((e.getResponse() as any)?.message ?? e.message) : /insufficient funds/i.test((e as Error).message) ? 'Not enough USDC in the wallet.' : 'Something went wrong, nothing was sent.';
          this.logger.error(`Agent payment ${row.id} to ${r.label ?? r.handle} failed: ${(e as Error).message}`);
          results.push({ handle: r.handle, status: 'failed', error: msg });
        }
      }
    }
    const sent = results.filter((x) => x.status === 'sent').length;
    const status = unconfirmed ? 'unconfirmed' : sent === results.length ? 'paid' : sent > 0 ? 'partial' : 'failed';
    const payload = { ...row.payload, results };
    await supabase.from('agent_actions').update({ status, payload, updated_at: new Date().toISOString() }).eq('id', row.id);
    return this.view({ ...row, status, payload });
  }

  /** The person approves in the app. The needs_approval -> processing flip is the lock. */
  async approve(userId: string, actionId: string) {
    const supabase = this.db.getClient();
    const { data: claimed } = await supabase
      .from('agent_actions')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', actionId)
      .eq('user_id', userId)
      .eq('status', 'needs_approval')
      .gt('expires_at', new Date().toISOString())
      .select('*');
    if (!claimed?.length) {
      const { data: existing } = await supabase.from('agent_actions').select('*').eq('id', actionId).eq('user_id', userId).maybeSingle();
      if (!existing) throw new NotFoundException('Request not found.');
      if (existing.status === 'needs_approval') {
        await supabase.from('agent_actions').update({ status: 'expired' }).eq('id', actionId).eq('status', 'needs_approval');
        throw agentError('expired', 'This request expired. Ask your agent to send it again.', 'conflict');
      }
      return this.view(existing); // already handled: show what happened, run nothing
    }
    return this.run(claimed[0]);
  }

  async deny(userId: string, actionId: string) {
    const { data } = await this.db.getClient().from('agent_actions').update({ status: 'denied', updated_at: new Date().toISOString() }).eq('id', actionId).eq('user_id', userId).eq('status', 'needs_approval').select('*');
    if (!data?.length) throw new NotFoundException('Nothing waiting for approval with that id.');
    return this.view(data[0]);
  }

  /** The agent checking on a request it made. */
  async get(session: AgentSession, actionId: string) {
    this.requireScope(session, 'read');
    const { data } = await this.db.getClient().from('agent_actions').select('*').eq('id', actionId).eq('session_id', session.id).maybeSingle();
    if (!data) throw new NotFoundException('Request not found.');
    return this.view(await this.expireIfStale(data));
  }

  /** The person looking at a request in the app, to approve or deny it. */
  async getForUser(userId: string, actionId: string) {
    const { data } = await this.db.getClient().from('agent_actions').select('*').eq('id', actionId).eq('user_id', userId).maybeSingle();
    if (!data) throw new NotFoundException('Request not found.');
    const { data: session } = await this.db.getClient().from('agent_sessions').select('label').eq('id', data.session_id).maybeSingle();
    return { ...this.view(await this.expireIfStale(data)), agent: session?.label ?? 'Agent' };
  }

  async list(session: AgentSession, limit = 20) {
    this.requireScope(session, 'read');
    const { data } = await this.db.getClient().from('agent_actions').select('*').eq('session_id', session.id).order('created_at', { ascending: false }).limit(Math.min(50, Math.max(1, limit)));
    return (data ?? []).map((r: any) => this.view(r));
  }

  private async findByKey(sessionId: string, key: string) {
    const { data } = await this.db.getClient().from('agent_actions').select('*').eq('session_id', sessionId).eq('idempotency_key', key).maybeSingle();
    return data ?? null;
  }

  private async expireIfStale(row: any) {
    if (row.status === 'needs_approval' && new Date(row.expires_at).getTime() < Date.now()) {
      await this.db.getClient().from('agent_actions').update({ status: 'expired' }).eq('id', row.id).eq('status', 'needs_approval');
      return { ...row, status: 'expired' };
    }
    return row;
  }

  /** What the agent (and the approval page) sees. */
  private view(row: any) {
    const results: any[] = row.payload?.results ?? [];
    return {
      id: row.id,
      status: row.status as 'needs_approval' | 'processing' | 'paid' | 'partial' | 'failed' | 'denied' | 'expired' | 'unconfirmed',
      total_usd: Number(row.amount_usd),
      total_from_wallet_usd: row.payload?.total_from_wallet_usd ?? null,
      private: !!row.is_private,
      recipients: (row.payload?.recipients ?? []).map((r: any) => {
        const res = results.find((x) => x.handle === r.handle);
        return {
          recipient: r.label ?? `@${r.handle}`,
          amount_usd: r.amount_usd,
          delivery: r.delivery,
          status: res?.status ?? (row.status === 'needs_approval' ? 'waiting' : row.status === 'processing' ? 'in_progress' : 'not_sent'),
          link: res?.link,
          claim_link: res?.claim_link,
          error: res?.error,
        };
      }),
      approval_url: row.status === 'needs_approval' ? `${this.appUrl}/agent?approve=${row.id}` : undefined,
      approval_reason: row.status === 'needs_approval' ? row.payload?.approval_reason : undefined,
      expires_at: row.status === 'needs_approval' ? row.expires_at : undefined,
      error: row.error ?? undefined,
      created_at: row.created_at,
    };
  }
}

import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { SupabaseService } from '@/database/supabase.service';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { UsersService } from '../users/users.service';
import { MiniProfileService } from '../mini-feed/mini-profile.service';
import { dexInfo } from '../mini-app/lib/dex';
import { curveSnapshots } from '../mini-app/lib/curve';

const WSOL = 'So11111111111111111111111111111111111111112';

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const EVENT_RE = /^[A-Za-z0-9_.:-]{3,120}$/;
const PAGE = 50;
/** Links are how chat spam and wallet drainers spread, so none are allowed. */
const LINK_RE = /(https?:\/\/|www\.|t\.me\/|\b[a-z0-9-]+\.(com|io|xyz|fun|app|gg|me|net|org|ly)\b)/i;
const MIN_GAP_MS = 4_000;
/** Smallest bag, in dollars, that earns the right to post on a coin. */
export const MIN_HOLD_USD = 2;

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  /** Share of total supply the poster held when they wrote it, 0..100. null if unknown. */
  holdingPct: number | null;
  /** Coin units held when they wrote it. null if unknown. */
  holdingAmount: number | null;
  createdAt: string;
  /** Replies under this take. Only on top-level takes. */
  replyCount?: number;
  /** Set on a reply: the take it answers. */
  parentId?: string | null;
  /** True on a reply written by the author of the take it answers, an update rather than a comment. */
  isUpdate?: boolean;
}

@Injectable()
export class CoinChatService {
  private readonly logger = new Logger(CoinChatService.name);
  private conn: Connection | null = null;
  private readonly lastPost = new Map<string, number>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly profiles: MiniProfileService,
  ) {}

  private connection(): Connection {
    if (!this.conn) this.conn = new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');
    return this.conn;
  }

  async list(mint: string, before?: string): Promise<{ messages: ChatMessage[] }> {
    if (!MINT_RE.test(mint)) throw new BadRequestException('Invalid coin');
    let q = this.supabase
      .getClient()
      .from('coin_chat_messages')
      .select('id, privy_user_id, display_name, text, holding_pct, holding_amount, created_at')
      .eq('mint', mint)
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .limit(PAGE);
    if (before && !Number.isNaN(Date.parse(before))) q = q.lt('created_at', before);
    const { data, error } = await q;
    if (error) {
      this.logger.warn(`list failed: ${error.message}`);
      throw new HttpException('Chat is not available right now', HttpStatus.SERVICE_UNAVAILABLE);
    }
    // Names are the ones people chose, read now, so a change shows on their old messages too. Someone without one shows as an anonymous name.
    const profs = await this.profiles.many([...new Set((data ?? []).map((r) => r.privy_user_id as string))]);
    const nameOf = (id: string) => (profs.get(id)?.hideName ? null : profs.get(id)?.handle) ?? `trader${id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toLowerCase()}`;
    // Oldest first, so the client can append.
    const counts = await this.replyCounts((data ?? []).map((r) => r.id as string));
    const messages = (data ?? []).reverse().map((r) => ({
      id: r.id as string,
      name: nameOf(r.privy_user_id as string),
      text: r.text as string,
      holdingPct: r.holding_pct == null ? null : Number(r.holding_pct),
      holdingAmount: r.holding_amount == null ? null : Number(r.holding_amount),
      createdAt: r.created_at as string,
      replyCount: counts.get(r.id as string) ?? 0,
    }));
    return { messages };
  }

  async post(privyUserId: string, mint: string, raw: string, parentId?: string): Promise<ChatMessage> {
    if (!MINT_RE.test(mint)) throw new BadRequestException('Invalid coin');
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text.length < 1 || text.length > 200) throw new BadRequestException('Messages are 1 to 200 characters');
    if (LINK_RE.test(text)) throw new BadRequestException('Links are not allowed in chat');
    const now = Date.now();
    if (now - (this.lastPost.get(privyUserId) ?? 0) < MIN_GAP_MS) throw new HttpException('Slow down a little', HttpStatus.TOO_MANY_REQUESTS);
    this.lastPost.set(privyUserId, now);
    if (this.lastPost.size > 5000) this.lastPost.clear();

    // A reply always hangs off the top-level take, even when it was sent from under another reply.
    let rootId: string | null = null;
    let rootAuthor: string | null = null;
    if (parentId) {
      if (!UUID_RE.test(parentId)) throw new BadRequestException('Bad reply');
      const { data: parent } = await this.supabase.getClient().from('coin_chat_messages').select('id, mint, privy_user_id, parent_id').eq('id', parentId).maybeSingle();
      if (!parent || parent.mint !== mint) throw new BadRequestException('That take is gone.');
      rootId = (parent.parent_id as string | null) ?? (parent.id as string);
      rootAuthor = parent.parent_id ? ((await this.supabase.getClient().from('coin_chat_messages').select('privy_user_id').eq('id', rootId).maybeSingle()).data?.privy_user_id as string | undefined) ?? null : (parent.privy_user_id as string);
    }

    await this.profiles.ensureProfile(privyUserId);
    const [name, holding] = await Promise.all([this.profiles.displayName(privyUserId), this.holding(privyUserId, mint)]);
    // Only people who hold the coin can talk about it. If the balance cannot be read, nothing is posted rather than guessed.
    if (!holding) throw new HttpException('Could not check your balance. Try again in a moment.', HttpStatus.SERVICE_UNAVAILABLE);
    if (!(holding.amount > 0)) throw new HttpException(`Only people holding at least $${MIN_HOLD_USD} of this coin can post here. Buy some first.`, HttpStatus.FORBIDDEN);
    // Priced now from the market, never from the app. If the price is unknown nothing is posted rather than guessed.
    const price = await this.priceUsd(mint);
    if (price == null) throw new HttpException('Could not price this coin yet. Try again in a moment.', HttpStatus.SERVICE_UNAVAILABLE);
    if (holding.amount * price < MIN_HOLD_USD) throw new HttpException(`You need at least $${MIN_HOLD_USD} of this coin to post. You hold $${(holding.amount * price).toFixed(2)}.`, HttpStatus.FORBIDDEN);
    const { data, error } = await this.supabase
      .getClient()
      .from('coin_chat_messages')
      .insert({
        mint,
        privy_user_id: privyUserId,
        display_name: name,
        text,
        holding_amount: holding?.amount ?? null,
        holding_pct: holding?.pct ?? null,
        parent_id: rootId,
      })
      .select('id, display_name, text, holding_pct, holding_amount, created_at')
      .single();
    if (error || !data) {
      this.logger.warn(`post failed: ${error?.message}`);
      throw new HttpException('Could not send your message', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { id: data.id, name: data.display_name, text: data.text, holdingPct: data.holding_pct == null ? null : Number(data.holding_pct), holdingAmount: data.holding_amount == null ? null : Number(data.holding_amount), createdAt: data.created_at, parentId: rootId, isUpdate: !!rootId && rootAuthor === privyUserId, replyCount: 0 };
  }


  /** How many replies each of these takes has. */
  private async replyCounts(ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!ids.length) return out;
    const { data } = await this.supabase.getClient().from('coin_chat_messages').select('parent_id').in('parent_id', ids).limit(5000);
    for (const r of data ?? []) out.set(r.parent_id as string, (out.get(r.parent_id as string) ?? 0) + 1);
    return out;
  }

  /** One take with every reply under it, oldest first. Replies by the take's own author are marked as updates. */
  async thread(id: string): Promise<{ mint: string; root: ChatMessage; replies: ChatMessage[] }> {
    if (!UUID_RE.test(id)) throw new BadRequestException('Bad take');
    const db = this.supabase.getClient();
    const { data: root } = await db.from('coin_chat_messages').select('id, mint, privy_user_id, text, holding_pct, holding_amount, created_at, parent_id').eq('id', id).maybeSingle();
    if (!root) throw new NotFoundException('That take is gone.');
    const rootId = (root.parent_id as string | null) ?? (root.id as string);
    const top = root.parent_id ? (await db.from('coin_chat_messages').select('id, mint, privy_user_id, text, holding_pct, holding_amount, created_at').eq('id', rootId).maybeSingle()).data : root;
    if (!top) throw new NotFoundException('That take is gone.');
    const { data: rows } = await db.from('coin_chat_messages').select('id, privy_user_id, text, holding_pct, holding_amount, created_at').eq('parent_id', rootId).order('created_at', { ascending: true }).limit(200);
    const ids = [...new Set([top.privy_user_id as string, ...(rows ?? []).map((r) => r.privy_user_id as string)])];
    const profs = await this.profiles.many(ids);
    const nameOf = (uid: string) => (profs.get(uid)?.hideName ? null : profs.get(uid)?.handle) ?? `trader${uid.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toLowerCase()}`;
    const shape = (r: any, isReply: boolean): ChatMessage => ({
      id: r.id,
      name: nameOf(r.privy_user_id),
      text: r.text,
      holdingPct: r.holding_pct == null ? null : Number(r.holding_pct),
      holdingAmount: r.holding_amount == null ? null : Number(r.holding_amount),
      createdAt: r.created_at,
      parentId: isReply ? rootId : null,
      isUpdate: isReply && r.privy_user_id === top.privy_user_id,
    });
    return { mint: top.mint as string, root: shape(top, false), replies: (rows ?? []).map((r) => shape(r, true)) };
  }

  /** Dollar price now. DexScreener once a coin trades on the open market, otherwise the Pump bonding curve's own reserves (1B supply). */
  private async priceUsd(mint: string): Promise<number | null> {
    const dex = (await dexInfo([mint, WSOL]).catch(() => new Map())) as Map<string, { priceUsd: number | null }>;
    const direct = dex.get(mint)?.priceUsd ?? null;
    if (direct != null && direct > 0) return direct;
    const sol = dex.get(WSOL)?.priceUsd ?? null;
    const snap = (await curveSnapshots([mint]).catch(() => new Map())).get(mint);
    if (!snap || sol == null) return null;
    return (snap.mcapSol * sol) / 1_000_000_000;
  }

  // ------------------------------------------------------------ takes on prediction events

  /** What the person has put on one event, from the predictions the backend recorded. */
  private async staked(privyUserId: string, eventId: string): Promise<number> {
    const { data } = await this.supabase.getClient().from('mini_activity').select('amount_usd').eq('privy_user_id', privyUserId).eq('event_id', eventId).limit(500);
    return (data ?? []).reduce((n, r) => n + (Number(r.amount_usd) || 0), 0);
  }

  async listEvent(eventId: string, before?: string): Promise<{ messages: ChatMessage[] }> {
    if (!EVENT_RE.test(eventId)) throw new BadRequestException('Invalid event');
    let q = this.supabase.getClient().from('event_takes').select('id, privy_user_id, text, staked_usd, created_at').eq('event_id', eventId).order('created_at', { ascending: false }).limit(PAGE);
    if (before && !Number.isNaN(Date.parse(before))) q = q.lt('created_at', before);
    const { data, error } = await q;
    if (error) {
      this.logger.warn(`event list failed: ${error.message}`);
      throw new HttpException('Takes are not available right now', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const profs = await this.profiles.many([...new Set((data ?? []).map((r) => r.privy_user_id as string))]);
    const nameOf = (id: string) => (profs.get(id)?.hideName ? null : profs.get(id)?.handle) ?? `trader${id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toLowerCase()}`;
    // holdingAmount carries the dollars staked here, there is no coin to count.
    const messages = (data ?? []).reverse().map((r) => ({ id: r.id as string, name: nameOf(r.privy_user_id as string), text: r.text as string, holdingPct: null, holdingAmount: Number(r.staked_usd) || 0, createdAt: r.created_at as string }));
    return { messages };
  }

  async postEvent(privyUserId: string, eventId: string, raw: string): Promise<ChatMessage> {
    if (!EVENT_RE.test(eventId)) throw new BadRequestException('Invalid event');
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text.length < 1 || text.length > 200) throw new BadRequestException('Messages are 1 to 200 characters');
    if (LINK_RE.test(text)) throw new BadRequestException('Links are not allowed here');
    const now = Date.now();
    if (now - (this.lastPost.get(privyUserId) ?? 0) < MIN_GAP_MS) throw new HttpException('Slow down a little', HttpStatus.TOO_MANY_REQUESTS);
    this.lastPost.set(privyUserId, now);

    const staked = await this.staked(privyUserId, eventId);
    if (staked < MIN_HOLD_USD) throw new HttpException(`Only people with at least $${MIN_HOLD_USD} on this event can post here. Place a bet first.`, HttpStatus.FORBIDDEN);
    await this.profiles.ensureProfile(privyUserId);
    const name = await this.profiles.displayName(privyUserId);
    const { data, error } = await this.supabase.getClient().from('event_takes').insert({ event_id: eventId, privy_user_id: privyUserId, text, staked_usd: staked }).select('id, text, staked_usd, created_at').single();
    if (error || !data) {
      this.logger.warn(`event post failed: ${error?.message}`);
      throw new HttpException('Could not send your message', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { id: data.id, name, text: data.text, holdingPct: null, holdingAmount: Number(data.staked_usd) || 0, createdAt: data.created_at };
  }

  /** A readable handle that never exposes an email or wallet. */
  private async displayName(privyUserId: string): Promise<string> {
    try {
      const u = await this.users.findByPrivyId(privyUserId);
      const n = u?.username || u?.looUsername;
      if (n) return n.replace(/^@/, '').slice(0, 24);
    } catch {
      /* fall through to the anonymous name */
    }
    return `trader${privyUserId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toLowerCase()}`;
  }

  /** How much of the coin the poster's wallet holds right now. null if it cannot be read, never a guess. */
  private async holding(privyUserId: string, mint: string): Promise<{ amount: number; pct: number } | null> {
    try {
      const owner = new PublicKey(await this.users.getSolanaWalletAddress(privyUserId));
      const mintKey = new PublicKey(mint);
      const [accounts, supply] = await Promise.all([
        this.connection().getParsedTokenAccountsByOwner(owner, { mint: mintKey }),
        this.connection().getTokenSupply(mintKey),
      ]);
      const amount = accounts.value.reduce((s, a) => s + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
      const total = supply.value.uiAmount ?? 0;
      return { amount, pct: total > 0 ? Math.min(100, (amount / total) * 100) : 0 };
    } catch (e) {
      this.logger.debug(`holding lookup failed: ${(e as Error).message}`);
      return null;
    }
  }
}

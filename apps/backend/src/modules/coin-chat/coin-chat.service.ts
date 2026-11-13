import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { SupabaseService } from '@/database/supabase.service';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { UsersService } from '../users/users.service';

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PAGE = 50;
/** Links are how chat spam and wallet drainers spread, so none are allowed. */
const LINK_RE = /(https?:\/\/|www\.|t\.me\/|\b[a-z0-9-]+\.(com|io|xyz|fun|app|gg|me|net|org|ly)\b)/i;
const MIN_GAP_MS = 4_000;

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  /** Share of total supply the poster held when they wrote it, 0..100. null if unknown. */
  holdingPct: number | null;
  /** Coin units held when they wrote it. null if unknown. */
  holdingAmount: number | null;
  createdAt: string;
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
      .select('id, display_name, text, holding_pct, holding_amount, created_at')
      .eq('mint', mint)
      .order('created_at', { ascending: false })
      .limit(PAGE);
    if (before && !Number.isNaN(Date.parse(before))) q = q.lt('created_at', before);
    const { data, error } = await q;
    if (error) {
      this.logger.warn(`list failed: ${error.message}`);
      throw new HttpException('Chat is not available right now', HttpStatus.SERVICE_UNAVAILABLE);
    }
    // Oldest first, so the client can append.
    const messages = (data ?? []).reverse().map((r) => ({
      id: r.id as string,
      name: r.display_name as string,
      text: r.text as string,
      holdingPct: r.holding_pct == null ? null : Number(r.holding_pct),
      holdingAmount: r.holding_amount == null ? null : Number(r.holding_amount),
      createdAt: r.created_at as string,
    }));
    return { messages };
  }

  async post(privyUserId: string, mint: string, raw: string): Promise<ChatMessage> {
    if (!MINT_RE.test(mint)) throw new BadRequestException('Invalid coin');
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text.length < 1 || text.length > 200) throw new BadRequestException('Messages are 1 to 200 characters');
    if (LINK_RE.test(text)) throw new BadRequestException('Links are not allowed in chat');
    const now = Date.now();
    if (now - (this.lastPost.get(privyUserId) ?? 0) < MIN_GAP_MS) throw new HttpException('Slow down a little', HttpStatus.TOO_MANY_REQUESTS);
    this.lastPost.set(privyUserId, now);
    if (this.lastPost.size > 5000) this.lastPost.clear();

    const [name, holding] = await Promise.all([this.displayName(privyUserId), this.holding(privyUserId, mint)]);
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
      })
      .select('id, display_name, text, holding_pct, holding_amount, created_at')
      .single();
    if (error || !data) {
      this.logger.warn(`post failed: ${error?.message}`);
      throw new HttpException('Could not send your message', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { id: data.id, name: data.display_name, text: data.text, holdingPct: data.holding_pct == null ? null : Number(data.holding_pct), holdingAmount: data.holding_amount == null ? null : Number(data.holding_amount), createdAt: data.created_at };
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

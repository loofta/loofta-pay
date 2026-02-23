import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { ConfigService } from '@nestjs/config';

const SEARCH_CACHE_TTL_MS = 60 * 1000; // 1 min

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly searchCache = new Map<string, { usernames: string[]; ts: number }>();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get creator display info by Privy user ID (for claim display: username only, no email)
   */
  async findByPrivyId(privyUserId: string): Promise<{ username: string | null } | null> {
    if (!privyUserId || !privyUserId.includes('did:privy:')) {
      return null;
    }
    const { data: user, error } = await this.supabaseService.appUsers
      .select('username')
      .eq('privy_user_id', privyUserId)
      .maybeSingle();

    if (error || !user) {
      return null;
    }
    return { username: user.username ?? null };
  }

  /**
   * Get current user's email by Privy user ID (for recipient-check: compare to PENDING_EMAIL claim)
   */
  async getEmailByPrivyId(privyUserId: string): Promise<string | null> {
    if (!privyUserId || !privyUserId.includes('did:privy:')) {
      return null;
    }
    const { data: user, error } = await this.supabaseService.appUsers
      .select('email')
      .eq('privy_user_id', privyUserId)
      .maybeSingle();
    if (error || !user?.email) return null;
    return (user.email as string).trim().toLowerCase();
  }

  /**
   * Get user by email (for Send flow: resolve email to username)
   * Returns same shape as findByUsername; used to redirect to /link/username
   */
  async findByEmail(email: string): Promise<{
    id: string;
    privyUserId: string;
    email: string | null;
    username: string | null;
    requirePrivatePayments: boolean;
  }> {
    const clean = (email || '').trim().toLowerCase();
    if (!clean) throw new NotFoundException('Email is required');
    const { data: user, error } = await this.supabaseService.appUsers
      .select('id, privy_user_id, email, username, require_private_payments')
      .eq('email', clean)
      .maybeSingle();
    if (error) {
      this.logger.error('Error querying user by email:', error);
      throw new NotFoundException('User not found');
    }
    if (!user?.username) throw new NotFoundException('User not found');
    return {
      id: user.id,
      privyUserId: user.privy_user_id,
      email: user.email,
      username: user.username,
      requirePrivatePayments: user.require_private_payments || false,
    };
  }

  /**
   * Search usernames by prefix (for autocomplete). Cached 1 min; only selects username.
   */
  async searchUsernames(query: string, limit = 10): Promise<{ usernames: string[] }> {
    const clean = (query || '').replace(/^@/, '').trim().toLowerCase();
    if (clean.length < 2) {
      return { usernames: [] };
    }
    const cacheKey = `${clean}:${limit}`;
    const hit = this.searchCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < SEARCH_CACHE_TTL_MS) {
      return { usernames: hit.usernames };
    }
    const { data: users, error } = await this.supabaseService.appUsers
      .select('username')
      .not('username', 'is', null)
      .ilike('username', `${clean}%`)
      .limit(limit);

    if (error) {
      this.logger.error('Error searching usernames:', error);
      return { usernames: [] };
    }
    const usernames = (users || []).map((u: any) => u.username).filter(Boolean);
    this.searchCache.set(cacheKey, { usernames, ts: Date.now() });
    return { usernames };
  }

  /**
   * Get user by username (NO wallet address returned - privacy)
   */
  async findByUsername(username: string): Promise<{
    id: string;
    privyUserId: string;
    email: string | null;
    username: string | null;
    requirePrivatePayments: boolean;
  }> {
    // Remove @ prefix if present
    const cleanUsername = username.replace(/^@/, '').toLowerCase();
    
    this.logger.debug(`Looking up user with username: "${cleanUsername}"`);

    // Use maybeSingle() instead of single() to handle 0 rows gracefully.
    // ilike for case-insensitive exact match (DB may store "Lisa" while we query "lisa").
    const { data: user, error } = await this.supabaseService.appUsers
      .select('id, privy_user_id, email, username, require_private_payments')
      .ilike('username', cleanUsername)
      .maybeSingle();

    if (error) {
      this.logger.error(`Error querying user by username "${cleanUsername}":`, error);
      throw new NotFoundException(`User not found: ${error.message}`);
    }

    if (!user) {
      this.logger.warn(`No user found with username: "${cleanUsername}"`);
      throw new NotFoundException('User not found');
    }

    if (!user.privy_user_id) {
      this.logger.warn(`User found but has no Privy ID: ${user.id}`);
      throw new NotFoundException('User has no Privy ID');
    }

    this.logger.debug(`Found user: ${user.id} (${user.username})`);

    // Return only basic user info - NO wallet address (privacy)
    return {
      id: user.id,
      privyUserId: user.privy_user_id,
      email: user.email,
      username: user.username,
      requirePrivatePayments: user.require_private_payments || false,
    };
  }

  /**
   * Get user's Solana wallet address from Privy (server-side only)
   * This is used when creating claims - wallet address never exposed to frontend
   */
  async getSolanaWalletAddress(privyUserId: string): Promise<string> {
    const privyAppId = this.configService.get<string>('PRIVY_APP_ID');
    const privyAppSecret = this.configService.get<string>('PRIVY_APP_SECRET');

    if (!privyAppId || !privyAppSecret) {
      this.logger.error('Privy credentials not configured');
      throw new Error('Server configuration error');
    }

    try {
      // Get user's wallets from Privy server API
      // Privy requires both Basic auth AND privy-app-id header
      // Base URL should be api.privy.io (not auth.privy.io)
      const privyResponse = await fetch(
        `https://api.privy.io/v1/users/${privyUserId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'privy-app-id': privyAppId,
            Authorization: `Basic ${Buffer.from(`${privyAppId}:${privyAppSecret}`).toString('base64')}`,
          },
        },
      );

      if (!privyResponse.ok) {
        const errorText = await privyResponse.text();
        this.logger.error('Privy API error:', errorText);
        throw new Error('Failed to fetch wallet from Privy');
      }

      const privyUser = await privyResponse.json();
      
      this.logger.debug('Privy user response:', JSON.stringify(privyUser, null, 2));

      // Find Solana embedded wallet in linked accounts
      // Privy API returns snake_case: linked_accounts
      const linkedAccounts = privyUser?.linked_accounts || privyUser?.linkedAccounts || [];
      this.logger.debug(`Found ${linkedAccounts.length} linked accounts`);
      
      const solanaWallet = linkedAccounts.find((account: any) => {
        // Check for Solana embedded wallet type
        if (account.type === 'solana_embedded_wallet' || account.type === 'solana') {
          return true;
        }
        
        const address = account.address;
        if (!address) return false;

        // Check if it's a Solana wallet by address format (base58, 32-44 chars)
        const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);

        // Also check chainType/chainId if available
        const isSolanaChain =
          account.chain_type === 'solana' ||
          account.chainType === 'solana' ||
          account.chain_id === 'solana:mainnet' ||
          account.chainId === 'solana:mainnet' ||
          account.chain_id === 'solana:devnet' ||
          account.chainId === 'solana:devnet' ||
          account.chain_id?.includes('solana') ||
          account.chainId?.includes('solana');

        return isSolanaAddress || isSolanaChain;
      });

      if (!solanaWallet) {
        throw new NotFoundException('User has no Solana embedded wallet');
      }

      return solanaWallet.address;
    } catch (error: any) {
      this.logger.error('Error fetching wallet from Privy:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new Error('Failed to fetch wallet address');
    }
  }

  /**
   * Get Privy user ID for an app user (by internal user id).
   * Used to verify sender ownership via Privy linked accounts when wallet signature fails.
   */
  async getPrivyUserIdByAppUserId(appUserId: string): Promise<string | null> {
    const { data: user, error } = await this.supabaseService.appUsers
      .select('privy_user_id')
      .eq('id', appUserId)
      .maybeSingle();
    if (error || !user?.privy_user_id) return null;
    return user.privy_user_id;
  }

  /**
   * Return true if the given Solana address is one of the Privy user's linked Solana wallets.
   * Used as fallback when wallet message signature verification fails (e.g. Privy embedded wallet).
   */
  async isSolanaAddressInLinkedAccounts(privyUserId: string, solanaAddress: string): Promise<boolean> {
    const user = await this.getPrivyUser(privyUserId);
    if (!user?.linked_accounts?.length) return false;
    const normalized = solanaAddress.trim();
    for (const account of user.linked_accounts) {
      const type = (account.type || '').toLowerCase();
      const chainType = (account.chain_type || '').toLowerCase();
      const chainId = (account.chain_id || '').toString().toLowerCase();
      const isSolana =
        type === 'wallet' ||
        type === 'solana' ||
        type === 'solana_embedded_wallet' ||
        chainType === 'solana' ||
        chainId.startsWith('solana:');
      if (!isSolana) continue;
      const addr = (account.address || '').toString().trim();
      if (addr && addr === normalized) return true;
    }
    return false;
  }

  /**
   * Fetch full Privy user (linked_accounts etc.) for server-side verification
   */
  async getPrivyUser(privyUserId: string): Promise<{ linked_accounts: any[] } | null> {
    const privyAppId = this.configService.get<string>('PRIVY_APP_ID');
    const privyAppSecret = this.configService.get<string>('PRIVY_APP_SECRET');
    if (!privyAppId || !privyAppSecret) return null;

    const res = await fetch(`https://api.privy.io/v1/users/${privyUserId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'privy-app-id': privyAppId,
        Authorization: `Basic ${Buffer.from(`${privyAppId}:${privyAppSecret}`).toString('base64')}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const linkedAccounts = data?.linked_accounts || data?.linkedAccounts || [];
    return { linked_accounts: linkedAccounts };
  }

  /**
   * Verify that the Privy user's linked accounts match the send-payment recipient identifier.
   * Used to authorize claim: only the designated email/twitter can claim.
   */
  async verifyRecipientIdentityForSendPayment(
    privyUserId: string,
    recipientType: 'email' | 'twitter',
    recipientIdentifier: string,
  ): Promise<boolean> {
    const normalized = this.normalizeRecipientIdentifier(recipientType, recipientIdentifier);
    const user = await this.getPrivyUser(privyUserId);
    if (!user) return false;

    for (const account of user.linked_accounts) {
      const type = (account.type || '').toLowerCase();
      if (recipientType === 'email' && (type === 'email' || type === 'google' || type === 'apple')) {
        const email = (account.address || account.email || '').toString().toLowerCase().trim();
        if (email && normalized === email) return true;
      }
      if (recipientType === 'twitter' && (type === 'twitter' || type === 'x')) {
        const handle = (account.username || account.name || account.address || '')
          .toString()
          .replace(/^@/, '')
          .toLowerCase()
          .trim();
        if (handle && normalized === handle) return true;
      }
    }
    return false;
  }

  private normalizeRecipientIdentifier(type: 'email' | 'twitter', value: string): string {
    const v = value.trim();
    if (type === 'email') return v.toLowerCase();
    return v.replace(/^@/, '').toLowerCase();
  }

  /**
   * Debug method to list all usernames (for debugging)
   */
  async listAllUsernames(): Promise<{ usernames: string[] }> {
    const { data: users, error } = await this.supabaseService.appUsers
      .select('username')
      .not('username', 'is', null);

    if (error) {
      this.logger.error('Error listing usernames:', error);
      return { usernames: [] };
    }

    const usernames = (users || []).map((u: any) => u.username).filter(Boolean);
    this.logger.debug(`Found ${usernames.length} usernames`);
    return { usernames };
  }

  /**
   * Get user preferences by Privy user ID
   */
  async getUserPreferences(privyUserId: string): Promise<{
    requirePrivatePayments: boolean;
  } | null> {
    const { data: user, error } = await this.supabaseService.appUsers
      .select('require_private_payments')
      .eq('privy_user_id', privyUserId)
      .maybeSingle();

    if (error || !user) {
      this.logger.error('Error fetching user preferences:', error);
      return null;
    }

    return {
      requirePrivatePayments: user.require_private_payments || false,
    };
  }

  /**
   * Update user privacy preferences
   */
  async updatePrivacyPreferences(
    privyUserId: string,
    requirePrivatePayments: boolean,
  ): Promise<void> {
    const { error } = await this.supabaseService.appUsers
      .update({ require_private_payments: requirePrivatePayments })
      .eq('privy_user_id', privyUserId);

    if (error) {
      this.logger.error('Error updating privacy preferences:', error);
      throw new Error('Failed to update privacy preferences');
    }

    this.logger.log(`Updated privacy preferences for user ${privyUserId}: requirePrivatePayments=${requirePrivatePayments}`);
  }

  /**
   * Get Solana embedded wallet balance in USD and address (same wallet Privy uses to sign).
   */
  async getSolanaWalletBalanceAndAddress(privyUserId: string): Promise<{ balanceUSD: number; walletAddress: string }> {
    const walletAddress = await this.getSolanaWalletAddress(privyUserId);
    const balanceUSD = await this.getSolanaWalletBalanceUSDInternal(walletAddress);
    return { balanceUSD, walletAddress };
  }

  /**
   * Get Solana wallet balance in USD (for checking if wallet can be regenerated)
   */
  async getSolanaWalletBalanceUSD(privyUserId: string): Promise<number> {
    const walletAddress = await this.getSolanaWalletAddress(privyUserId);
    return this.getSolanaWalletBalanceUSDInternal(walletAddress);
  }

  private async getSolanaWalletBalanceUSDInternal(walletAddress: string): Promise<number> {
    const solanaRpcUrl = process.env.SOLANA_RPC_URL ||
      (process.env.HELIUS_API_KEY
        ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
        : 'https://api.mainnet-beta.solana.com');

    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    try {
      const response = await fetch(solanaRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [
            walletAddress,
            { mint: USDC_MINT },
            { encoding: 'jsonParsed' },
          ],
        }),
      });

      const data = await response.json();

      if (data.error || !data.result?.value || data.result.value.length === 0) {
        return 0;
      }

      const account = data.result.value[0];
      const balance = account.account.data.parsed.info.tokenAmount.uiAmount;

      return balance || 0;
    } catch (error) {
      this.logger.error('Error fetching Solana balance:', error);
      return 0;
    }
  }
}

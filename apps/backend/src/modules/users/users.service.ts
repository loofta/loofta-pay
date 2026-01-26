import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get user by username (NO wallet address returned - privacy)
   */
  async findByUsername(username: string): Promise<{
    id: string;
    privyUserId: string;
    email: string | null;
    username: string | null;
  }> {
    // Remove @ prefix if present
    const cleanUsername = username.replace(/^@/, '').toLowerCase();
    
    this.logger.debug(`Looking up user with username: "${cleanUsername}"`);

    // Use maybeSingle() instead of single() to handle 0 rows gracefully
    const { data: user, error } = await this.supabaseService.appUsers
      .select('id, privy_user_id, email, username')
      .eq('username', cleanUsername)
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
}

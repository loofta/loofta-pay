import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { generatePrivateKey } from 'viem/accounts';
import { SupabaseService } from '@/database/supabase.service';
import { SendPaymentEncryptionService } from '@/modules/send-payment/encryption.service';
import { RhinestoneService } from '@/modules/lottery/rhinestone.service';
import { AmpleEvmService } from './ample-evm.service';

export interface Companion {
  address: `0x${string}`;
  key: `0x${string}`;
}

/**
 * One backend-held Rhinestone smart account per person on Base, the same pattern as the Megapot companion. It is the wallet
 * Ample knows (linked once, signed by the account itself), it holds the USDC while it is saved, and Rhinestone pays all gas.
 * The person never signs anything on Base, and we can always recover or sweep what is left in it.
 */
@Injectable()
export class AmpleCompanionService {
  private readonly logger = new Logger(AmpleCompanionService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly enc: SendPaymentEncryptionService,
    private readonly rhinestone: RhinestoneService,
    private readonly evm: AmpleEvmService,
  ) {}

  private async load(userId: string): Promise<Companion | null> {
    const { data } = await this.supabase.getClient().from('ample_companions').select('address, key_enc').eq('user_id', userId).maybeSingle();
    if (!data) return null;
    const key = ('0x' + this.enc.decrypt(data.key_enc, data.address).toString('hex')) as `0x${string}`;
    return { address: data.address as `0x${string}`, key };
  }

  /** The person's companion, created on first use. Creating one needs no transaction: the address is computed from the key. */
  async get(userId: string): Promise<Companion> {
    const existing = await this.load(userId);
    if (existing) return existing;
    const key = generatePrivateKey();
    const address = (await this.rhinestone.getCompanionAddress(key)) as `0x${string}`;
    const keyEnc = this.enc.encrypt(Buffer.from(key.slice(2), 'hex'), address);
    const { error } = await this.supabase.getClient().from('ample_companions').insert({ user_id: userId, address, key_enc: keyEnc });
    if (error) {
      // A second request created it first. That one is the real one, the key made here never held anything.
      const raced = await this.load(userId);
      if (raced) return raced;
      this.logger.error(`ample_companions insert failed: ${error.message}`);
      throw new BadRequestException('Could not set up your account. Try again.');
    }
    return { address, key };
  }

  /** Deployed and linked to Ample. Safe to call before every action. */
  async ready(userId: string): Promise<Companion> {
    const c = await this.get(userId);
    await this.rhinestone.ensureDeployed(c.key);
    const link = await this.evm.getLink(userId);
    if (!link.linked || link.walletAddress?.toLowerCase() !== c.address.toLowerCase()) {
      if (link.linked) {
        // Linking a new wallet hides the old one's position from Ample. Never do that if money is still there.
        const o: any = await this.evm.overview(userId).catch(() => null);
        const held = (o?.balances ?? []).some((b: any) => Number(b?.depositsUsd) > 0);
        if (held) throw new BadRequestException('Your account is linked to a different wallet that still holds savings. Contact support.');
      }
      const ch: any = await this.evm.challenge(userId, c.address);
      const signature = await this.rhinestone.signMessage(c.key, ch.message);
      await this.evm.link(userId, c.address, ch.message, signature);
    }
    await this.supabase.getClient().from('ample_companions').update({ deployed: true }).eq('user_id', userId);
    return c;
  }
}

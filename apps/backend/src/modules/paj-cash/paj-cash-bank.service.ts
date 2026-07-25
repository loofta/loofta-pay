import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { PajCashService, type PajBank, type PajResolvedBankAccount } from './paj-cash.service';
import { PajCashSessionService } from './paj-cash-session.service';
import type { PajCashBankAccountRow } from './entities/paj-bank-account.entity';

@Injectable()
export class PajCashBankService {
  private readonly logger = new Logger(PajCashBankService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly pajCash: PajCashService,
    private readonly session: PajCashSessionService,
  ) {}

  private table() {
    return this.supabase.getClient().from('paj_cash_bank_accounts');
  }

  async listBanks(userId: string): Promise<PajBank[]> {
    const token = await this.session.getValidSessionToken(userId);
    return this.pajCash.getBanks(token);
  }

  async confirmAccount(userId: string, bankId: string, accountNumber: string): Promise<PajResolvedBankAccount> {
    const token = await this.session.getValidSessionToken(userId);
    return this.pajCash.confirmBankAccount(token, bankId, accountNumber);
  }

  async saveAccount(userId: string, bankId: string, bankName: string, accountNumber: string): Promise<PajCashBankAccountRow> {
    const token = await this.session.getValidSessionToken(userId);
    const saved = await this.pajCash.saveBankAccount(token, bankId, accountNumber);

    const { data, error } = await this.table()
      .insert({
        user_id: userId,
        paj_bank_account_id: saved.id,
        bank_id: bankId,
        bank_name: bankName,
        account_number: saved.accountNumber,
        account_name: saved.accountName,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`Failed to mirror saved bank account for ${userId}: ${error?.message}`);
      throw new Error('Failed to save bank account');
    }
    return data as PajCashBankAccountRow;
  }

  async listSavedAccounts(userId: string): Promise<PajCashBankAccountRow[]> {
    const { data } = await this.table().select('*').eq('user_id', userId).order('created_at', { ascending: false });
    return (data as PajCashBankAccountRow[] | null) ?? [];
  }

  async getSavedAccount(userId: string, id: string): Promise<PajCashBankAccountRow | null> {
    const { data } = await this.table().select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    return (data as PajCashBankAccountRow | null) ?? null;
  }
}

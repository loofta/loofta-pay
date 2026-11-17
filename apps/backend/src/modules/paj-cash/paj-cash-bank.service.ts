import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { PajCashService, type PajResolvedBankAccount } from './paj-cash.service';
import { PajCashSessionService } from './paj-cash-session.service';
import { PAJ_STATIC_BANKS } from './paj-banks-static';
import type { PajCashBankAccountRow } from './entities/paj-bank-account.entity';

@Injectable()
export class PajCashBankService {
  private readonly logger = new Logger(PajCashBankService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly pajCash: PajCashService,
    private readonly session: PajCashSessionService,
  ) {}

  /** v2 identifies banks by code; our rows/frontend still carry PAJ's bank id. */
  bankFor(bankId: string) {
    const bank = PAJ_STATIC_BANKS.find((b) => b.id === bankId || b.code === bankId);
    if (!bank) throw new NotFoundException(`Unknown bank ${bankId}`);
    return bank;
  }

  private table() {
    return this.supabase.getClient().from('paj_cash_bank_accounts');
  }

  async confirmAccount(userId: string, bankId: string, accountNumber: string): Promise<PajResolvedBankAccount> {
    const bank = this.bankFor(bankId);
    const r = await this.pajCash.registerBankAccount(bank.code, accountNumber);
    return { accountName: r.accountName, accountNumber: r.accountNumber, bank: { id: bank.id, name: bank.name, code: bank.code, country: bank.country } };
  }

  async saveAccount(userId: string, bankId: string, bankName: string, accountNumber: string): Promise<PajCashBankAccountRow> {
    const saved = await this.pajCash.registerBankAccount(this.bankFor(bankId).code, accountNumber);

    // First bank account a user ever saves becomes their default automatically — zero extra
    // taps for the common single-account case. Later ones stay non-default until the user
    // explicitly picks one via setDefaultAccount.
    const { count } = await this.table().select('id', { count: 'exact', head: true }).eq('user_id', userId);
    const isFirstAccount = !count;

    const { data, error } = await this.table()
      .insert({
        user_id: userId,
        paj_bank_account_id: saved.id,
        bank_id: bankId,
        bank_name: bankName,
        account_number: saved.accountNumber,
        account_name: saved.accountName,
        wallet_address: saved.address ?? null,
        is_default: isFirstAccount,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`Failed to mirror saved bank account for ${userId}: ${error?.message}`);
      throw new Error('Failed to save bank account');
    }
    const row = data as PajCashBankAccountRow;
    this.logger.log(
      `PAJ Cash: saved bank account ${row.id} for ${userId} (${bankName} ····${row.account_number.slice(-4)}) — ` +
      `abstracted payout wallet_address=${row.wallet_address ?? 'none returned by PAJ'} default=${row.is_default}`,
    );
    return row;
  }

  async listSavedAccounts(userId: string): Promise<PajCashBankAccountRow[]> {
    const { data } = await this.table().select('*').eq('user_id', userId).order('created_at', { ascending: false });
    return (data as PajCashBankAccountRow[] | null) ?? [];
  }

  async getSavedAccount(userId: string, id: string): Promise<PajCashBankAccountRow | null> {
    const { data } = await this.table().select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    return (data as PajCashBankAccountRow | null) ?? null;
  }

  /** Unscoped lookup by id — used internally (e.g. claims.service.ts findOne) to embed which
   * bank account a claim was routed to, where the caller already owns the access-control check
   * on the claim itself and isn't operating as the bank account's own user. */
  async getAccountById(id: string): Promise<PajCashBankAccountRow | null> {
    const { data } = await this.table().select('*').eq('id', id).maybeSingle();
    return (data as PajCashBankAccountRow | null) ?? null;
  }

  async getDefaultAccount(userId: string): Promise<PajCashBankAccountRow | null> {
    const { data } = await this.table().select('*').eq('user_id', userId).eq('is_default', true).maybeSingle();
    return (data as PajCashBankAccountRow | null) ?? null;
  }

  /** Used by cronSweepPendingBurners to resolve which bank account a retried "claim in Naira"
   * sweep belongs to (for the payments.naira_claim_bank_account_id receipt), since the cron only
   * has the resolved destination wallet_address to go on, not the original request's context. */
  async getAccountByWalletAddress(walletAddress: string): Promise<PajCashBankAccountRow | null> {
    const { data } = await this.table().select('*').eq('wallet_address', walletAddress).maybeSingle();
    return (data as PajCashBankAccountRow | null) ?? null;
  }

  /** Unsets any current default before setting the new one — required given the partial
   * unique index (paj_cash_bank_accounts_one_default_per_user) that enforces a single
   * default per user at the DB level. Also heals `wallet_address` for accounts saved before
   * PAJ's abstracted-address feature existed (or before this backend started capturing it) —
   * those rows have `wallet_address: null` and would silently fail every "claim in Naira"
   * attempt with a confusing "no default account" error, since claimAsRecipient requires a
   * wallet_address on the resolved default account. Re-registering the same bank+account
   * number with PAJ is the only way to backfill it, so do that here, at the one point an old
   * account is about to become load-bearing. */
  async setDefaultAccount(userId: string, accountId: string): Promise<PajCashBankAccountRow> {
    const account = await this.getSavedAccount(userId, accountId);
    if (!account) throw new NotFoundException('Bank account not found');

    if (!account.wallet_address) {
      const refreshed = await this.pajCash.registerBankAccount(this.bankFor(account.bank_id).code, account.account_number);
      if (refreshed.address) {
        const { error: healError } = await this.table().update({ wallet_address: refreshed.address }).eq('id', accountId);
        if (healError) {
          this.logger.error(`Failed to backfill wallet_address for account ${accountId}: ${healError.message}`);
        } else {
          this.logger.log(`PAJ Cash: backfilled wallet_address=${refreshed.address} for previously-stale account ${accountId}`);
          account.wallet_address = refreshed.address;
        }
      } else {
        this.logger.warn(`PAJ Cash: re-registering bank account ${accountId} with PAJ still did not return an abstracted address`);
      }
    }

    const { error: unsetError } = await this.table().update({ is_default: false }).eq('user_id', userId).eq('is_default', true);
    if (unsetError) {
      this.logger.error(`Failed to unset previous default bank account for ${userId}: ${unsetError.message}`);
      throw new Error('Failed to set default bank account');
    }

    const { data, error } = await this.table().update({ is_default: true }).eq('id', accountId).eq('user_id', userId).select('*').single();
    if (error || !data) {
      this.logger.error(`Failed to set default bank account for ${userId}: ${error?.message}`);
      throw new Error('Failed to set default bank account');
    }
    return data as PajCashBankAccountRow;
  }
}

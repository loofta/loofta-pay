/**
 * Adapter: use send_payment_links as the "activity" store for the claim flow.
 * Same interface as privacy-hack lib/database so we can use their prepareClaim/submitClaim.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import type { PassphraseEncryptedPayload } from './vault-crypto';

export type ActivityStatus = 'open' | 'settled' | 'cancelled';

export interface Activity {
  id: string;
  type: 'send_claim';
  sender_address: string;
  receiver_address: string | null;
  amount: number;
  token_address: string | null;
  status: ActivityStatus;
  message: string | null;
  tx_hash: string | null;
  burner_address?: string | null;
  encrypted_for_receiver?: PassphraseEncryptedPayload | null;
  encrypted_for_sender?: PassphraseEncryptedPayload | null;
}

/** Create/update private claim state on existing send_payment_links row (linkId = activity id). */
export async function createActivityForLink(
  supabase: SupabaseClient,
  linkId: string,
  data: Omit<Activity, 'id' | 'created_at' | 'updated_at'>,
): Promise<Activity> {
  const { error } = await supabase
    .from('send_payment_links')
    .update({
      private_claim_sender_address: data.sender_address,
      private_claim_burner_address: data.burner_address ?? null,
      private_claim_encrypted_receiver: data.encrypted_for_receiver
        ? JSON.stringify(data.encrypted_for_receiver)
        : null,
      private_claim_encrypted_sender: data.encrypted_for_sender
        ? JSON.stringify(data.encrypted_for_sender)
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', linkId);
  if (error) throw new Error(`Failed to save private claim state: ${error.message}`);
  return { ...data, id: linkId } as Activity;
}

/** Re-fetch link amount from DB for verification before relay/withdraw. */
export async function getLinkAmountForVerification(supabase: SupabaseClient, linkId: string): Promise<number> {
  const { data, error } = await supabase
    .from('send_payment_links')
    .select('amount')
    .eq('id', linkId)
    .single();
  if (error || !data) throw new Error(`Failed to get link amount: ${error?.message ?? 'not found'}`);
  const amount = parseFloat(String((data as Record<string, unknown>).amount ?? 0));
  if (Number.isNaN(amount)) throw new Error(`Link ${linkId} has invalid amount`);
  return amount;
}

export async function getActivityForLink(supabase: SupabaseClient, id: string): Promise<Activity | null> {
  const { data, error } = await supabase.from('send_payment_links').select('*').eq('id', id).single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get activity: ${error.message}`);
  }
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const encRev = row.private_claim_encrypted_receiver;
  const encSen = row.private_claim_encrypted_sender;
  return {
    id: row.id as string,
    type: 'send_claim',
    sender_address: (row.private_claim_sender_address as string) ?? '',
    receiver_address: null,
    amount: parseFloat(String(row.amount ?? 0)),
    token_address: row.token === 'USDC' ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' : null,
    status: mapStatus(row.status as string),
    message: (row.message as string) ?? null,
    tx_hash: (row.deposit_tx_hash as string) ?? null,
    burner_address: (row.private_claim_burner_address as string) ?? null,
    encrypted_for_receiver: encRev ? (typeof encRev === 'string' ? JSON.parse(encRev) : encRev) : null,
    encrypted_for_sender: encSen ? (typeof encSen === 'string' ? JSON.parse(encSen) : encSen) : null,
  };
}

function mapStatus(s: string): ActivityStatus {
  if (s === 'OPEN' || s === 'FUNDED') return 'open';
  if (s === 'CLAIMED') return 'settled';
  return 'cancelled';
}

export async function updateActivityStatusForLink(
  supabase: SupabaseClient,
  id: string,
  _status: ActivityStatus,
  updates?: Partial<Pick<Activity, 'tx_hash'>>,
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates?.tx_hash) payload.deposit_tx_hash = updates.tx_hash;
  const { error } = await supabase.from('send_payment_links').update(payload).eq('id', id);
  if (error) throw new Error(`Failed to update activity: ${error.message}`);
}

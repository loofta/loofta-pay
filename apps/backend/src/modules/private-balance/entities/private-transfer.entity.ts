export type PrivateTransferDirection = 'deposit' | 'withdrawal';

export type PrivateTransferStatus =
  | 'awaiting_funds'        // deposit: burner created, waiting for user to fund it
  | 'delivering_privately'  // deposit: funds seen in burner, private transfer to user in flight
  | 'awaiting_signature'    // withdrawal: leg-1 unsigned tx returned, waiting for client to sign+broadcast
  | 'delivering_to_burner'  // withdrawal: leg-1 signature recorded, confirming + sweeping burner -> destination
  | 'bridging'              // either direction: Near Intents cross-chain leg in flight
  | 'complete'
  | 'failed';

export interface PrivateTransfer {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  direction: PrivateTransferDirection;
  status: PrivateTransferStatus;
  burner_address: string;
  burner_encrypted_secret: string;
  source_or_dest_token: { symbol: string; chain: string } | null;
  amount_requested_usdc: string | number;
  cluster: 'mainnet' | 'devnet';
  near_deposit_address: string | null;
  near_memo: string | null;
  leg1_tx_signature: string | null;
  leg2_tx_signature: string | null;
  destination_address: string | null;
  error_message: string | null;
  /** Deposit only: when the burner -> MagicBlock hop1 transaction confirmed on-chain. Used to
   *  time out the delivery-verification wait (see tryDeliverBurnerBalance/verifyQueuedDelivery). */
  delivery_hop1_confirmed_at: string | null;
  /** Deposit only: USDC MagicBlock's own program logs say it will deliver to the destination
   *  (parsed from the hop1 transaction's logs — the source of truth, not our own fee estimate). */
  delivery_expected_usdc: string | number | null;
  /** Deposit only: destination wallet's USDC balance immediately before hop1 broadcast. The row
   *  is only marked 'complete' once the destination's balance has risen by delivery_expected_usdc
   *  above this baseline. */
  delivery_baseline_usdc: string | number | null;
}

/** Fields safe to return to the client — never the encrypted burner secret. */
export interface PrivateTransferStatusResponse {
  id: string;
  direction: PrivateTransferDirection;
  status: PrivateTransferStatus;
  amountRequestedUsdc: number;
  depositAddress?: string;
  depositMemo?: string | null;
  destinationAddress?: string | null;
  leg1TxSignature?: string | null;
  leg2TxSignature?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

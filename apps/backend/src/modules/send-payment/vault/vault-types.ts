export interface PreparePrivateResult {
  unsignedDepositTx: string;
  lastValidBlockHeight: number;
  activityId: string;
  passphrase: string;
  burnerAddress: string;
}

export interface PrivateClaimLinkState {
  private_claim_burner_address: string;
  private_claim_encrypted_receiver: string;
  private_claim_encrypted_sender: string;
}

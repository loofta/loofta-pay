/**
 * Private payments via Umbra SDK (Solana confidential transfers).
 */

import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  UmbraClient,
  type ISigner,
  type SolanaAddress,
  type MintAddress,
  type SolanaSignature,
  type U128,
} from "umbra-sdk";
import { USDC_MINT } from "@/services/solanaBalance";

export const PRIVATE_PAYMENT_FEES = {
  withdraw_fee_rate: 0.0035,
  withdraw_rent_fee: 0.006,
  deposit_fee_rate: 0,
  minimum_withdrawal: { usdc: 2 },
  usdc_withdraw_rent_fee: 0.744548676,
};

export const PRIVATE_PAYMENT_COMING_SOON = false;

/** Phantom (or similar) adapter implementing Umbra ISigner. */
class PhantomSigner implements ISigner {
  constructor(
    private getPublicKeyFn: () => Promise<PublicKey>,
    private signMessageFn: (message: Uint8Array) => Promise<Uint8Array>,
    private signTransactionFn: (
      tx: VersionedTransaction
    ) => Promise<VersionedTransaction>,
    private signTransactionsFn?: (
      txs: VersionedTransaction[]
    ) => Promise<VersionedTransaction[]>
  ) {}

  async getPublicKey(): Promise<SolanaAddress> {
    return (await this.getPublicKeyFn()) as SolanaAddress;
  }

  async signMessage(message: Uint8Array): Promise<SolanaSignature> {
    const sig = await this.signMessageFn(message);
    return sig as SolanaSignature;
  }

  async signTransaction(
    transaction: VersionedTransaction
  ): Promise<VersionedTransaction> {
    return this.signTransactionFn(transaction);
  }

  async signTransactions(
    transactions: VersionedTransaction[]
  ): Promise<VersionedTransaction[]> {
    if (this.signTransactionsFn) return this.signTransactionsFn(transactions);
    return Promise.all(transactions.map((tx) => this.signTransactionFn(tx)));
  }
}

export async function payPrivately(options: {
  walletAddress: string;
  amountUSD: number;
  recipientAddress: string;
  signMessage: (message: string) => Promise<Uint8Array>;
  signTransaction: (
    tx: VersionedTransaction
  ) => Promise<VersionedTransaction>;
  recipientPaysFees?: boolean;
  solanaRpcUrl?: string;
}): Promise<{ success: boolean; signature?: string; error?: string }> {
  const {
    amountUSD,
    recipientAddress,
    signMessage: signMessageFn,
    signTransaction: signTransactionFn,
    solanaRpcUrl,
  } = options;

  const rpcUrl =
    solanaRpcUrl ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    (process.env.NEXT_PUBLIC_HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
      : "https://api.mainnet-beta.solana.com");

  try {
    const connection = new Connection(rpcUrl);
    const client = UmbraClient.create(connection);

    const getPk = () => Promise.resolve(new PublicKey(options.walletAddress));
    const signMsg = async (msg: Uint8Array) => {
      const sig = await signMessageFn(new TextDecoder().decode(msg));
      return sig;
    };
    const signer = new PhantomSigner(getPk, signMsg, signTransactionFn);

    await client.setUmbraWallet(signer);

    const amountRaw = BigInt(Math.round(amountUSD * 1_000_000)) as U128;
    const recipient = new PublicKey(recipientAddress) as SolanaAddress;
    const usdcMint = new PublicKey(USDC_MINT) as MintAddress;

    const result = await client.transferConfidentially(
      amountRaw,
      recipient,
      usdcMint,
      { mode: "relayer" }
    );

    const signature = typeof result === "string" ? result : undefined;
    return { success: true, signature };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

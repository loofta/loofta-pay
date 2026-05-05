import type { Wallet } from "@coral-xyz/anchor";
import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getPrivySolanaChain } from "@/lib/solanaCluster";

type PhantomLike = {
  publicKey: { toBase58(): string };
  signTransaction: (tx: Transaction) => Promise<Transaction>;
};

/** Phantom (or compatible) injected wallet for Anchor `Wallet`. */
export function phantomWalletToAnchorWallet(phantom: PhantomLike): Wallet {
  const publicKey = new PublicKey(phantom.publicKey.toBase58());
  const signTransaction = async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
    // Modern Phantom supports VersionedTransaction under the hood despite the legacy type signature
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (phantom as any).signTransaction(tx)) as T;
  };
  return {
    publicKey,
    signTransaction,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => {
      const out: T[] = [];
      for (const t of txs) {
        out.push(await signTransaction(t));
      }
      return out;
    },
  } as Wallet;
}

/** Privy `ConnectedStandardWallet` — sign legacy or versioned `Transaction` for Anchor. */
export type PrivySolWallet = {
  address: string;
  signTransaction: (opts: { transaction: Uint8Array }) => Promise<{ signedTransaction: Uint8Array }>;
};

export function privyWalletToAnchorWallet(wallet: PrivySolWallet): Wallet {
  const publicKey = new PublicKey(wallet.address);
  const signTransaction = async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
    if (tx instanceof VersionedTransaction) {
      // serialize() with no args works for versioned; Privy signs raw bytes regardless of tx version
      const serialized = tx.serialize();
      const { signedTransaction } = await wallet.signTransaction({ transaction: serialized });
      return VersionedTransaction.deserialize(signedTransaction) as T;
    }
    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const { signedTransaction } = await wallet.signTransaction({ transaction: serialized });
    return Transaction.from(signedTransaction) as T;
  };
  return {
    publicKey,
    signTransaction,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => {
      const out: T[] = [];
      for (const t of txs) {
        out.push(await signTransaction(t));
      }
      return out;
    },
  } as Wallet;
}

type PrivySolanaChain = ReturnType<typeof getPrivySolanaChain>;

/**
 * Privy embedded wallet from `useWallets()` + `useSignTransaction()` — implements Anchor `Wallet`
 * for PER / MagicBlock flows.
 *
 * Always pass `chain` explicitly from networkMode (`getPrivySolanaChainForMode(networkMode)`).
 * Defaulting to `getPrivySolanaChain()` uses the build-time cluster, which causes Privy to
 * simulate v0 transactions on the wrong network (e.g. mainnet ALTs not found on devnet RPC).
 */
export function privyStandardWalletToAnchorWallet(
  wallet: ConnectedStandardSolanaWallet,
  signTransaction: (input: {
    transaction: Uint8Array;
    wallet: ConnectedStandardSolanaWallet;
    chain?: PrivySolanaChain;
  }) => Promise<{ signedTransaction: Uint8Array }>,
  chain?: PrivySolanaChain,
): Wallet {
  const publicKey = new PublicKey(wallet.address);
  const resolvedChain = chain ?? getPrivySolanaChain();
  const signOne = async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
    if (tx instanceof VersionedTransaction) {
      // serialize() with no args works for versioned; Privy signs raw bytes regardless of tx version
      const serialized = tx.serialize();
      const { signedTransaction } = await signTransaction({ transaction: serialized, wallet, chain: resolvedChain });
      return VersionedTransaction.deserialize(signedTransaction) as T;
    }
    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const { signedTransaction } = await signTransaction({
      transaction: serialized,
      wallet,
      chain: resolvedChain,
    });
    return Transaction.from(signedTransaction) as T;
  };
  return {
    publicKey,
    signTransaction: signOne,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => {
      const out: T[] = [];
      for (const t of txs) {
        out.push(await signOne(t));
      }
      return out;
    },
  } as Wallet;
}

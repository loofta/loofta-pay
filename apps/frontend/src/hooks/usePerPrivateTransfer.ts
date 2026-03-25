"use client";

import { useCallback, useMemo } from "react";
import type { Wallet } from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Connection,
  SendTransactionError,
  SystemProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  DELEGATION_PROGRAM_ID,
  GetCommitmentSignature,
  PERMISSION_PROGRAM_ID,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import LooftaPerIdl from "@/per/idl/loofta_per_payments.json";
import {
  LOOFTA_PER_PROGRAM_ID,
  LOOFTA_PER_WALLET_MEMO,
  VALIDATOR_PUBKEY,
  DEPOSIT_PDA_SEED,
  VAULT_PDA_SEED,
} from "@/lib/per/constants";
import { getSolanaCluster, getSolanaHttpRpc } from "@/lib/solanaCluster";
import { usePerAuth } from "@/hooks/usePerAuth";
import { logPerError } from "@/lib/per/log";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import {
  fetchSolanaFeePayerAddress,
  prepareSponsoredTransaction,
  signAndBroadcastSponsoredTx,
} from "@/services/solanaSponsor";

interface DepositAccount {
  user: PublicKey;
  token_mint: PublicKey;
  amount: BN;
}

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function prependWalletMemo(tx: Transaction, memo: string): void {
  tx.instructions.unshift(
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, "utf8"),
    }),
  );
}

/** Solana packet limit for legacy `Transaction` (minus encoding overhead, ~1232). */
const MAX_LEGACY_TX_SERIALIZED_BYTES = 1232;

function mergeInstructionsFromTxs(...sources: (Transaction | undefined)[]): Transaction {
  const out = new Transaction();
  for (const src of sources) {
    if (!src) continue;
    for (const ix of src.instructions) {
      out.add(ix);
    }
  }
  return out;
}

/** Copy instructions + metadata so we can measure serialize size before signing. */
function copyTxWithBlockhashAndFeePayer(tx: Transaction, blockhash: string, feePayer: PublicKey): Transaction {
  const t = new Transaction();
  for (const ix of tx.instructions) {
    t.add(ix);
  }
  t.recentBlockhash = blockhash;
  t.feePayer = feePayer;
  return t;
}

function legacyTxSerializedLength(tx: Transaction): number {
  try {
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function initializeDeposit({
  program,
  user,
  tokenMint,
  depositPda,
  transaction,
  payer,
}: {
  program: Program;
  user: PublicKey;
  tokenMint: PublicKey;
  depositPda: PublicKey;
  transaction: Transaction;
  /** When set (e.g. Loofta backend sponsor), pays rent; must sign on-chain (backend co-signs). */
  payer?: PublicKey;
}) {
  const pay = payer ?? program.provider.publicKey;
  let initIx = await program.methods
    .initializeDeposit()
    .accountsPartial({
      payer: pay,
      user,
      deposit: depositPda,
      tokenMint: tokenMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const permission = permissionPdaFromAccount(depositPda);

  let createPermissionIx = await program.methods
    .createPermission()
    .accountsPartial({
      payer: pay,
      user,
      deposit: depositPda,
      permission,
      permissionProgram: PERMISSION_PROGRAM_ID,
    })
    .preInstructions([initIx])
    .instruction();

  transaction.add(initIx);
  transaction.add(createPermissionIx);

  return transaction;
}

type PerSendAction = {
  name: string;
  tx: Transaction;
  signedTx: Transaction;
  blockhash: string;
  connection: Connection;
  needsSessionKpAfterWallet: boolean;
  callback?: (signature?: string) => Promise<void>;
};

/** UI progress for Privy, Phantom, or any wallet using `signAllTransactions`. */
export type PerTransferProgress =
  | { phase: "preparing" }
  | { phase: "awaiting_signature"; walletTransactionCount: number }
  | { phase: "broadcasting"; step: string; index: number; total: number };

export function usePerPrivateTransfer() {
  const connection = useMemo(() => new Connection(getSolanaHttpRpc(), "confirmed"), []);
  const { ensureAuthToken } = usePerAuth();

  const programForWallet = useCallback(
    (wallet: Wallet) => {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      return new Program(LooftaPerIdl as never, provider);
    },
    [connection],
  );

  const getDepositPda = useCallback((user: PublicKey, tokenMint: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(DEPOSIT_PDA_SEED), user.toBuffer(), tokenMint.toBuffer()],
      LOOFTA_PER_PROGRAM_ID,
    )[0];
  }, []);

  const getVaultPda = useCallback((tokenMint: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(VAULT_PDA_SEED), tokenMint.toBuffer()],
      LOOFTA_PER_PROGRAM_ID,
    )[0];
  }, []);

  const transfer = useCallback(
    async (
      wallet: Wallet,
      recipient: string,
      tokenMint: string,
      amount: number,
      options?: { privyUserId?: string | null; onProgress?: (p: PerTransferProgress) => void },
    ) => {
      const onProgress = options?.onProgress;
      if (!connection) throw new Error("Connection not ready.");
      onProgress?.({ phase: "preparing" });

      const cluster = getSolanaCluster();
      const minLamports = cluster === "mainnet-beta" ? 5_000_000 : 12_000_000;
      let sponsorPk: PublicKey | null = null;
      if (options?.privyUserId) {
        const addr = await fetchSolanaFeePayerAddress(options.privyUserId);
        if (addr) {
          try {
            sponsorPk = new PublicKey(addr);
          } catch {
            sponsorPk = null;
          }
        }
      }
      /** Backend pays fees + Gum session rent when sponsor key is configured. */
      const useSponsorRelayer = sponsorPk !== null && !!options?.privyUserId;
      if (!useSponsorRelayer) {
        const solBalance = await connection.getBalance(wallet.publicKey);
        if (solBalance < minLamports) {
          throw new Error(
            `Not enough SOL for fees (session, deposit, delegation). Have ${(solBalance / 1e9).toFixed(
              4,
            )} SOL; need at least ~${(minLamports / 1e9).toFixed(3)} SOL on ${cluster}.`,
          );
        }
      }

      const program = programForWallet(wallet);
      let token: string;
      let ephemeralBaseUrl: string;
      try {
        const auth = await ensureAuthToken(wallet.publicKey);
        token = auth.token;
        ephemeralBaseUrl = auth.baseUrl;
      } catch (e) {
        logPerError(e, { step: "ensureAuthToken", userPubkey: wallet.publicKey.toBase58() });
        throw e;
      }
      const ephemeralConnection = new Connection(`${ephemeralBaseUrl.replace(/\/$/, "")}?token=${token}`, "confirmed");
      const ephemeralProgram = new Program(
        LooftaPerIdl as never,
        new AnchorProvider(ephemeralConnection, wallet, { commitment: "confirmed" }),
      );

      let tokenAmount = new BN(Math.pow(10, 6) * amount);
      const recipientPk = new PublicKey(recipient);
      const tokenMintPk = new PublicKey(tokenMint);

      let preliminaryTx: Transaction | undefined;
      /** Base-cluster (devnet or mainnet-beta) txs: deposit, delegate, init — not the ER chain. */
      let mainnetTx: Transaction | undefined;

      const vaultPda = getVaultPda(tokenMintPk)!;

      const senderDepositPda = getDepositPda(wallet.publicKey, tokenMintPk)!;
      const senderDepositAccount = await connection.getAccountInfo(senderDepositPda);
      const ephemeralSenderDepositAccount =
        await ephemeralConnection.getAccountInfo(senderDepositPda);

      const senderIsDelegated = senderDepositAccount?.owner.equals(
        new PublicKey(DELEGATION_PROGRAM_ID),
      );

      // Compute the amount of tokens to deposit
      let amountToDeposit = tokenAmount;
      let mainnetSenderDepositAmount = senderDepositAccount
        ? (
          (await program.coder.accounts.decode(
            'deposit',
            senderDepositAccount.data,
          )) as DepositAccount
        ).amount
        : new BN(0);
      let ephemeralSenderDepositAmount = ephemeralSenderDepositAccount
        ? (
          (await program.coder.accounts.decode(
            'deposit',
            ephemeralSenderDepositAccount.data,
          )) as DepositAccount
        ).amount
        : new BN(0);

      if (senderIsDelegated) {
        amountToDeposit = amountToDeposit.sub(ephemeralSenderDepositAmount);
      } else {
        amountToDeposit = amountToDeposit.sub(mainnetSenderDepositAmount);
      }

      // Create a session for the ER
      const sessionKp = Keypair.generate();
      const sessionManager = new SessionTokenManager(wallet, connection);
      const sessionToken = PublicKey.findProgramAddressSync(
        [
          Buffer.from('session_token'),
          LOOFTA_PER_PROGRAM_ID.toBuffer(),
          sessionKp.publicKey.toBuffer(),
          wallet.publicKey.toBuffer(),
        ],
        sessionManager.program.programId,
      )[0];
      const gumMethods = sessionManager.program.methods as {
        createSession: (
          a: boolean,
          b: null,
          c: null,
        ) => { accountsPartial: (x: Record<string, PublicKey>) => { transaction: () => Promise<Transaction> } };
        createSessionWithPayer: (
          a: boolean,
          b: null,
          c: null,
        ) => { accountsPartial: (x: Record<string, PublicKey>) => { transaction: () => Promise<Transaction> } };
      };
      const createSessionTx = sponsorPk
        ? await gumMethods
            .createSessionWithPayer(true, null, null)
            .accountsPartial({
              sessionToken,
              sessionSigner: sessionKp.publicKey,
              payer: sponsorPk,
              authority: wallet.publicKey,
              targetProgram: LOOFTA_PER_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .transaction()
        : await gumMethods
            .createSession(true, null, null)
            .accountsPartial({
              sessionToken,
              sessionSigner: sessionKp.publicKey,
              authority: wallet.publicKey,
              targetProgram: LOOFTA_PER_PROGRAM_ID,
            })
            .transaction();
      const revokeSessionTx = await sessionManager.program.methods
        .revokeSession()
        .accountsPartial({
          sessionToken,
          authority: wallet.publicKey,
        })
        .transaction();

      if (!senderDepositAccount) {
        mainnetTx = await initializeDeposit({
          program,
          user: wallet.publicKey,
          tokenMint: tokenMintPk,
          depositPda: senderDepositPda,
          transaction: new Transaction(),
          payer: sponsorPk ?? wallet.publicKey,
        });
      } else {
        // If the sender has a deposit, we need to undelegate to transfer more tokens to it
        if (senderIsDelegated) {
          if (amountToDeposit.gt(new BN(0))) {
            let undelegateIx = await program.methods
              .undelegate()
              .accountsPartial({
                sessionToken,
                payer: sessionKp.publicKey,
                user: wallet.publicKey,
                deposit: senderDepositPda,
              })
              .instruction();
            preliminaryTx = new Transaction();
            preliminaryTx.add(undelegateIx);
          }
        }
      }

      // Check if the recipient has a deposit, create one if not
      const recipientDepositPda = getDepositPda(recipientPk, tokenMintPk)!;
      const recipientDepositAccount = await connection.getAccountInfo(recipientDepositPda);
      const recipientIsDelegated = recipientDepositAccount?.owner.equals(
        new PublicKey(DELEGATION_PROGRAM_ID),
      );
      let recipientInitTx: Transaction | undefined;
      if (!recipientDepositAccount) {
        recipientInitTx = await initializeDeposit({
          program,
          user: recipientPk,
          tokenMint: tokenMintPk,
          depositPda: recipientDepositPda,
          transaction: new Transaction(),
          payer: sponsorPk ?? wallet.publicKey,
        });
      }

      console.log('delegation status:', senderIsDelegated, recipientIsDelegated);
      console.log('amountToDeposit:', amountToDeposit.toNumber() / Math.pow(10, 6));

      if (amountToDeposit.gt(new BN(0))) {
        console.log('depositing', amountToDeposit.toNumber() / Math.pow(10, 6));
        let depositIx = await program.methods
          .modifyBalance({ amount: amountToDeposit, increase: true })
          .accountsPartial({
            payer: sponsorPk ?? wallet.publicKey,
            user: wallet.publicKey,
            vault: vaultPda,
            deposit: senderDepositPda,
            userTokenAccount: getAssociatedTokenAddressSync(
              tokenMintPk,
              wallet.publicKey,
              true,
              TOKEN_PROGRAM_ID,
            ),
            vaultTokenAccount: getAssociatedTokenAddressSync(
              tokenMintPk,
              vaultPda,
              true,
              TOKEN_PROGRAM_ID,
            ),
            tokenMint: tokenMintPk,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction();
        mainnetTx = mainnetTx || new Transaction();
        mainnetTx.add(depositIx);
      }

      // Make sure both deposits are delegated
      if (!senderIsDelegated || preliminaryTx) {
        console.log('delegating sender');
        let delegateIx = await program.methods
          .delegate(wallet.publicKey, tokenMintPk)
          .accountsPartial({
            payer: sponsorPk ?? wallet.publicKey,
            validator: VALIDATOR_PUBKEY,
            deposit: senderDepositPda,
          })
          .instruction();
        mainnetTx = mainnetTx || new Transaction();
        mainnetTx.add(delegateIx);
      }

      if (!recipientIsDelegated) {
        console.log('delegating recipient');
        let delegateIx = await program.methods
          .delegate(recipientPk, tokenMintPk)
          .accountsPartial({
            payer: sponsorPk ?? wallet.publicKey,
            validator: VALIDATOR_PUBKEY,
            deposit: recipientDepositPda,
          })
          .instruction();
        mainnetTx = mainnetTx || new Transaction();
        mainnetTx.add(delegateIx);
      }

      // Transfer the amount from the sender to the recipient
      console.log('transferring', tokenAmount.toNumber() / Math.pow(10, 6));
      const ephemeralTx = await ephemeralProgram.methods
        .transferDeposit(tokenAmount)
        .accountsPartial({
          sessionToken,
          payer: sessionKp.publicKey,
          user: wallet.publicKey,
          sourceDeposit: senderDepositPda,
          destinationDeposit: recipientDepositPda,
          tokenMint: tokenMintPk,
        })
        .signers([sessionKp])
        .transaction();

      let blockhash = (await connection.getLatestBlockhash()).blockhash;
      let ephemeralBlockhash = (await ephemeralConnection.getLatestBlockhash()).blockhash;

      let actions: PerSendAction[] = [
        {
          name: "createSessionTx",
          tx: createSessionTx,
          signedTx: createSessionTx,
          blockhash,
          connection,
          needsSessionKpAfterWallet: true,
        },
        ...(recipientInitTx
          ? [
              {
                name: "recipientInitTx",
                tx: recipientInitTx,
                signedTx: recipientInitTx,
                blockhash,
                connection,
                needsSessionKpAfterWallet: false,
                callback: () => new Promise((resolve) => setTimeout(resolve, 3000)),
              } as PerSendAction,
            ]
          : []),
        ...(preliminaryTx
          ? [
              {
                name: "preliminaryTx",
                tx: preliminaryTx,
                signedTx: preliminaryTx,
                blockhash: ephemeralBlockhash,
                connection: ephemeralConnection,
                needsSessionKpAfterWallet: true,
                callback: async (signature?: string) => {
                  if (!signature) return;
                  let retries = 5;
                  while (retries > 0) {
                    try {
                      await GetCommitmentSignature(signature, ephemeralConnection);
                      break;
                    } catch {
                      retries--;
                    }
                  }
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                },
              } as PerSendAction,
            ]
          : []),
        ...(mainnetTx
          ? [
              {
                name: "mainnetTx",
                tx: mainnetTx,
                signedTx: mainnetTx,
                blockhash,
                connection,
                needsSessionKpAfterWallet: false,
              } as PerSendAction,
            ]
          : []),
        {
          name: "ephemeralTx",
          tx: ephemeralTx,
          signedTx: ephemeralTx,
          blockhash: ephemeralBlockhash,
          connection: ephemeralConnection,
          needsSessionKpAfterWallet: true,
          callback: async (signature?: string) => {
            if (!signature) return;
            await ephemeralConnection.confirmTransaction(signature);
          },
        },
        {
          name: "revokeSessionTx",
          tx: revokeSessionTx,
          signedTx: revokeSessionTx,
          blockhash,
          connection,
          needsSessionKpAfterWallet: false,
        },
      ].map((action) => {
        const tx = action.tx;
        tx.recentBlockhash = action.blockhash;
        tx.feePayer =
          action.blockhash === ephemeralBlockhash ? sessionKp.publicKey : sponsorPk ?? wallet.publicKey;
        return { ...action, tx };
      });

      // Ephemeral txs: session keypair signs first (not sent through sponsor endpoint).
      // createSessionTx must NOT be pre-signed: some wallet implementations can rebuild
      // the tx during signing and drop existing signatures.
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (action.blockhash === ephemeralBlockhash) {
          action.tx.partialSign(sessionKp);
          actions[i].signedTx = action.tx;
        }
      }

      // Wallet signs only base-cluster txs (not ephemeral blockhash).
      const userSignedActions = actions.filter((a) => a.blockhash !== ephemeralBlockhash);
      onProgress?.({ phase: "awaiting_signature", walletTransactionCount: userSignedActions.length });
      if (useSponsorRelayer && options?.privyUserId) {
        for (let i = 0; i < userSignedActions.length; i++) {
          const action = userSignedActions[i];
          const prepared = await prepareSponsoredTransaction(
            action.tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
            options.privyUserId,
            action.name,
          );
          const preparedTx = Transaction.from(prepared);
          action.tx = preparedTx;
          action.signedTx = preparedTx;
          actions = actions.map((a) => (a.name === action.name ? { ...a, tx: preparedTx, signedTx: preparedTx } : a));
        }
      }

      // IMPORTANT: Do not merge wallet-signed actions when using backend sponsorship.
      // The sponsor endpoint validates the tx feePayer; reusing a merged tx across actions
      // can produce "Invalid fee payer in transaction" even if individual actions were correct.
      const walletTxs = userSignedActions.map((a) => a.tx);
      const signedWalletTxs = await wallet.signAllTransactions(walletTxs);
      for (let i = 0; i < userSignedActions.length; i++) {
        userSignedActions[i].signedTx = signedWalletTxs[i];
        if (userSignedActions[i].needsSessionKpAfterWallet) {
          userSignedActions[i].signedTx.partialSign(sessionKp);
        }
        // Keep the broadcast action list in sync with signed wallet tx objects.
        const actionIdx = actions.findIndex((a) => a.name === userSignedActions[i].name);
        if (actionIdx >= 0) {
          actions[actionIdx].signedTx = userSignedActions[i].signedTx;
        }
      }

      // Ephemeral txs: full sign with session keypair.
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (action.blockhash === ephemeralBlockhash) {
          action.tx.sign(sessionKp);
          actions[i].signedTx = action.tx;
        }
      }

      let lastSignature = "";
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        onProgress?.({ phase: "broadcasting", step: action.name, index: i + 1, total: actions.length });
        let signature = "";
        try {
          const isEphemeral = action.blockhash === ephemeralBlockhash;
          console.info(
            `[PER] broadcast ${i + 1}/${actions.length} ${action.name} ephemeral=${isEphemeral} sponsorPath=${Boolean(useSponsorRelayer && options?.privyUserId && !isEphemeral)}`,
          );
          if (useSponsorRelayer && options?.privyUserId && !isEphemeral) {
            // Sponsor path: backend co-signs and broadcasts wallet-signed tx bytes (for rent/fees).
            const bytes = action.signedTx.serialize({ requireAllSignatures: false, verifySignatures: false });
            signature = await signAndBroadcastSponsoredTx(bytes, options.privyUserId, action.name);
            await waitForSignatureConfirmation(action.connection, signature, 120_000, 1500, action.name);
          } else {
            signature = await action.connection.sendRawTransaction(action.signedTx.serialize(), { preflightCommitment: "confirmed" });
            await waitForSignatureConfirmation(action.connection, signature, 120_000, 1500, action.name);
          }
          await action.callback?.(signature);
          lastSignature = signature;
        } catch (e) {
          if (e instanceof SendTransactionError) {
            try {
              const logs = await e.getLogs(action.connection);
              console.error(`[PER] ${action.name} simulation failed, logs:`, logs);
            } catch {
              // ignore log fetch failures
            }
            throw new Error(`[PER] ${action.name}: ${e.message}`);
          }
          throw e;
        }
      }
      await waitForSignatureConfirmation(connection, lastSignature, 60_000, 1500, "final").catch(() => {});
      return lastSignature;
    },
    [connection, ensureAuthToken, programForWallet, getDepositPda, getVaultPda],
  );

  return { transfer };
}

"use client";

import { useCallback, useMemo } from "react";
import type { Wallet } from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Transaction, Connection } from "@solana/web3.js";
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
  VALIDATOR_PUBKEY,
  DEPOSIT_PDA_SEED,
  VAULT_PDA_SEED,
  EPHEMERAL_RPC_URL,
} from "@/lib/per/constants";
import { getSolanaHttpRpc } from "@/lib/solanaCluster";
import { usePerAuth } from "@/hooks/usePerAuth";
import { logPerError } from "@/lib/per/log";

interface DepositAccount {
  user: PublicKey;
  token_mint: PublicKey;
  amount: BN;
}

async function initializeDeposit({
  program,
  user,
  tokenMint,
  depositPda,
  transaction,
}: {
  program: Program;
  user: PublicKey;
  tokenMint: PublicKey;
  depositPda: PublicKey;
  transaction: Transaction;
}) {
  let initIx = await program.methods
    .initializeDeposit()
    .accountsPartial({
      payer: program.provider.publicKey,
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
      payer: program.provider.publicKey,
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
    async (wallet: Wallet, recipient: string, tokenMint: string, amount: number) => {
      if (!connection) {
        throw new Error("Connection not ready.");
      }
      const program = programForWallet(wallet);
      let token: string;
      try {
        token = await ensureAuthToken(wallet.publicKey);
      } catch (e) {
        logPerError(e, { step: "ensureAuthToken", userPubkey: wallet.publicKey.toBase58() });
        throw e;
      }
      const ephemeralConnection = new Connection(`${EPHEMERAL_RPC_URL}?token=${token}`, "confirmed");
      const ephemeralProgram = new Program(
        LooftaPerIdl as never,
        new AnchorProvider(ephemeralConnection, wallet, { commitment: "confirmed" }),
      );

      let tokenAmount = new BN(Math.pow(10, 6) * amount);
      const recipientPk = new PublicKey(recipient);
      const tokenMintPk = new PublicKey(tokenMint);

      let preliminaryTx: Transaction | undefined;
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
      const createSessionTx = await sessionManager.program.methods
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
        });
      }

      console.log('delegation status:', senderIsDelegated, recipientIsDelegated);
      console.log('amountToDeposit:', amountToDeposit.toNumber() / Math.pow(10, 6));

      if (amountToDeposit.gt(new BN(0))) {
        console.log('depositing', amountToDeposit.toNumber() / Math.pow(10, 6));
        let depositIx = await program.methods
          .modifyBalance({ amount: amountToDeposit, increase: true })
          .accountsPartial({
            payer: program.provider.publicKey,
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
            payer: wallet.publicKey,
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
            payer: wallet.publicKey,
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
          user: program.provider.publicKey,
          sourceDeposit: senderDepositPda,
          destinationDeposit: recipientDepositPda,
          tokenMint: tokenMintPk,
        })
        .signers([sessionKp])
        .transaction();

      let blockhash = (await connection.getLatestBlockhash()).blockhash;
      let ephemeralBlockhash = (await ephemeralConnection.getLatestBlockhash()).blockhash;

      let actions = [
        {
          name: 'createSessionTx',
          tx: createSessionTx,
          signedTx: createSessionTx,
          blockhash,
          connection,
        },
        {
          name: 'recipientInitTx',
          tx: recipientInitTx,
          signedTx: recipientInitTx,
          blockhash,
          connection,
          callback: () => new Promise(resolve => setTimeout(resolve, 3000)),
        },
        {
          name: 'preliminaryTx',
          tx: preliminaryTx,
          signedTx: preliminaryTx,
          blockhash: ephemeralBlockhash,
          connection: ephemeralConnection,
          callback: async (signature: string) => {
            let retries = 5;
            while (retries > 0) {
              try {
                await GetCommitmentSignature(signature, ephemeralConnection);
              } catch (error) {
                retries--;
              }
            }
            return new Promise(resolve => setTimeout(resolve, 1000));
          },
        },
        {
          name: 'mainnetTx',
          tx: mainnetTx,
          signedTx: mainnetTx,
          blockhash,
          connection,
        },
        {
          name: 'ephemeralTx',
          tx: ephemeralTx,
          signedTx: ephemeralTx,
          blockhash: ephemeralBlockhash,
          connection: ephemeralConnection,
          callback: (signature: string) => ephemeralConnection.confirmTransaction(signature),
        },
        {
          name: 'revokeSessionTx',
          tx: revokeSessionTx,
          signedTx: revokeSessionTx,
          blockhash,
          connection,
        },
      ]
        .filter(action => action.tx)
        .map(action => {
          let tx = action.tx!;
          tx.recentBlockhash = action.blockhash;
          tx.feePayer =
            action.blockhash === ephemeralBlockhash
              ? sessionKp.publicKey
              : program.provider.publicKey;
          return { ...action, tx };
        });

      for (let i = 0; i < actions.length; i++) {
        let action = actions[i];
        if (action.blockhash === ephemeralBlockhash || action.name === 'createSessionTx') {
          action.tx!.partialSign(sessionKp);
          actions[i].signedTx = action.tx!;
        }
      }

      let userSignedActions = actions.filter(action => action.blockhash !== ephemeralBlockhash);
      let txs = userSignedActions.map(action => action.tx!);
      let signedTxs = await wallet.signAllTransactions(txs);

      for (let i = 0; i < actions.length; i++) {
        let action = actions[i];
        if (action.blockhash === ephemeralBlockhash) {
          action.tx!.sign(sessionKp);
          actions[i].signedTx = action.tx!;
        } else {
          actions[i].signedTx = signedTxs[userSignedActions.findIndex(a => a.name === action.name)];
        }
      }

      let lastSignature = "";
      for (let action of actions) {
        console.log(`Sending ${action.name} transaction`);
        const signature = await action.connection.sendRawTransaction(action.signedTx!.serialize(), {
          preflightCommitment: "confirmed",
        });
        await action.connection.confirmTransaction(signature);
        await action.callback?.(signature);
        lastSignature = signature;
      }
      return lastSignature;
    },
    [connection, ensureAuthToken, programForWallet, getDepositPda, getVaultPda],
  );

  return { transfer };
}

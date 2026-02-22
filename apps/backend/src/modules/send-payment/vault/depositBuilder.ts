/**
 * From privacy-hack lib/sponsor/depositBuilder.ts
 * Builds a PrivacyCash deposit transaction without submitting.
 * privacycash is ESM-only; we dynamic-import it here so CJS build can run.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import BN from 'bn.js';
import { WasmFactory } from '@lightprotocol/hasher.rs';

import { TOKEN_MINTS, TokenType } from './tokens';
import { getCircuitBasePathCached, assertCircuitFilesExist } from './circuitPath';

import { importEsm } from './esmLoader';

/** Load ESM-only privacycash modules (used inside buildDepositSPLTransaction). */
async function loadPrivacyCash() {
  const [utxoMod, keypairMod, utilsMod, proverMod, merkleMod, encryptionMod, altMod, loggerMod, constantsMod, getUtxosMod] =
    await Promise.all([
      importEsm<typeof import('privacycash/dist/models/utxo.js')>('privacycash/dist/models/utxo.js'),
      importEsm<typeof import('privacycash/dist/models/keypair.js')>('privacycash/dist/models/keypair.js'),
      importEsm<typeof import('privacycash/dist/utils/utils.js')>('privacycash/dist/utils/utils.js'),
      importEsm<typeof import('privacycash/dist/utils/prover.js')>('privacycash/dist/utils/prover.js'),
      importEsm<typeof import('privacycash/dist/utils/merkle_tree.js')>('privacycash/dist/utils/merkle_tree.js'),
      importEsm<typeof import('privacycash/dist/utils/encryption.js')>('privacycash/dist/utils/encryption.js'),
      importEsm<typeof import('privacycash/dist/utils/address_lookup_table.js')>('privacycash/dist/utils/address_lookup_table.js'),
      importEsm<typeof import('privacycash/dist/utils/logger.js')>('privacycash/dist/utils/logger.js'),
      importEsm<typeof import('privacycash/dist/utils/constants.js')>('privacycash/dist/utils/constants.js'),
      importEsm<typeof import('privacycash/dist/getUtxosSPL.js')>('privacycash/dist/getUtxosSPL.js'),
    ]);
  return {
    Utxo: utxoMod.Utxo,
    UtxoKeypair: keypairMod.Keypair,
    ...utilsMod,
    ...proverMod,
    MerkleTree: merkleMod.MerkleTree,
    EncryptionService: encryptionMod.EncryptionService,
    serializeProofAndExtData: encryptionMod.serializeProofAndExtData,
    useExistingALT: altMod.useExistingALT,
    logger: loggerMod.logger,
    ...constantsMod,
    getUtxosSPL: getUtxosMod.getUtxosSPL,
  };
}

export interface BuildDepositParams {
  connection: Connection;
  userKeypair?: Keypair;
  userPublicKey?: PublicKey;
  sessionSignature?: Uint8Array;
  baseUnits: number;
  token: TokenType;
  storage: Storage;
  sponsorPublicKey?: PublicKey;
}

export interface BuildDepositResult {
  transaction: VersionedTransaction;
  mintAddress: PublicKey;
  encryptedOutput: Uint8Array;
  lastValidBlockHeight: number;
}

export async function buildDepositSPLTransaction(
  params: BuildDepositParams,
): Promise<BuildDepositResult> {
  const keyBasePath = getCircuitBasePathCached();
  assertCircuitFilesExist(keyBasePath);

  const ph = await loadPrivacyCash();
  const {
    Utxo,
    UtxoKeypair,
    fetchMerkleProof,
    findNullifierPDAs,
    getProgramAccounts,
    queryRemoteTreeState,
    findCrossCheckNullifierPDAs,
    getExtDataHash,
    getMintAddressField,
    prove,
    parseProofToBytesArray,
    parseToBytesArray,
    MerkleTree,
    EncryptionService,
    serializeProofAndExtData,
    useExistingALT,
    logger,
    FIELD_SIZE,
    FEE_RECIPIENT,
    MERKLE_TREE_DEPTH,
    PROGRAM_ID,
    ALT_ADDRESS,
    tokens,
    getUtxosSPL,
  } = ph;

  const {
    connection,
    userKeypair,
    userPublicKey: providedPublicKey,
    sessionSignature,
    baseUnits,
    token,
    storage,
    sponsorPublicKey,
  } = params;

  if (!userKeypair && !sessionSignature) {
    throw new Error('Either userKeypair or sessionSignature must be provided');
  }
  if (!userKeypair && !providedPublicKey) {
    throw new Error('userPublicKey is required when using sessionSignature');
  }

  const mintAddress = TOKEN_MINTS[token];
  const userPublicKey = userKeypair?.publicKey ?? providedPublicKey!;

  const tokenInfo = tokens.find((t) => t.pubkey.toString() === mintAddress.toString());
  if (!tokenInfo) throw new Error('Token not found: ' + mintAddress.toString());

  const lightWasm = await WasmFactory.getInstance();
  const encryptionService = new EncryptionService();
  if (userKeypair) {
    encryptionService.deriveEncryptionKeyFromWallet(userKeypair);
  } else {
    encryptionService.deriveEncryptionKeyFromSignature(sessionSignature!);
  }

  const recipient = FEE_RECIPIENT;
  const recipient_ata = getAssociatedTokenAddressSync(tokenInfo.pubkey, recipient, true);
  const feeRecipientTokenAccount = getAssociatedTokenAddressSync(
    tokenInfo.pubkey,
    FEE_RECIPIENT,
    true,
  );
  const signerTokenAccount = getAssociatedTokenAddressSync(tokenInfo.pubkey, userPublicKey);

  const [treeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('merkle_tree'), tokenInfo.pubkey.toBuffer()],
    PROGRAM_ID,
  );

  const fee_base_units = 0;

  const accountInfo = await getAccount(connection, signerTokenAccount);
  const balance = Number(accountInfo.amount);
  if (balance < baseUnits + fee_base_units) {
    throw new Error(
      `Insufficient token balance. Need ${baseUnits / tokenInfo.units_per_token} ${tokenInfo.name}`,
    );
  }

  const { globalConfigAccount } = getProgramAccounts();
  const tree = new MerkleTree(MERKLE_TREE_DEPTH, lightWasm);
  const { root, nextIndex: currentNextIndex } = await queryRemoteTreeState(tokenInfo.name);

  logger.debug(`Using tree root: ${root}`);
  logger.debug(`Next indices: ${currentNextIndex}, ${currentNextIndex + 1}`);

  const utxoPrivateKey = encryptionService.getUtxoPrivateKeyV2();
  const utxoKeypair = new UtxoKeypair(utxoPrivateKey, lightWasm);

  logger.debug('Fetching existing UTXOs...');
  const mintUtxos = await getUtxosSPL({
    connection,
    publicKey: userPublicKey,
    encryptionService,
    storage,
    mintAddress,
  });

  let extAmount: number;
  let outputAmount: string;
  let inputs: Utxo[];
  let inputMerklePathIndices: number[];
  let inputMerklePathElements: string[][];

  if (mintUtxos.length === 0) {
    extAmount = baseUnits;
    outputAmount = new BN(baseUnits).sub(new BN(fee_base_units)).toString();
    inputs = [
      new Utxo({ lightWasm, keypair: utxoKeypair, mintAddress: tokenInfo.pubkey.toString() }),
      new Utxo({ lightWasm, keypair: utxoKeypair, mintAddress: tokenInfo.pubkey.toString() }),
    ];
    inputMerklePathIndices = inputs.map((input) => input.index || 0);
    inputMerklePathElements = inputs.map(() => [...new Array(tree.levels).fill('0')]);
  } else {
    const firstUtxo = mintUtxos[0];
    const secondUtxoAmount = mintUtxos.length > 1 ? mintUtxos[1].amount : new BN(0);
    extAmount = baseUnits;
    outputAmount = firstUtxo.amount
      .add(secondUtxoAmount)
      .add(new BN(baseUnits))
      .sub(new BN(fee_base_units))
      .toString();
    const secondUtxo =
      mintUtxos.length > 1
        ? mintUtxos[1]
        : new Utxo({
            lightWasm,
            keypair: utxoKeypair,
            amount: '0',
            mintAddress: tokenInfo.pubkey.toString(),
          });
    inputs = [firstUtxo, secondUtxo];
    const firstUtxoCommitment = await firstUtxo.getCommitment();
    const firstUtxoMerkleProof = await fetchMerkleProof(firstUtxoCommitment, tokenInfo.name);
    let secondUtxoMerkleProof;
    if (secondUtxo.amount.gt(new BN(0))) {
      const secondUtxoCommitment = await secondUtxo.getCommitment();
      secondUtxoMerkleProof = await fetchMerkleProof(secondUtxoCommitment, tokenInfo.name);
    }
    inputMerklePathIndices = [
      firstUtxo.index || 0,
      secondUtxo.amount.gt(new BN(0)) ? secondUtxo.index || 0 : 0,
    ];
    inputMerklePathElements = [
      firstUtxoMerkleProof.pathElements,
      secondUtxo.amount.gt(new BN(0))
        ? secondUtxoMerkleProof!.pathElements
        : [...new Array(tree.levels).fill('0')],
    ];
  }

  const publicAmountForCircuit = new BN(extAmount)
    .sub(new BN(fee_base_units))
    .add(FIELD_SIZE)
    .mod(FIELD_SIZE);

  const outputs = [
    new Utxo({
      lightWasm,
      amount: outputAmount,
      keypair: utxoKeypair,
      index: currentNextIndex,
      mintAddress: tokenInfo.pubkey.toString(),
    }),
    new Utxo({
      lightWasm,
      amount: '0',
      keypair: utxoKeypair,
      index: currentNextIndex + 1,
      mintAddress: tokenInfo.pubkey.toString(),
    }),
  ];

  const inputNullifiers = await Promise.all(inputs.map((x) => x.getNullifier()));
  const outputCommitments = await Promise.all(outputs.map((x) => x.getCommitment()));

  const encryptedOutput1 = encryptionService.encryptUtxo(outputs[0]);
  const encryptedOutput2 = encryptionService.encryptUtxo(outputs[1]);

  const extData = {
    recipient: recipient_ata,
    extAmount: new BN(extAmount),
    encryptedOutput1,
    encryptedOutput2,
    fee: new BN(fee_base_units),
    feeRecipient: feeRecipientTokenAccount,
    mintAddress: tokenInfo.pubkey.toString(),
  };

  const calculatedExtDataHash = getExtDataHash(extData);

  const input = {
    root,
    mintAddress: getMintAddressField(tokenInfo.pubkey),
    publicAmount: publicAmountForCircuit.toString(),
    extDataHash: calculatedExtDataHash,
    inAmount: inputs.map((x) => x.amount.toString(10)),
    inPrivateKey: inputs.map((x) => x.keypair.privkey),
    inBlinding: inputs.map((x) => x.blinding.toString(10)),
    inPathIndices: inputMerklePathIndices,
    inPathElements: inputMerklePathElements,
    inputNullifier: inputNullifiers,
    outAmount: outputs.map((x) => x.amount.toString(10)),
    outBlinding: outputs.map((x) => x.blinding.toString(10)),
    outPubkey: outputs.map((x) => x.keypair.pubkey),
    outputCommitment: outputCommitments,
  };

  logger.info('generating ZK proof...');
  const { proof, publicSignals } = await prove(input, keyBasePath);
  const proofInBytes = parseProofToBytesArray(proof);
  const inputsInBytes = parseToBytesArray(publicSignals);

  const proofToSubmit = {
    proofA: proofInBytes.proofA,
    proofB: proofInBytes.proofB.flat(),
    proofC: proofInBytes.proofC,
    root: inputsInBytes[0],
    publicAmount: inputsInBytes[1],
    extDataHash: inputsInBytes[2],
    inputNullifiers: [inputsInBytes[3], inputsInBytes[4]],
    outputCommitments: [inputsInBytes[5], inputsInBytes[6]],
  };

  const { nullifier0PDA, nullifier1PDA } = findNullifierPDAs(proofToSubmit);
  const { nullifier2PDA, nullifier3PDA } = findCrossCheckNullifierPDAs(proofToSubmit);

  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_config')],
    PROGRAM_ID,
  );
  const treeAta = getAssociatedTokenAddressSync(tokenInfo.pubkey, globalConfigPda, true);

  const lookupTableAccount = await useExistingALT(connection, ALT_ADDRESS);
  if (!lookupTableAccount?.value) {
    throw new Error(`ALT not found at ${ALT_ADDRESS.toString()}`);
  }

  const serializedProof = serializeProofAndExtData(proofToSubmit, extData, true);
  logger.debug(`Instruction data size: ${serializedProof.length} bytes`);
  // Note: Privy signAndSendTransaction relay has ~1232-byte raw tx limit. To fit, instruction data would need
  // to be smaller (e.g. compact proof format or chunked submission would require protocol/circuit changes).

  const depositInstruction = new TransactionInstruction({
    keys: [
      { pubkey: treeAccount, isSigner: false, isWritable: true },
      { pubkey: nullifier0PDA, isSigner: false, isWritable: true },
      { pubkey: nullifier1PDA, isSigner: false, isWritable: true },
      { pubkey: nullifier2PDA, isSigner: false, isWritable: false },
      { pubkey: nullifier3PDA, isSigner: false, isWritable: false },
      { pubkey: globalConfigAccount, isSigner: false, isWritable: false },
      { pubkey: userPublicKey, isSigner: true, isWritable: true },
      { pubkey: tokenInfo.pubkey, isSigner: false, isWritable: false },
      { pubkey: signerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: recipient_ata, isSigner: false, isWritable: true },
      { pubkey: treeAta, isSigner: false, isWritable: true },
      { pubkey: feeRecipientTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: serializedProof,
  });

  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const feePayerKey = sponsorPublicKey ?? userPublicKey;

  const messageV0 = new TransactionMessage({
    payerKey: feePayerKey,
    recentBlockhash: blockhash,
    instructions: [modifyComputeUnits, depositInstruction],
  }).compileToV0Message([lookupTableAccount.value]);

  const transaction = new VersionedTransaction(messageV0);

  return {
    transaction,
    mintAddress: tokenInfo.pubkey,
    encryptedOutput: encryptedOutput1,
    lastValidBlockHeight,
  };
}

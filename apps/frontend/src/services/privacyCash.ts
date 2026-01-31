/**
 * Privacy Cash Service - Private payments on Solana
 * Uses Solana wallet signing to derive encryption key and sign transactions
 * 
 * ⚠️ IMPORTANT: This service requires WASM files from @lightprotocol/hasher.rs
 * If you see build errors, the WASM files may be missing from the package.
 * 
 * To fix:
 * 1. Ensure you're using webpack (not Turbopack): `npm run dev`
 * 2. Check if WASM files exist: `ls node_modules/@lightprotocol/hasher.rs/dist/*.wasm`
 * 3. If missing, you may need to build them from source or get them from the package's GitHub repo
 */

import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { USDC_MINT } from './solanaBalance';

// Use Helius RPC if available, otherwise fallback to public RPC
// Get free Helius API key at: https://www.helius.dev/
const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL 
  || (process.env.NEXT_PUBLIC_HELIUS_API_KEY 
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com");
const PRIVACY_CASH_MESSAGE = "Privacy Money account sign in"; // Constant message Privacy Cash uses

// Privacy Cash fee config
export const PRIVACY_CASH_FEES = {
  withdraw_fee_rate: 0.0035, // 0.35%
  withdraw_rent_fee: 0.006, // SOL
  deposit_fee_rate: 0,
  minimum_withdrawal: {
    usdc: 2, // $2 minimum
  },
  usdc_withdraw_rent_fee: 0.744548676, // USDC - withdrawal rent fee
};

/**
 * Create EncryptionService from Solana wallet signature
 */
export async function createEncryptionServiceFromSignature(signature: Uint8Array) {
  try {
    const { EncryptionService } = await import('privacycash/utils');
    const encryptionService = new EncryptionService();
    encryptionService.deriveEncryptionKeyFromSignature(signature);
    return encryptionService;
  } catch (error) {
    console.error('[PrivacyCash] Failed to import SDK:', error);
    throw new Error('Privacy Cash SDK not available');
  }
}

/**
 * Pay privately using Privacy Cash
 * This deposits to Privacy Cash pool and withdraws to recipient privately
 * 
 * ⚠️ CRITICAL: This function REQUIRES webpack (not Turbopack) due to WASM support limitations.
 * 
 * If you see build errors about 'hasher_wasm_simd_bg.wasm', you are using Turbopack.
 * 
 * SOLUTION: Use `npm run dev:webpack` instead of `npm run dev`
 * 
 * Turbopack does not support WASM modules loaded via import.meta.url yet.
 * Production builds use webpack by default, so they work fine.
 */
export async function payPrivatelyWithPrivacyCash(options: {
  walletAddress: string;
  amountUSD: number;
  recipientAddress: string;
  signMessage: (message: string) => Promise<Uint8Array>;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  recipientPaysFees?: boolean; // If true, recipient pays fees - payer deposits exact amount
}): Promise<{ success: boolean; signature?: string; error?: string }> {
  console.log('[PrivacyCash] payPrivatelyWithPrivacyCash called', {
    walletAddress: options.walletAddress?.slice(0, 8) + '…',
    amountUSD: options.amountUSD,
    recipientAddress: options.recipientAddress?.slice(0, 8) + '…',
    recipientPaysFees: options.recipientPaysFees,
  });
  try {
    // Check if we're in a Turbopack environment (which doesn't support WASM)
    if (typeof window !== 'undefined' && (window as any).__NEXT_DATA__?.buildId) {
      // This is a runtime check - build-time errors will still occur with Turbopack
      console.warn('[PrivacyCash] If you see WASM errors, use `npm run dev:webpack` instead of `npm run dev`');
    }

    // Step 1: Sign the constant message to derive encryption key
    console.log('[PrivacyCash] Step 1: signing message for encryption key…');
    const messageSignature = await options.signMessage(PRIVACY_CASH_MESSAGE);
    console.log('[PrivacyCash] Step 1: message signed');

    // Step 2: Create EncryptionService from signature
    const encryptionService = await createEncryptionServiceFromSignature(messageSignature);
    console.log('[PrivacyCash] Step 2: EncryptionService created');
    
    // Step 3: Import Privacy Cash SDK functions with dynamic import
    // CRITICAL: These imports will fail at build time if WASM files are missing
    // The WASM files must exist in: node_modules/@lightprotocol/hasher.rs/dist/
    let sdkModule: any;
    let hasherModule: any;
    
    try {
      [sdkModule, hasherModule] = await Promise.all([
        import('privacycash/utils'),
        import('@lightprotocol/hasher.rs').catch((error) => {
          console.error('[PrivacyCash] Failed to load @lightprotocol/hasher.rs:', error);
          throw new Error(
            'Privacy Cash SDK not available. ' +
            'WASM files may be missing from @lightprotocol/hasher.rs package. ' +
            'Please ensure you are using webpack (not Turbopack) and that the package is properly installed. ' +
            'Check: node_modules/@lightprotocol/hasher.rs/dist/*.wasm'
          );
        }),
      ]);
    } catch (error: any) {
      // If import fails, provide helpful error message
      if (error.message?.includes('hasher_wasm_simd_bg.wasm') || error.message?.includes('Cannot resolve')) {
        throw new Error(
          'Privacy Cash WASM files not found. ' +
          'The @lightprotocol/hasher.rs package may be missing WASM files. ' +
          'Please check: node_modules/@lightprotocol/hasher.rs/dist/ ' +
          'You may need to build them from source or contact the package maintainers.'
        );
      }
      throw error;
    }
    
    const { depositSPL, withdrawSPL } = sdkModule;
    const { WasmFactory } = hasherModule;
    const lightWasm = await WasmFactory.getInstance();
    console.log('[PrivacyCash] Step 3: SDK and WASM loaded');

    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const publicKey = new PublicKey(options.walletAddress);
    const recipient = new PublicKey(options.recipientAddress);
    
    // Calculate amount with fees
    // Privacy Cash's withdrawSPL automatically deducts fees from the withdrawal amount:
    //   fee_base_units = (base_units * withdraw_fee_rate) + (units_per_token * token_rent_fee)
    //   recipient_receives = base_units - fee_base_units
    // 
    // To ensure recipient receives exactly options.amountUSD, we need to solve:
    //   Let W = withdrawal amount in USD
    //   Let R = requested amount (options.amountUSD)
    //   Let r = withdraw_fee_rate (0.0035)
    //   Let F = rent_fee in USD (0.744548676)
    //   Let U = units_per_token (1,000,000 for USDC)
    //
    //   fee_base_units = (W * U * r) + (U * F)
    //   recipient_base_units = (W * U) - fee_base_units
    //   R * U = (W * U) - (W * U * r) - (U * F)
    //   R = W - (W * r) - F
    //   R = W * (1 - r) - F
    //   R + F = W * (1 - r)
    //   W = (R + F) / (1 - r)
    //
    // Then we deposit: W (which includes fees)
    // And withdraw: W (Privacy Cash deducts fees, recipient gets R)
    
    const rentFeeUSD = PRIVACY_CASH_FEES.usdc_withdraw_rent_fee;
    const feeRate = PRIVACY_CASH_FEES.withdraw_fee_rate;
    
    let withdrawalAmountUSD: number;
    let totalAmountToDepositUSD: number;
    let withdrawalFeeUSD: number;
    let totalFeesUSD: number;
    
    if (options.recipientPaysFees) {
      // Recipient pays fees - payer deposits and withdraws exact amount
      // Recipient will receive: amountUSD - fees (Privacy Cash deducts fees)
      withdrawalAmountUSD = options.amountUSD;
      totalAmountToDepositUSD = options.amountUSD;
      withdrawalFeeUSD = withdrawalAmountUSD * feeRate;
      totalFeesUSD = withdrawalFeeUSD + rentFeeUSD;
    } else {
      // Payer pays fees - calculate amount needed so recipient receives exactly options.amountUSD
      // withdrawalAmount = (requestedAmount + rentFee) / (1 - feeRate)
      withdrawalAmountUSD = (options.amountUSD + rentFeeUSD) / (1 - feeRate);
      totalAmountToDepositUSD = withdrawalAmountUSD; // Deposit this amount
      
      // Calculate what fees will be deducted (for logging)
      withdrawalFeeUSD = withdrawalAmountUSD * feeRate;
      totalFeesUSD = withdrawalFeeUSD + rentFeeUSD;
    }
    
    const depositBaseUnits = Math.floor(totalAmountToDepositUSD * 1_000_000); // USDC has 6 decimals
    const withdrawBaseUnits = Math.floor(withdrawalAmountUSD * 1_000_000); // Withdraw this amount
    
    console.log('[PrivacyCash] Fee calculation:', {
      requestedAmountUSD: options.amountUSD,
      withdrawalAmountUSD,
      withdrawalFeeUSD,
      rentFeeUSD,
      totalFeesUSD,
      totalAmountToDepositUSD,
      depositBaseUnits,
      withdrawBaseUnits,
      expectedRecipientAmountUSD: withdrawalAmountUSD - totalFeesUSD,
    });
    
    const storage = typeof window !== 'undefined' ? window.localStorage : ({} as Storage);
    // Circuit files are copied to public/circuit2 during postinstall
    // The privacycash package includes circuit2/transaction2.wasm and transaction2.zkey
    const keyBasePath = '/circuit2/transaction2';
    
    // Step 4: Deposit to Privacy Cash pool
    console.log('[PrivacyCash] Depositing to Privacy Cash pool...');
    console.log('[PrivacyCash] Deposit parameters:', {
      mintAddress: USDC_MINT,
      mintAddressType: typeof USDC_MINT,
      publicKey: publicKey?.toString(),
      connection: connection?.rpcEndpoint,
      base_units: depositBaseUnits,
      storage: storage ? 'available' : 'missing',
      encryptionService: encryptionService ? 'available' : 'missing',
      keyBasePath,
      lightWasm: lightWasm ? 'available' : 'missing',
      transactionSigner: options.signTransaction ? 'available' : 'missing',
    });
    
    // Validate USDC_MINT is defined
    if (!USDC_MINT) {
      throw new Error('USDC_MINT is undefined. Check solanaBalance.ts exports.');
    }
    
    // Validate required parameters
    if (!publicKey) {
      throw new Error('publicKey is undefined');
    }
    if (!connection) {
      throw new Error('connection is undefined');
    }
    if (!storage) {
      throw new Error('storage is undefined');
    }
    if (!encryptionService) {
      throw new Error('encryptionService is undefined');
    }
    if (!lightWasm) {
      throw new Error('lightWasm is undefined');
    }
    if (!options.signTransaction) {
      throw new Error('transactionSigner is undefined');
    }
    
    const depositResult = await depositSPL({
      mintAddress: USDC_MINT,
      publicKey,
      connection,
      base_units: depositBaseUnits, // Deposit amount that includes fees
      storage,
      encryptionService,
      keyBasePath,
      lightWasm,
      transactionSigner: options.signTransaction,
    });
    
    console.log('[PrivacyCash] Deposit successful, signature:', depositResult.signature);
    
    // Step 5: Withdraw from Privacy Cash pool to recipient
    // Privacy Cash will automatically deduct fees from this amount
    // Recipient will receive: withdrawalAmount - fees = options.amountUSD
    console.log('[PrivacyCash] Withdrawing from Privacy Cash pool to recipient...');
    const withdrawResult = await withdrawSPL({
      mintAddress: USDC_MINT,
      publicKey,
      connection,
      base_units: withdrawBaseUnits, // Withdraw this amount (fees will be deducted automatically)
      recipient,
      storage,
      encryptionService,
      keyBasePath,
      lightWasm,
    });
    
    // withdrawSPL returns { tx: signature, recipient, base_units, fee_base_units, isPartial }
    const signature = withdrawResult.tx || withdrawResult.signature;
    console.log('[PrivacyCash] Withdraw successful, signature:', signature);
    
    return { success: true, signature };
  } catch (error: any) {
    console.error('[PrivacyCash] Private payment failed:', error);
    return { success: false, error: error.message || 'Private payment failed' };
  }
}

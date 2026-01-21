'use client'

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenCombobox } from "@/components/TokenCombobox";
import type { TokenSelection } from "@/app/utils/types";
import { findTokenBySelection } from "@/lib/tokens";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth } from "@/hooks/useAuth";
import { getAccurateQuote } from "@/services/nearIntents";
import { createSwapTransaction } from "@/services/swapProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { Ticket, Info, Trophy, Zap, Wallet, Loader2, ArrowLeft } from "lucide-react";
import { isEvmChainId } from "@/config/biconomy";
import { getRefundToForChain } from "@/lib/refundAddresses";
import { encodeTicketPurchase, getTicketAutomatorAddress } from "@/services/lottery";
import { pollCompanionBalance } from "@/services/lotteryPurchase";
import { listAllCompanionWallets, recoverFundsFromCompanion } from "@/services/rhinestone";
import {
  getCompanionWalletForRecipient,
  executeCompanionTransaction,
  getCompanionBalanceFromApi,
  clearCompanionWallet
} from "@/services/companionApi";
import { useCompanionWalletStore } from "@/store/companionWallet";

// TicketAutomator contract on Base - receives ETH and mints IFT NFTs to recipient
// Contract: https://basescan.org/address/0xd1950a138328b52da4fe73dbdb167a83f2c83db9
const TICKET_AUTOMATOR_CONTRACT = getTicketAutomatorAddress();
const TICKET_PRICE_USD = 9.95; // Price per ticket in USD (from the website)
const BRIDGE_FEE_USD = 0.15; // Estimated bridge fee in USD
const GAS_FEE_BUFFER_USD = 0.10; // Gas fee buffer for Base (very low gas fees)
// Lottery fee from env (default 1%)
const LOTTERY_FEE_PERCENT = Number(process.env.NEXT_PUBLIC_LOTTERY_FEE || 1) / 100;

// Validate EVM address format
function isValidEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

export default function LotteryPage() {
  const { authenticated, login } = useAuth();
  const { ready: privyReady, user, connectWallet } = usePrivy();
  const { toast } = useToast();
  const { data: tokens = [], isLoading: loadingTokens } = useTokensQuery();
  const searchParams = useSearchParams();

  // Get organization referral from query params (passed from checkout page)
  const orgReferral = searchParams.get("orgReferral") || undefined;
  const organizationId = searchParams.get("organizationId") || undefined;

  const [numTickets, setNumTickets] = useState<string>("1");
  const [fromSel, setFromSel] = useState<TokenSelection | undefined>(undefined);
  const [userAddress, setUserAddress] = useState<string>("");
  const [recipientAddress, setRecipientAddress] = useState<string>(""); // EVM address where tickets will be minted
  const [useManualAddress, setUseManualAddress] = useState<boolean>(false); // Track if user wants to override connected wallet
  const [refundAddress, setRefundAddress] = useState<string>("");
  const [refundAddressError, setRefundAddressError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [status, setStatus] = useState<"IDLE" | "PROCESSING" | "SUCCESS" | "ERROR" | "REFUNDED">("IDLE");
  const [showInfo, setShowInfo] = useState(false);

  // Two-step flow: Step 1 = tickets & recipient, Step 2 = payment
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);

  // Recovery state
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryWallets, setRecoveryWallets] = useState<Array<{
    userAddress: string;
    companionAddress: string;
    balance: string;
    createdAt: number;
  }>>([]);
  const [recovering, setRecovering] = useState(false);

  // Execution progress tracking
  const [executionStep, setExecutionStep] = useState<"quote" | "deposit" | "polling" | "executing" | "complete" | null>(null);
  const [companionAddress, setCompanionAddress] = useState<string>("");
  const [depositAddress, setDepositAddress] = useState<string>("");
  const [depositData, setDepositData] = useState<{ minAmountInFormatted?: string } | null>(null);
  const [pollingAttempts, setPollingAttempts] = useState(0);
  const [txHash, setTxHash] = useState<string>("");

  // Companion wallet balance tracking
  const [companionBalance, setCompanionBalance] = useState<string>("0");
  const [depositReceived, setDepositReceived] = useState(false);
  const [ticketsMinted, setTicketsMinted] = useState<number>(0);

  // Find ETH on Base as the destination token
  const ethOnBase = useMemo(() => {
    return tokens.find(t =>
      t.symbol === "ETH" &&
      String(t.chain).toLowerCase() === "base"
    );
  }, [tokens]);

  // Get cached data from Zustand
  const cachedPaymentToken = useCompanionWalletStore((s) => s.selectedPaymentToken);
  const setSelectedPaymentToken = useCompanionWalletStore((s) => s.setSelectedPaymentToken);
  const cachedPurchaseState = useCompanionWalletStore((s) => s.lotteryPurchaseState);
  const setLotteryPurchaseState = useCompanionWalletStore((s) => s.setLotteryPurchaseState);

  // Restore cached token on mount when tokens are loaded (run FIRST, before default initialization)
  useEffect(() => {
    // Only restore if we have a cached token, no current selection, and tokens are loaded
    if (cachedPaymentToken && fromSel === undefined && tokens.length > 0) {
      console.log("[Lottery Page] Attempting to restore cached token:", cachedPaymentToken);
      // Restore cached token selection
      const restoredToken = findTokenBySelection(tokens, cachedPaymentToken);
      if (restoredToken) {
        console.log("[Lottery Page] ✓ Found cached token in tokens list, restoring...");
        setFromSel(cachedPaymentToken);
        console.log("[Lottery Page] ✓ Restored cached payment token to TokenCombobox");
        return; // Exit early to prevent default initialization
      } else {
        console.log("[Lottery Page] Cached token not found in tokens list, clearing cache");
        setSelectedPaymentToken(null);
      }
    }
  }, [tokens.length, cachedPaymentToken]); // Depend on both to restore when either changes

  // Cache selected token when it changes (including when user selects via TokenCombobox)
  useEffect(() => {
    if (fromSel) {
      setSelectedPaymentToken(fromSel);
      console.log("[Lottery Page] ✓ Cached payment token:", fromSel);
    } else if (fromSel === undefined || fromSel === null) {
      // Don't clear cache if it's just initial undefined state
      // Only clear if explicitly set to null
    }
  }, [fromSel, setSelectedPaymentToken]);

  // Restore cached purchase state on mount
  useEffect(() => {
    if (cachedPurchaseState && !companionAddress && !depositAddress) {
      console.log("[Lottery Page] Restoring cached purchase state:", cachedPurchaseState);

      if (cachedPurchaseState.companionAddress) {
        setCompanionAddress(cachedPurchaseState.companionAddress);
      }
      if (cachedPurchaseState.depositAddress) {
        setDepositAddress(cachedPurchaseState.depositAddress);
      }
      if (cachedPurchaseState.depositData) {
        setDepositData(cachedPurchaseState.depositData);
      }
      if (cachedPurchaseState.executionStep) {
        setExecutionStep(cachedPurchaseState.executionStep);
      }
      if (cachedPurchaseState.numTickets) {
        setNumTickets(cachedPurchaseState.numTickets);
      }
      if (cachedPurchaseState.recipientAddress) {
        setRecipientAddress(cachedPurchaseState.recipientAddress);
      }

      console.log("[Lottery Page] ✓ Restored cached purchase state");
    }
  }, []); // Only run once on mount

  // Cache purchase state when it changes
  useEffect(() => {
    if (companionAddress || depositAddress || executionStep) {
      setLotteryPurchaseState({
        companionAddress,
        depositAddress,
        depositData,
        executionStep,
        numTickets,
        recipientAddress,
      });
    }
  }, [companionAddress, depositAddress, depositData, executionStep, numTickets, recipientAddress, setLotteryPurchaseState]);

  const selectedFrom = useMemo(() =>
    findTokenBySelection(tokens, fromSel),
    [tokens, fromSel]
  );

  // Calculate costs in USD
  const totalTicketCostUSD = useMemo(() => {
    const tickets = parseFloat(numTickets) || 0;
    return tickets * TICKET_PRICE_USD;
  }, [numTickets]);

  const totalBridgeFeeUSD = useMemo(() => {
    // Bridge fee is per transaction, not per ticket
    return BRIDGE_FEE_USD;
  }, []);

  const totalCostUSD = useMemo(() => {
    // Include gas fee buffer for Rhinestone companion wallet
    return totalTicketCostUSD + totalBridgeFeeUSD + GAS_FEE_BUFFER_USD;
  }, [totalTicketCostUSD, totalBridgeFeeUSD]);

  // Calculate total cost in ETH (on Base) - includes gas fee buffer
  const totalCostETH = useMemo(() => {
    if (!ethOnBase) return null;
    const ethPrice = typeof ethOnBase.price === "number" ? ethOnBase.price : null;
    if (ethPrice && ethPrice > 0) {
      return (totalCostUSD / ethPrice).toFixed(6);
    }
    return null;
  }, [ethOnBase, totalCostUSD]);

  // Calculate ETH amount for tickets only (without gas buffer) - for display
  const ticketCostETH = useMemo(() => {
    if (!ethOnBase) return null;
    const ethPrice = typeof ethOnBase.price === "number" ? ethOnBase.price : null;
    if (ethPrice && ethPrice > 0) {
      const ticketCostUSD = totalTicketCostUSD + totalBridgeFeeUSD;
      return (ticketCostUSD / ethPrice).toFixed(6);
    }
    return null;
  }, [ethOnBase, totalTicketCostUSD, totalBridgeFeeUSD]);

  // Calculate amount needed in fromToken (supports ANY chain)
  const amountNeeded = useMemo(() => {
    if (!selectedFrom || !totalCostUSD) return null;

    const fromPrice = typeof selectedFrom.price === "number" ? selectedFrom.price : null;

    if (fromPrice && fromPrice > 0) {
      // Calculate: USD cost / fromToken price = fromToken amount needed
      const fromAmount = totalCostUSD / fromPrice;
      // Add lottery fee (default 1%) + 1% buffer for slippage = 2% total
      return (fromAmount * (1 + LOTTERY_FEE_PERCENT + 0.01)).toFixed(6);
    }

    return null;
  }, [selectedFrom, totalCostUSD]);

  // Check if payment is cross-chain
  const isCrossChain = useMemo(() => {
    if (!selectedFrom || !ethOnBase) return false;
    return String(selectedFrom.chain).toLowerCase() !== String(ethOnBase.chain).toLowerCase();
  }, [selectedFrom, ethOnBase]);

  // Check if origin chain is non-EVM (requires recipient address input)
  const isNonEvmChain = useMemo(() => {
    if (!selectedFrom) return false;
    return !isEvmChainId(selectedFrom.chain);
  }, [selectedFrom]);

  // Determine recipient address (where tickets will be minted)
  const finalRecipientAddress = useMemo(() => {
    // If user manually entered an address (override), use it
    if (recipientAddress && isValidEvmAddress(recipientAddress)) {
      return recipientAddress;
    }
    // For EVM chains, use connected wallet address if no manual override
    if (!isNonEvmChain && userAddress && !useManualAddress) {
      return userAddress;
    }
    // For non-EVM chains, use manually entered recipient address
    if (isNonEvmChain && recipientAddress && isValidEvmAddress(recipientAddress)) {
      return recipientAddress;
    }
    return null;
  }, [isNonEvmChain, userAddress, recipientAddress, useManualAddress]);

  // Initialize default token selection - only if no cached token and no current selection
  useEffect(() => {
    // Only set default if no cached token exists and no current selection
    if (!cachedPaymentToken && !fromSel && tokens.length > 0) {
      // Prefer ETH on Ethereum (most common), but allow any chain
      const preferred = tokens.find(t =>
        t.symbol === "ETH" &&
        String(t.chain).toLowerCase() === "ethereum"
      ) || tokens.find(t =>
        (t.symbol === "USDC" || t.symbol === "USDT") &&
        String(t.chain).toLowerCase() === "base"
      ) || tokens.find(t => t.symbol === "USDT") || tokens[0];

      if (preferred) {
        setFromSel({ symbol: preferred.symbol, chain: preferred.chain });
      }
    }
  }, [tokens.length, cachedPaymentToken, fromSel]); // Check cachedPaymentToken to avoid overriding

  // Get user's wallet address
  useEffect(() => {
    if (user?.wallet?.address) {
      const addr = user.wallet.address;
      setUserAddress(addr);
      // Auto-fill recipient address for EVM chains if not manually overridden
      if (!isNonEvmChain && isValidEvmAddress(addr) && !useManualAddress) {
        setRecipientAddress(addr);
      }
    } else {
      // Wallet disconnected
      setUserAddress("");
    }
  }, [user, isNonEvmChain, useManualAddress]);

  // Poll companion wallet balance when waiting for deposit
  useEffect(() => {
    if (!companionAddress || !depositAddress || executionStep === "complete") return;

    let cancelled = false;
    const pollInterval = 5000; // Poll every 5 seconds

    const checkBalance = async () => {
      try {
        const balance = await getCompanionBalanceFromApi(companionAddress);
        if (!cancelled) {
          setCompanionBalance(balance.eth);
          const hasBalance = parseFloat(balance.eth) > 0.0001; // Small threshold
          if (hasBalance && !depositReceived) {
            setDepositReceived(true);
            console.log("[Lottery Page] ✓ Deposit received! Balance:", balance.eth);
          }
        }
      } catch (error) {
        console.error("[Lottery Page] Balance check error:", error);
      }
    };

    // Initial check
    checkBalance();

    // Poll while waiting for deposit
    const interval = setInterval(checkBalance, pollInterval);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [companionAddress, depositAddress, executionStep, depositReceived]);

  // Calculate remaining deposit needed
  const remainingDeposit = useMemo(() => {
    if (!totalCostETH || !companionBalance) return null;
    const required = parseFloat(totalCostETH);
    const current = parseFloat(companionBalance);
    const remaining = required - current;
    return remaining > 0 ? remaining.toFixed(6) : "0";
  }, [totalCostETH, companionBalance]);

  // Calculate remaining in fromToken
  const remainingInFromToken = useMemo(() => {
    if (!selectedFrom || !remainingDeposit || parseFloat(remainingDeposit) <= 0) return null;
    const fromPrice = typeof selectedFrom.price === "number" ? selectedFrom.price : null;
    const ethPrice = ethOnBase?.price;
    if (fromPrice && fromPrice > 0 && ethPrice && typeof ethPrice === "number") {
      // Convert remaining ETH to USD, then to fromToken
      const remainingUSD = parseFloat(remainingDeposit) * ethPrice;
      const remainingFrom = remainingUSD / fromPrice;
      // Add 2% buffer for slippage
      return (remainingFrom * 1.02).toFixed(6);
    }
    return null;
  }, [selectedFrom, remainingDeposit, ethOnBase]);

  const handlePurchase = async () => {
    if (!selectedFrom || !ethOnBase || !numTickets || parseFloat(numTickets) <= 0 || !amountNeeded) {
      toast({
        variant: "destructive",
        title: "Invalid input",
        description: "Please select a payment token and enter number of tickets."
      });
      return;
    }

    // For EVM chains, require wallet connection
    if (!isNonEvmChain && !userAddress) {
      toast({
        variant: "destructive",
        title: "Wallet required",
        description: "Please connect your wallet to purchase tickets."
      });
      return;
    }

    // For non-EVM chains, require recipient address
    if (isNonEvmChain && (!recipientAddress || !isValidEvmAddress(recipientAddress))) {
      toast({
        variant: "destructive",
        title: "Recipient address required",
        description: "Please enter a valid EVM wallet address where your tickets will be minted."
      });
      return;
    }

    if (!finalRecipientAddress) {
      toast({
        variant: "destructive",
        title: "Recipient address required",
        description: "Please provide a wallet address where tickets will be sent."
      });
      return;
    }

    setPreparing(true);
    setStatus("PROCESSING");
    setExecutionStep("quote");
    setCompanionAddress("");
    setDepositAddress("");
    setDepositData(null);
    setPollingAttempts(0);
    setTxHash("");

    try {
      console.log("[Lottery Page] Starting purchase flow...");

      // Step 1: Get companion wallet from server (keyed by recipient address)
      setExecutionStep("quote");
      console.log("[Lottery Page] Getting companion wallet for recipient:", finalRecipientAddress);

      // Pass numTickets and totalCostETH for background processing
      // Even if user closes browser, cron job will complete the purchase
      const companionWallet = await getCompanionWalletForRecipient(finalRecipientAddress, {
        numTickets: parseFloat(numTickets),
        totalCostETH: totalCostETH || undefined,
        orgReferral: orgReferral,
      });

      setCompanionAddress(companionWallet.companionAddress);

      // Cache companion wallet in Zustand store for UI display
      if (finalRecipientAddress && companionWallet.companionAddress) {
        useCompanionWalletStore.getState().setCompanionWallet(
          finalRecipientAddress,
          companionWallet.companionAddress
        );
        console.log("[Lottery Page] ✓ Companion wallet cached in Zustand store");
      }

      console.log("[Lottery Page] =========================================");
      console.log("[Lottery Page] COMPANION WALLET ADDRESS:", companionWallet.companionAddress);
      console.log("[Lottery Page] ✓ Signer key stored securely on server");
      console.log("[Lottery Page] ✓ Keyed by recipient:", finalRecipientAddress);
      console.log("[Lottery Page] ✓ Background processing enabled (cron job)");
      console.log("[Lottery Page] Is new wallet:", companionWallet.isNew);
      console.log("[Lottery Page] This Rhinestone companion wallet will:");
      console.log("[Lottery Page] 1. Receive ETH from NEAR Intents on Base");
      console.log("[Lottery Page] 2. Call ticketAutomator contract with calldata");
      console.log("[Lottery Page] 3. If user leaves, cron job will complete purchase");
      console.log("[Lottery Page] =========================================");

      // Step 2: Get deposit address from quote
      setExecutionStep("deposit");
      console.log("[Lottery Page] Getting deposit address from quote...");

      const response = await fetch("/api/lottery/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromToken: {
            tokenId: selectedFrom.tokenId || selectedFrom.address,
            decimals: selectedFrom.decimals,
            chain: selectedFrom.chain,
          },
          toToken: {
            tokenId: ethOnBase.tokenId || ethOnBase.address,
            decimals: ethOnBase.decimals,
            chain: ethOnBase.chain,
          },
          amountNeeded: amountNeeded,
          totalCostETH: totalCostETH,
          companionAddress: companionWallet.companionAddress,
          userAddress: finalRecipientAddress, // Use recipient as the key
          refundAddress: refundAddress.trim(), // User-provided refund address
          orgReferral: orgReferral, // Pass organization referral code
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to get deposit address");
      }

      const depositDataResponse = await response.json();
      const depositAddr = depositDataResponse?.depositAddress || "";
      const minAmount = depositDataResponse?.minAmountInFormatted || amountNeeded;
      setDepositAddress(depositAddr);
      setDepositData(depositDataResponse);

      console.log("[Lottery Page] ✓ Deposit address created:", depositAddr);
      console.log("[Lottery Page] Deposit data:", depositData);

      toast({
        title: "Deposit address ready",
        description: `Send ${minAmount} ${selectedFrom.symbol} to the deposit address. We'll automatically detect when funds arrive.`
      });

      // Step 3: Poll for companion wallet balance
      setExecutionStep("polling");
      console.log("[Lottery Page] Starting balance polling...");

      const pollResult = await pollCompanionBalance(
        companionWallet.companionAddress,
        totalCostETH || "0",
        30, // max attempts
        3000 // 3 second intervals
      );

      if (!pollResult.success) {
        throw new Error(`Insufficient balance after ${pollResult.attempts} attempts. Please ensure funds were sent.`);
      }

      console.log("[Lottery Page] ✓ Companion wallet funded! Balance:", pollResult.balance);
      setPollingAttempts(pollResult.attempts);

      // Step 4: Execute contract call via server API
      setExecutionStep("executing");
      console.log("[Lottery Page] Executing contract call via server...");

      // Calculate ticket cost ETH (without gas buffer) - this is what we send to contract
      // Gas buffer stays in companion wallet for transaction fees
      const ticketCostETHValue = ticketCostETH || totalCostETH || "0";
      console.log("[Lottery Page] Contract call amount:", {
        ticketCostETH: ticketCostETHValue,
        totalCostETH: totalCostETH,
        note: "Gas buffer stays in companion wallet for fees",
      });

      // Encode the contract call
      const calldata = encodeTicketPurchase(finalRecipientAddress, parseFloat(numTickets));
      const ethAmountWei = BigInt(Math.floor(parseFloat(ticketCostETHValue) * 1e18)).toString();

      const result = await executeCompanionTransaction({
        recipientAddress: finalRecipientAddress,
        to: TICKET_AUTOMATOR_CONTRACT,
        value: ethAmountWei,
        data: calldata,
        minRequired: totalCostETH || "0.0035", // Pass min required for refund logic
      });

      // Check if transaction was refunded due to insufficient funds
      if (result.status === "refunded") {
        setTxHash(result.refundTxHash || "");
        setExecutionStep("complete");
        console.log("[Lottery Page] ⚠️ REFUNDED - Insufficient balance");
        console.log("[Lottery Page] Refund TX:", result.refundTxHash);
        console.log("[Lottery Page] Refund amount:", result.refundAmount, "ETH");

        toast({
          variant: "destructive",
          title: "Insufficient funds - Refunded",
          description: `Balance was too low. ${result.refundAmount} ETH has been refunded to your wallet.`
        });

        setStatus("REFUNDED");
        setLotteryPurchaseState(null);
        return;
      }

      setTxHash(result.txHash || "");
      setExecutionStep("complete");
      console.log("[Lottery Page] ✓ Purchase complete! TX:", result.txHash);

      toast({
        title: "Tickets purchased!",
        description: `Successfully purchased ${numTickets} ticket(s). NFTs will be minted to ${finalRecipientAddress.slice(0, 6)}...${finalRecipientAddress.slice(-4)}`
      });

      setStatus("SUCCESS");
      // Clear purchase state on success
      setLotteryPurchaseState(null);

      // Clear companion wallet from server (it's now empty or has dust)
      clearCompanionWallet(finalRecipientAddress).then((clearResult) => {
        if (clearResult.deleted) {
          console.log("[Lottery Page] ✓ Companion wallet cleared from server");
        }
      }).catch((err) => {
        console.warn("[Lottery Page] Failed to clear companion wallet (non-critical):", err);
      });
    } catch (error: any) {
      console.error("Purchase error:", error);
      toast({
        variant: "destructive",
        title: "Purchase failed",
        description: error?.message || "Failed to create purchase transaction."
      });
      setStatus("ERROR");
      // Keep executionStep set so user can retry - state is already cached
    } finally {
      setPreparing(false);
    }
  };

  // Retry purchase - check if companion wallet is already funded and skip to execution
  const handleRetryPurchase = async () => {
    if (!companionAddress || !selectedFrom || !ethOnBase || !numTickets) {
      toast({
        variant: "destructive",
        title: "Cannot retry",
        description: "Missing required information. Please start a new purchase."
      });
      return;
    }

    const finalRecipientAddress = isNonEvmChain ? recipientAddress : (userAddress || "");
    if (!finalRecipientAddress) {
      toast({
        variant: "destructive",
        title: "Recipient address required",
        description: "Please provide a wallet address where tickets will be sent."
      });
      return;
    }

    setPreparing(true);
    setStatus("PROCESSING");

    try {
      // Check if companion wallet already has sufficient balance
      const balanceCheck = await getCompanionBalanceFromApi(companionAddress);
      const requiredETH = totalCostETH || "0";
      const hasSufficientBalance = parseFloat(balanceCheck.eth) >= parseFloat(requiredETH);

      console.log("[Lottery Page] Retry - Balance check:", {
        balance: balanceCheck.eth,
        required: requiredETH,
        sufficient: hasSufficientBalance,
      });

      if (!hasSufficientBalance) {
        toast({
          variant: "destructive",
          title: "Insufficient balance",
          description: `Companion wallet has ${balanceCheck.eth} ETH but needs ${requiredETH} ETH. Please complete the deposit first.`
        });
        setPreparing(false);
        return;
      }

      // Skip to execution - companion wallet is already funded
      console.log("[Lottery Page] ✓ Companion wallet already funded, skipping to execution");
      setExecutionStep("executing");

      const ticketCostETHValue = ticketCostETH || totalCostETH || "0";
      console.log("[Lottery Page] Retry - Executing contract call with amount:", ticketCostETHValue);

      // Encode the contract call
      const calldata = encodeTicketPurchase(finalRecipientAddress, parseFloat(numTickets));
      const ethAmountWei = BigInt(Math.floor(parseFloat(ticketCostETHValue) * 1e18)).toString();

      const result = await executeCompanionTransaction({
        recipientAddress: finalRecipientAddress,
        to: TICKET_AUTOMATOR_CONTRACT,
        value: ethAmountWei,
        data: calldata,
        minRequired: totalCostETH || "0.0035",
      });

      // Check if transaction was refunded due to insufficient funds
      if (result.status === "refunded") {
        setTxHash(result.refundTxHash || "");
        setExecutionStep("complete");
        console.log("[Lottery Page] ⚠️ REFUNDED - Insufficient balance");

        toast({
          variant: "destructive",
          title: "Insufficient funds - Refunded",
          description: `Balance was too low. ${result.refundAmount} ETH has been refunded to your wallet.`
        });

        setStatus("REFUNDED");
        setLotteryPurchaseState(null);
        return;
      }

      setTxHash(result.txHash || "");
      setExecutionStep("complete");
      console.log("[Lottery Page] ✓ Retry purchase complete! TX:", result.txHash);

      toast({
        title: "Tickets purchased!",
        description: `Successfully purchased ${numTickets} ticket(s). NFTs will be minted to ${finalRecipientAddress.slice(0, 6)}...${finalRecipientAddress.slice(-4)}`
      });

      setStatus("SUCCESS");
      // Clear purchase state on success
      setLotteryPurchaseState(null);

      // Clear companion wallet from server (non-blocking)
      clearCompanionWallet(finalRecipientAddress).then((clearResult) => {
        if (clearResult.deleted) {
          console.log("[Lottery Page] ✓ Companion wallet cleared from server");
        }
      }).catch((err) => {
        console.warn("[Lottery Page] Failed to clear companion wallet (non-critical):", err);
      });
    } catch (error: any) {
      console.error("Retry purchase error:", error);
      toast({
        variant: "destructive",
        title: "Retry failed",
        description: error?.message || "Failed to execute purchase. Please try again."
      });
      setStatus("ERROR");
      // Keep state cached for another retry attempt
    } finally {
      setPreparing(false);
    }
  };

  const handleConnectWallet = async () => {
    if (!privyReady) return;
    try {
      await connectWallet();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Connection failed",
        description: "Could not connect wallet. Please try again."
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-100/50 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-100/50 rounded-full blur-3xl animate-pulse delay-700"></div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12 relative z-10">
        {/* Header - Smaller */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 mb-3">
            <Zap className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-sm font-semibold text-blue-600">Powered by Loofta Pay</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Internet Token Lottery
            </span>
          </h1>
          <p className="text-base text-gray-600 max-w-xl mx-auto">
            Purchase lottery tickets with any token. Each ticket is represented by an IFT NFT on Base.
          </p>
        </motion.div>

        {/* Main Card - Compact Left/Right Layout */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl shadow-lg border border-gray-200 p-5 mb-6 max-w-4xl mx-auto"
        >
          {/* Execution Progress - Full Width */}
          {executionStep && (
            <div className="mb-5 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                <span className="text-sm font-semibold text-gray-900">Purchase Progress</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                <div className={`flex items-center gap-1 ${executionStep === "quote" ? "text-blue-600 font-medium" : ["deposit", "polling", "executing", "complete"].includes(executionStep) ? "text-green-600" : ""}`}>
                  {["deposit", "polling", "executing", "complete"].includes(executionStep) ? "✓" : executionStep === "quote" ? "⟳" : ""} Quote
                </div>
                {["deposit", "polling", "executing", "complete"].includes(executionStep) ? (
                  <div className={`flex items-center gap-1 ${executionStep === "deposit" ? "text-blue-600 font-medium" : "text-green-600"}`}>
                    {executionStep !== "deposit" ? "✓" : "⟳"} Deposit
                  </div>
                ) : null}
                {["polling", "executing", "complete"].includes(executionStep) ? (
                  <div className={`flex items-center gap-1 ${executionStep === "polling" ? "text-blue-600 font-medium" : "text-green-600"}`}>
                    {executionStep !== "polling" ? "✓" : "⟳"} Waiting ({pollingAttempts})
                  </div>
                ) : null}
                {["executing", "complete"].includes(executionStep) ? (
                  <div className={`flex items-center gap-1 ${executionStep === "executing" ? "text-blue-600 font-medium" : "text-green-600"}`}>
                    {executionStep === "complete" ? "✓" : "⟳"} Executing
                  </div>
                ) : null}
                {executionStep === "complete" && txHash && (
                  <div className="flex items-center gap-1 text-green-600 font-medium">
                    ✓ Complete
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Deposit Address & Status */}
          {depositAddress && selectedFrom && executionStep !== "complete" && (
            <div className="mb-5 p-4 rounded-lg border border-gray-200 bg-gray-50">
              {/* Status indicator */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${parseFloat(remainingDeposit || "0") <= 0 ? "bg-green-500" : "bg-blue-500 animate-pulse"
                    }`}></div>
                  <span className="text-sm text-gray-700">
                    {parseFloat(companionBalance) > 0
                      ? `Balance: ${companionBalance} ETH`
                      : "Waiting for deposit..."}
                  </span>
                </div>
                {parseFloat(remainingDeposit || "0") <= 0 ? (
                  <span className="text-sm font-medium text-green-600">✓ Ready to purchase</span>
                ) : parseFloat(companionBalance) > 0 ? (
                  <span className="text-sm text-gray-500">Need ~{remainingDeposit} more ETH</span>
                ) : null}
              </div>

              {/* Deposit address - always show */}
              <div className="mb-2">
                <div className="text-sm text-gray-600 mb-1">
                  {parseFloat(companionBalance) > 0 && parseFloat(remainingDeposit || "0") > 0 ? (
                    <>Send ~{remainingInFromToken} more {selectedFrom.symbol} to:</>
                  ) : parseFloat(remainingDeposit || "0") <= 0 ? (
                    <>Deposit complete - {selectedFrom.symbol} address:</>
                  ) : (
                    <>Send ~{amountNeeded} {selectedFrom.symbol} to:</>
                  )}
                </div>
                <div className="relative">
                  <div className="rounded-lg border border-gray-300 bg-white pl-3 pr-16 py-2 font-mono text-sm break-all text-gray-900">
                    {depositAddress}
                  </div>
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(depositAddress);
                        toast({ title: "Copied!", description: "Address copied to clipboard." });
                      } catch {
                        toast({ variant: "destructive", title: "Copy failed" });
                      }
                    }}
                  >
                    Copy
                  </button>
                </div>
              </div>

              {/* Warning */}
              <p className="text-sm text-gray-500">
                ⚠️ Only send {selectedFrom.symbol} from {selectedFrom.chain}. Other tokens or networks will be lost.
              </p>
            </div>
          )}

          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className={`flex items-center gap-2 ${currentStep === 1 ? "text-blue-600" : "text-green-600"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${currentStep === 1 ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"
                }`}>
                {currentStep > 1 ? "✓" : "1"}
              </div>
              <span className="text-sm font-medium">Tickets & Recipient</span>
            </div>
            <div className="w-8 h-0.5 bg-gray-200"></div>
            <div className={`flex items-center gap-2 ${currentStep === 2 ? "text-blue-600" : "text-gray-400"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${currentStep === 2 ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"
                }`}>
                2
              </div>
              <span className="text-sm font-medium">Payment</span>
            </div>
          </div>

          {/* STEP 1: Tickets & Recipient */}
          {currentStep === 1 && (
            <div className="max-w-lg mx-auto space-y-4">
              {/* Ticket Selection */}
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                <label className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Ticket className="w-4 h-4 text-blue-600" />
                  How many tickets?
                </label>
                <div className="flex items-center gap-3 mb-3">
                  <Input
                    type="number"
                    min="1"
                    max="1000"
                    value={numTickets}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || (parseFloat(val) > 0 && parseFloat(val) <= 1000)) {
                        setNumTickets(val);
                      }
                    }}
                    placeholder="1"
                    className="w-24 text-2xl font-bold text-center h-12 border-2 border-gray-200 focus:border-blue-500"
                  />
                  <Button
                    variant="outline"
                    onClick={() => setNumTickets("1000")}
                    className="h-12 px-4"
                  >
                    MAX
                  </Button>
                  <span className="text-sm text-gray-500">× ${TICKET_PRICE_USD.toFixed(2)}</span>
                </div>
                <div className="text-sm text-gray-600">
                  Total: <span className="font-bold text-gray-900">${totalTicketCostUSD.toFixed(2)} USD</span>
                </div>
              </div>

              {/* Recipient Address */}
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                <label className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-blue-600" />
                  Your Base Wallet Address
                </label>
                <p className="text-sm text-gray-500 mb-3">
                  Where you'll receive your lottery tickets (NFTs) and prizes if you win! 🎉
                </p>
                {!isNonEvmChain && userAddress && !useManualAddress ? (
                  // Connected wallet
                  <div className="space-y-2">
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                      <div className="flex items-center gap-2 text-green-800 mb-1">
                        <div className="w-2 h-2 rounded-full bg-green-500"></div>
                        <span className="text-sm font-medium">Connected Wallet</span>
                      </div>
                      <div className="font-mono text-sm text-gray-900 truncate">
                        {userAddress}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        console.log("[Lottery] Use different address clicked");
                        setUseManualAddress(true);
                        setRecipientAddress("");
                      }}
                      className="text-sm text-blue-600 hover:text-blue-700 hover:underline cursor-pointer font-medium transition-colors py-1 px-2 -ml-2 rounded hover:bg-blue-50 relative z-10"
                      style={{ pointerEvents: 'auto' }}
                    >
                      Use different address
                    </button>
                  </div>
                ) : (
                  // Manual input
                  <div className="space-y-2">
                    <Input
                      type="text"
                      value={recipientAddress}
                      onChange={(e) => {
                        setRecipientAddress(e.target.value.trim());
                        if (e.target.value.trim()) {
                          setUseManualAddress(true);
                        }
                      }}
                      placeholder="0x..."
                      className="h-11 font-mono text-sm border-2 border-gray-200 focus:border-blue-500"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    {recipientAddress && !isValidEvmAddress(recipientAddress) && (
                      <p className="text-sm text-red-600">Invalid address format</p>
                    )}
                    {!isNonEvmChain && userAddress && useManualAddress && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log("[Lottery] Use connected wallet clicked");
                          setUseManualAddress(false);
                          setRecipientAddress("");
                        }}
                        className="text-sm text-blue-600 hover:text-blue-700 hover:underline cursor-pointer font-medium transition-colors py-1 px-2 -ml-2 rounded hover:bg-blue-50 relative z-10"
                        style={{ pointerEvents: 'auto' }}
                      >
                        ← Use connected wallet instead
                      </button>
                    )}
                    {!isNonEvmChain && !userAddress && (
                      <p className="text-sm text-gray-500">
                        or <button onClick={handleConnectWallet} className="text-blue-600 hover:text-blue-700 font-medium">connect wallet</button>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Continue Button */}
              <Button
                onClick={() => setCurrentStep(2)}
                disabled={!numTickets || parseFloat(numTickets) <= 0 || !finalRecipientAddress}
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 text-base font-semibold"
              >
                Continue to Payment →
              </Button>
            </div>
          )}

          {/* STEP 2: Payment */}
          {currentStep === 2 && (
            <div className="grid md:grid-cols-2 gap-6">
              {/* LEFT: Payment Selection */}
              <div className="space-y-4">
                {/* Back Button */}
                <button
                  onClick={() => setCurrentStep(1)}
                  className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                >
                  ← Back to tickets
                </button>

                {/* Order Summary Mini */}
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Ticket className="w-4 h-4 text-blue-600" />
                      <span className="font-medium text-gray-900">{numTickets} ticket{parseFloat(numTickets) !== 1 ? 's' : ''}</span>
                    </div>
                    <span className="text-sm text-gray-600">→ {finalRecipientAddress?.slice(0, 6)}...{finalRecipientAddress?.slice(-4)}</span>
                  </div>
                </div>

                {/* Payment Token Selection */}
                <div>
                  <label className="text-sm font-semibold text-gray-900 mb-2 block">
                    Pay With (any token, any chain)
                  </label>
                  {loadingTokens ? (
                    <Skeleton className="h-11 w-full" />
                  ) : (
                    <TokenCombobox
                      tokens={tokens}
                      value={fromSel}
                      onChange={(token) => {
                        setFromSel(token);
                        if (token) {
                          setSelectedPaymentToken(token);
                          console.log("[Lottery Page] ✓ Payment token selected and cached:", token);
                        }
                      }}
                      placeholder="Select payment token"
                      onQuery={async (q) =>
                        tokens.filter(t =>
                          t.symbol.toLowerCase().includes((q || '').toLowerCase())
                        )
                      }
                      className="bg-white text-gray-900 border-2 border-gray-200 hover:border-blue-300 w-full h-11"
                    />
                  )}
                  <p className="mt-1 text-sm text-gray-500">
                    We'll automatically convert to ETH on Base
                  </p>
                </div>

                {/* Refund Address Input */}
                {selectedFrom && (
                  <div>
                    <label className="text-sm font-semibold text-gray-900 mb-2 block">
                      Refund Address ({selectedFrom.chain.toUpperCase()}) *
                    </label>
                    <Input
                      type="text"
                      value={refundAddress}
                      onChange={(e) => {
                        setRefundAddress(e.target.value);
                        setRefundAddressError(null);
                      }}
                      placeholder={`Enter your ${selectedFrom.chain.toUpperCase()} address for refunds`}
                      className={`h-11 font-mono text-sm border-2 ${refundAddressError ? 'border-red-300' : 'border-gray-200'} focus:border-blue-500`}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    {refundAddressError && (
                      <p className="mt-1 text-sm text-red-600">{refundAddressError}</p>
                    )}
                    <p className="mt-1 text-sm text-gray-500">
                      Funds will be refunded to this address if payment fails or expires
                    </p>
                  </div>
                )}
              </div>

              {/* RIGHT SIDE: Payment Summary */}
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-blue-600" />
                    Order Summary
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-gray-600">
                      <span>Tickets ({numTickets})</span>
                      <span className="font-medium">${totalTicketCostUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-500">
                      <span>Purchase fees</span>
                      <span>${(BRIDGE_FEE_USD + GAS_FEE_BUFFER_USD).toFixed(2)}</span>
                    </div>
                    <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
                      <span className="font-semibold text-gray-900">Total</span>
                      <span className="font-bold text-gray-900">${totalCostUSD.toFixed(2)} USD</span>
                    </div>
                  </div>

                  {selectedFrom && amountNeeded && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm text-gray-600">You'll pay (approx.)</span>
                        <span className="text-lg font-bold text-blue-600">
                          ~{amountNeeded} {selectedFrom.symbol}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400">
                        Final amount calculated when you proceed
                      </p>
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-gray-300 space-y-2">
                    {/* Retry button - show if error occurred and companion wallet exists */}
                    {status === "ERROR" && companionAddress && executionStep && (
                      <Button
                        onClick={handleRetryPurchase}
                        disabled={preparing}
                        variant="outline"
                        className="w-full h-11 border-2 border-blue-500 text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {preparing ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Retrying...
                          </>
                        ) : (
                          <>
                            <Zap className="w-4 h-4 mr-2" />
                            Retry Purchase (Skip Funding)
                          </>
                        )}
                      </Button>
                    )}

                    <Button
                      onClick={handlePurchase}
                      disabled={preparing || !selectedFrom || !numTickets || parseFloat(numTickets) <= 0 || !finalRecipientAddress || !refundAddress.trim()}
                      className="w-full h-11 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50"
                    >
                      {preparing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Ticket className="w-4 h-4 mr-2" />
                          {status === "ERROR" && companionAddress ? "Start New Purchase" : "Purchase Tickets"}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {status === "SUCCESS" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-5 p-6 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-300 rounded-2xl"
            >
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                  <Trophy className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-green-800 mb-2">
                  🎉 Tickets Purchased Successfully!
                </h3>
                <p className="text-sm text-green-700 mb-4">
                  Your {numTickets} IFT NFT ticket{parseFloat(numTickets) > 1 ? 's have' : ' has'} been minted to your wallet.
                </p>
                <div className="bg-white/60 rounded-lg p-3 mb-4">
                  <div className="text-sm text-gray-600 mb-1">Recipient Address</div>
                  <div className="font-mono text-sm text-gray-900 break-all">
                    {finalRecipientAddress}
                  </div>
                </div>
                {txHash && (
                  <a
                    href={`https://basescan.org/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    View on Basescan →
                  </a>
                )}
                <div className="mt-4 pt-4 border-t border-green-200">
                  <Button
                    onClick={() => {
                      setStatus("IDLE");
                      setExecutionStep(null);
                      setDepositAddress("");
                      setCompanionAddress("");
                      setTxHash("");
                      setDepositReceived(false);
                      setCompanionBalance("0");
                      setCurrentStep(1);
                    }}
                    variant="outline"
                    className="border-green-300 text-green-700 hover:bg-green-100"
                  >
                    <Ticket className="w-4 h-4 mr-2" />
                    Buy More Tickets
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {status === "REFUNDED" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-5 p-6 bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-300 rounded-2xl"
            >
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mb-4">
                  <ArrowLeft className="w-8 h-8 text-amber-600" />
                </div>
                <h3 className="text-xl font-bold text-amber-800 mb-2">
                  ⚠️ Funds Refunded
                </h3>
                <p className="text-sm text-amber-700 mb-4">
                  The deposit was insufficient for the purchase. Your funds have been automatically refunded to your wallet.
                </p>
                <div className="bg-white/60 rounded-lg p-3 mb-4">
                  <div className="text-sm text-gray-600 mb-1">Refund sent to</div>
                  <div className="font-mono text-sm text-gray-900 break-all">
                    {finalRecipientAddress}
                  </div>
                </div>
                {txHash && (
                  <a
                    href={`https://basescan.org/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    View Refund on Basescan →
                  </a>
                )}
                <div className="mt-4 pt-4 border-t border-amber-200">
                  <Button
                    onClick={() => {
                      setStatus("IDLE");
                      setExecutionStep(null);
                      setDepositAddress("");
                      setCompanionAddress("");
                      setTxHash("");
                      setDepositReceived(false);
                      setCompanionBalance("0");
                      setCurrentStep(1);
                    }}
                    variant="outline"
                    className="border-amber-300 text-amber-700 hover:bg-amber-100"
                  >
                    <Ticket className="w-4 h-4 mr-2" />
                    Try Again
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>

        {/* Info Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-3xl shadow-xl border border-gray-200 p-8"
        >
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="w-full flex items-center justify-between text-left"
          >
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Info className="w-6 h-6 text-blue-600" />
              How It Works
            </h2>
            <span className="text-2xl text-gray-400">{showInfo ? "−" : "+"}</span>
          </button>

          {showInfo && (
            <div className="mt-6 space-y-4 text-gray-700">
              <div className="p-4 bg-blue-50 rounded-xl">
                <h3 className="font-semibold mb-2">🎫 Ticket Purchase</h3>
                <p className="text-base">
                  Each ticket costs ${TICKET_PRICE_USD.toFixed(2)}. You can pay with any token from any chain -
                  Loofta Pay will automatically bridge and convert it to ETH on Base.
                </p>
              </div>

              <div className="p-4 bg-purple-50 rounded-xl">
                <h3 className="font-semibold mb-2">🎨 IFT NFTs</h3>
                <p className="text-base">
                  When you purchase tickets, you'll receive IFT (Internet Token) NFTs representing
                  your lottery tickets. These NFTs are minted on the Base blockchain.
                </p>
              </div>

              <div className="p-4 bg-green-50 rounded-xl">
                <h3 className="font-semibold mb-2">🏆 Winning Prizes</h3>
                <p className="text-base">
                  If your ticket wins, prizes are automatically sent to your connected ETH address
                  on Base. No additional steps required!
                </p>
              </div>

              <div className="p-4 bg-yellow-50 rounded-xl">
                <h3 className="font-semibold mb-2">💡 Multi-Chain & Multi-Token Support</h3>
                <p className="text-base">
                  Purchase tickets from any chain! Pay with USDC, USDT, SOL, BTC, or any other supported token.
                  NEAR Intents automatically bridges to Base and converts to ETH. For non-EVM chains,
                  provide your EVM wallet address where tickets will be minted.
                </p>
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <a
                  href="https://theinternettoken.com/faq"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-2"
                >
                  Learn more about the Internet Token Lottery →
                </a>
              </div>
            </div>
          )}
        </motion.div>

        {/* Recovery Section */}
        <div className="mt-4 text-center">
          <button
            onClick={async () => {
              if (!showRecovery) {
                const wallets = await listAllCompanionWallets();
                setRecoveryWallets(wallets);
              }
              setShowRecovery(!showRecovery);
            }}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            {showRecovery ? "Hide recovery options" : "Have funds stuck? Click here"}
          </button>

          {showRecovery && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200 text-left max-w-lg mx-auto">
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Companion Wallets</h4>
              {recoveryWallets.length === 0 ? (
                <p className="text-sm text-gray-500">No companion wallets found in cache.</p>
              ) : (
                <div className="space-y-3">
                  {recoveryWallets.map((wallet) => (
                    <div key={wallet.companionAddress} className="p-3 bg-white rounded border border-gray-200">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="text-sm text-gray-500">Companion</div>
                          <div className="font-mono text-sm text-gray-900">{wallet.companionAddress.slice(0, 10)}...{wallet.companionAddress.slice(-8)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-gray-500">Balance</div>
                          <div className="font-bold text-sm">{parseFloat(wallet.balance).toFixed(6)} ETH</div>
                        </div>
                      </div>
                      <div className="text-sm text-gray-500 mb-2">
                        Owner: {wallet.userAddress.slice(0, 8)}...{wallet.userAddress.slice(-6)}
                      </div>
                      {parseFloat(wallet.balance) > 0.00001 && (
                        <button
                          onClick={async () => {
                            if (!userAddress) {
                              toast({ variant: "destructive", title: "Connect wallet first" });
                              return;
                            }
                            setRecovering(true);
                            try {
                              const result = await recoverFundsFromCompanion({
                                companionOwnerAddress: wallet.userAddress,
                                destinationAddress: userAddress,
                              });
                              if (result.success) {
                                toast({
                                  title: "Funds recovered!",
                                  description: `${result.amountSent} ETH sent to ${userAddress?.slice(0, 6)}...${userAddress?.slice(-4)}. TX: ${result.txHash?.slice(0, 10)}...`
                                });
                                console.log("[Recovery] ✓ Funds sent to:", userAddress);
                                console.log("[Recovery] TX:", result.txHash);
                                console.log("[Recovery] View: https://basescan.org/tx/" + result.txHash);
                                // Refresh wallet list
                                const wallets = await listAllCompanionWallets();
                                setRecoveryWallets(wallets);
                              } else {
                                toast({ variant: "destructive", title: "Recovery failed", description: result.error });
                              }
                            } catch (e: any) {
                              toast({ variant: "destructive", title: "Error", description: e?.message });
                            } finally {
                              setRecovering(false);
                            }
                          }}
                          disabled={recovering}
                          className="w-full mt-2 py-1.5 px-3 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          {recovering ? "Recovering..." : `Recover to ${userAddress ? userAddress.slice(0, 6) + '...' : 'wallet'}`}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-sm text-gray-400">
                Note: Recovery only works if the signer key is still in your browser's localStorage.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


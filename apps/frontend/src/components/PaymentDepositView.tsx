'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { TokenIcon } from '@/components/TokenIcon';
import { PaymentStatusTracker } from '@/components/PaymentStatusTracker';
import { roundUpDecimals, formatUTCTimestamp } from '@/lib/format';
import { Loader2, CheckCircle2 } from 'lucide-react';
import type { NearToken } from '@/services/nearIntents';

interface PaymentDepositViewProps {
  deposit: any;
  status: string | null;
  statusData: any;
  selectedFrom: NearToken | null | undefined;
  destToken: NearToken | null | undefined;
  amount: string;
  quote?: { amountInFormatted?: string; usd?: number; est?: number } | null;
  depositAddress?: string;
  onCancel: () => void;
  onSpeedUp?: (txHash: string) => Promise<void>;
  paymentType?: 'direct' | 'companion-swap' | 'near-intent';
}

export function PaymentDepositView({
  deposit,
  status,
  statusData,
  selectedFrom,
  destToken,
  amount,
  quote,
  depositAddress,
  onCancel,
  onSpeedUp,
  paymentType = 'near-intent',
}: PaymentDepositViewProps) {
  const { toast } = useToast();
  const [speedUpOpen, setSpeedUpOpen] = useState(false);
  const [txInput, setTxInput] = useState('');
  const [submittingTx, setSubmittingTx] = useState(false);

  const s = String(status || 'PENDING_DEPOSIT').toUpperCase();
  const isTerminal = s === 'FAILED' || s === 'REFUNDED';
  const isExpired = (s === 'PENDING_DEPOSIT' || s === 'INCOMPLETE_DEPOSIT') && deposit?.deadline
    ? new Date(deposit.deadline).getTime() < Date.now()
    : false;
  const isProcessing = s === 'PROCESSING' || s === 'IN_FLIGHT' || s === 'KNOWN_DEPOSIT_TX';
  const isSuccess = s === 'SUCCESS';
  const isWaiting = s === 'PENDING_DEPOSIT' || !status;

  const depositAddr = depositAddress
    || deposit?.depositAddress
    || statusData?.quoteResponse?.quote?.depositAddress
    || statusData?.depositAddress;

  // Calculate amount to send
  let amountToSend: string | undefined = undefined;
  if (deposit?.minAmountInFormatted) {
    amountToSend = deposit.minAmountInFormatted;
  } else if (statusData?.quoteResponse?.quote?.amountInFormatted) {
    amountToSend = statusData.quoteResponse.quote.amountInFormatted;
  } else if (quote?.amountInFormatted) {
    amountToSend = quote.amountInFormatted;
  }
  // Fallback calculation
  if ((!amountToSend || amountToSend === '0') && selectedFrom?.price && amount) {
    const amountUsd = parseFloat(amount);
    const tokenPrice = selectedFrom.price;
    if (tokenPrice > 0 && amountUsd > 0) {
      if (deposit?.isCompanionSwap) {
        const baseAmount = amountUsd / tokenPrice;
        amountToSend = (baseAmount * 1.03).toFixed(6);
      } else {
        amountToSend = (amountUsd / tokenPrice).toFixed(6);
      }
    }
  }

  const handleSpeedUp = async () => {
    if (!txInput.trim() || !onSpeedUp) return;
    setSubmittingTx(true);
    try {
      await onSpeedUp(txInput.trim());
      toast({ title: 'Submitted', description: 'Transaction submitted for processing' });
      setSpeedUpOpen(false);
      setTxInput('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed', description: e?.message || 'Could not process' });
    } finally {
      setSubmittingTx(false);
    }
  };

  // Expired state
  if (isExpired) {
    return (
      <div className="text-center py-12">
        <div className="mb-4 text-6xl">🔗</div>
        <h3 className="text-2xl font-semibold text-gray-900 mb-2">
          Payment Link Expired
        </h3>
        <p className="text-gray-600 text-base mb-4">
          This payment link has expired. Please request a new one.
        </p>
        <Button onClick={onCancel} className="mt-4">
          Start New Payment
        </Button>
      </div>
    );
  }

  // Success state
  if (isSuccess) {
    return (
      <div className="text-center py-12">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.2, 1] }}
          transition={{ duration: 0.5 }}
          className="text-6xl mb-4"
        >
          🎉
        </motion.div>
        <h3 className="text-2xl font-semibold text-gray-900 mb-2">
          Payment Complete! 🎉
        </h3>
        <p className="text-gray-600 text-base">
          Your payment has been successfully processed.
        </p>
      </div>
    );
  }

  // Terminal error state
  if (isTerminal) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="text-lg font-semibold text-red-700">
          {s === 'FAILED' ? 'Payment Failed' : 'Payment Refunded'}
        </div>
        <div className="text-sm text-red-700/80 mt-1">
          {s === 'FAILED' 
            ? 'The payment could not be completed. Your funds may be refunded.'
            : 'Your deposit has been refunded. Please check your wallet.'}
        </div>
        <Button onClick={onCancel} className="mt-4 w-full">
          Try Again
        </Button>
      </div>
    );
  }

  // Processing state
  if (isProcessing) {
    return (
      <div className="space-y-6">
        {/* Animated Status */}
        <div className="text-center">
          <motion.div
            animate={{ rotate: [0, 10, -10, 10, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="text-6xl mb-4 inline-block"
          >
            ⚡
          </motion.div>
          <h3 className="text-2xl font-semibold text-gray-900 mb-2">
            Processing Your Payment
          </h3>
          <p className="text-gray-600 text-base">
            We're routing your funds and executing the swap. This usually takes 1-2 minutes.
          </p>
        </div>

        {/* Progress Bar */}
        <div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: '25%' }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
            />
          </div>
          <div className="text-center text-sm text-gray-500 mt-2">
            Step 1 of 4
          </div>
        </div>

        {/* Status Tracker */}
        <PaymentStatusTracker
          status={status}
          statusData={statusData}
          depositReceivedAt={statusData?.updatedAt}
          startedAt={deposit?.deadline ? new Date(deposit.deadline).toISOString() : undefined}
          fromChain={selectedFrom?.chain}
          toChain={destToken?.chain}
          depositAddress={depositAddr}
          timeEstimate={statusData?.quoteResponse?.quote?.timeEstimate || deposit?.timeEstimate}
          paymentType={paymentType}
        />

        {/* Payment Summary */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-lg font-semibold text-gray-900 mb-2">Payment summary</div>
          <div className="text-base text-gray-700 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Amount requested</span>
              <span className="text-lg font-semibold text-gray-900">
                ${amount || '0.00'}
              </span>
            </div>
            {selectedFrom && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Paid with</span>
                <span className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
                  <TokenIcon token={selectedFrom} chain={selectedFrom.chain} size={24} />
                  <span>
                    {statusData?.swapDetails?.depositedAmountFormatted
                      ? `${roundUpDecimals(statusData.swapDetails.depositedAmountFormatted, 6)} ${selectedFrom.symbol}`
                      : `— ${selectedFrom.symbol}`}
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Waiting for deposit state (PENDING_DEPOSIT)
  return (
    <div className="space-y-6">
      {/* Animated Status */}
      <div className="text-center">
        <motion.div
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="text-6xl mb-4 inline-block"
        >
          💳
        </motion.div>
        <h3 className="text-2xl font-semibold text-gray-900 mb-2">
          Waiting for Deposit
        </h3>
        <div className="text-gray-600 text-base">
          Send the exact amount to the deposit address shown below.
          <br />
          <span className="text-base font-medium block mt-1">
            Only deposit {selectedFrom?.symbol} from {String(selectedFrom?.chain || '').toUpperCase()} network.
          </span>
          {onSpeedUp && !speedUpOpen && (
            <button
              type="button"
              className="text-sm text-blue-600 hover:text-blue-800 underline mt-2"
              onClick={() => setSpeedUpOpen(true)}
            >
              Already deposited? Speed up processing
            </button>
          )}
        </div>
      </div>

      {/* Speed Up Form */}
      {speedUpOpen && onSpeedUp && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="text-sm font-semibold text-blue-800 mb-2">
            Speed up processing
          </div>
          <p className="text-sm text-blue-700 mb-3">
            If you've already deposited, enter your transaction hash to speed up processing.
          </p>
          <div className="flex gap-2">
            <Input
              value={txInput}
              onChange={(e) => setTxInput(e.target.value)}
              placeholder="0x... or transaction hash"
              className="flex-1 text-sm font-mono"
            />
            <Button
              onClick={handleSpeedUp}
              disabled={!txInput.trim() || submittingTx}
              size="sm"
            >
              {submittingTx ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit'}
            </Button>
          </div>
          <button
            type="button"
            className="text-xs text-gray-500 hover:text-gray-700 mt-2"
            onClick={() => setSpeedUpOpen(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Progress Bar */}
      <div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: '0%' }}
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
          />
        </div>
        <div className="text-center text-sm text-gray-500 mt-2">
          Step 0 of 4
        </div>
      </div>

      {/* Amount to Pay Card */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-base text-gray-700 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Amount to pay</span>
            <span className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
              {selectedFrom && (
                <>
                  <TokenIcon token={selectedFrom} chain={selectedFrom.chain} size={24} />
                  <span>
                    {amountToSend
                      ? `${roundUpDecimals(amountToSend, 6)} ${selectedFrom.symbol}`
                      : `$${amount || '0.00'}`}
                  </span>
                </>
              )}
            </span>
          </div>
          {depositAddr && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-600">Deposit to</span>
              <div className="flex items-center gap-2 flex-1 justify-end">
                <span className="text-sm font-mono text-gray-900">
                  {depositAddr.length > 20
                    ? `${depositAddr.slice(0, 6)}...${depositAddr.slice(-4)}`
                    : depositAddr}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(depositAddr);
                      toast({ title: 'Copied', description: 'Deposit address copied' });
                    } catch {
                      toast({ variant: 'destructive', title: 'Copy failed' });
                    }
                  }}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
                  </svg>
                </button>
              </div>
            </div>
          )}
          {deposit?.memo && (
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Memo (required)</span>
              <span className="text-sm font-mono text-gray-900">{deposit.memo}</span>
            </div>
          )}
        </div>
      </div>

      {/* QR Code */}
      {depositAddr && (
        <div className="flex justify-center">
          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <QRCodeSVG value={depositAddr} size={180} level="M" />
          </div>
        </div>
      )}

      {/* Incomplete Deposit Warning */}
      {s === 'INCOMPLETE_DEPOSIT' && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
          <div className="text-sm font-semibold text-orange-700">
            Incomplete Deposit
          </div>
          <div className="text-sm text-orange-700/80 mt-1">
            Please send the remaining amount to complete your payment.
          </div>
        </div>
      )}

      {/* Status Tracker */}
      <PaymentStatusTracker
        status={status || 'PENDING_DEPOSIT'}
        statusData={statusData}
        depositReceivedAt={statusData?.updatedAt}
        startedAt={deposit?.deadline ? new Date(deposit.deadline).toISOString() : undefined}
        fromChain={selectedFrom?.chain}
        toChain={destToken?.chain}
        depositAddress={depositAddr}
        timeEstimate={deposit?.timeEstimate}
        paymentType={paymentType}
      />

      {/* Deadline */}
      {deposit?.deadline && (
        <div className="text-center text-sm text-gray-600">
          Deadline: <span className="font-medium">{formatUTCTimestamp(deposit.deadline)}</span>
        </div>
      )}

      {/* Cancel Button */}
      <div className="text-center">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Cancel and choose different token
        </button>
      </div>
    </div>
  );
}

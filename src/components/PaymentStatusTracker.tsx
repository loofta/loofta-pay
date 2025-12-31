'use client'

import React, { useEffect, useState, useMemo } from 'react';
import { Loader2, CheckCircle2, Clock, ArrowRight, Zap, Send, Wallet } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getNetworkConfirmationTime, getSameChainProcessingTime } from '@/lib/networkTimes';

export type PaymentStatus =
  | 'PENDING_DEPOSIT'
  | 'INCOMPLETE_DEPOSIT'
  | 'PROCESSING'
  | 'KNOWN_DEPOSIT_TX'
  | 'SUCCESS'
  | 'FAILED'
  | 'REFUNDED'
  | string;

interface PaymentStep {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  status: 'pending' | 'active' | 'completed';
  estimatedTime?: number; // in seconds
}

interface PaymentStatusTrackerProps {
  status: PaymentStatus | null;
  statusData?: any;
  depositReceivedAt?: string | null;
  startedAt?: string | null;
  fromChain?: string | null;
  toChain?: string | null;
  depositAddress?: string | null; // For fetching transaction data from 1-click API
  timeEstimate?: number | null; // Time estimate from NEAR Intents quote (in seconds)
  paidAt?: string | null; // Timestamp when payment was completed
}

const STEP_CONFIG: Record<string, Omit<PaymentStep, 'status'>> = {
  deposit: {
    id: 'deposit',
    label: 'Deposit Received',
    description: 'Waiting for your deposit to be confirmed on-chain',
    icon: <Wallet className="w-5 h-5" />,
    estimatedTime: 30, // 30 seconds for blockchain confirmation
  },
  routing: {
    id: 'routing',
    label: 'Routing & Swapping',
    description: 'Finding the best route and executing the swap',
    icon: <Zap className="w-5 h-5" />,
    estimatedTime: 45, // 45 seconds for swap execution
  },
  processing: {
    id: 'processing',
    label: 'Processing Payment',
    description: 'Finalizing transaction details and preparing transfer',
    icon: <Loader2 className="w-5 h-5" />,
    estimatedTime: 20, // 20 seconds for processing
  },
  sending: {
    id: 'sending',
    label: 'Sending to Recipient',
    description: 'Transferring funds to the recipient wallet',
    icon: <Send className="w-5 h-5" />,
    estimatedTime: 30, // 30 seconds for cross-chain transfer
  },
  success: {
    id: 'success',
    label: 'Payment Complete',
    description: 'Funds have been successfully sent',
    icon: <CheckCircle2 className="w-5 h-5" />,
  },
};

function getStepsForStatus(
  status: PaymentStatus | null,
  averagePaymentTime?: number | null,
  fromChain?: string | null,
  toChain?: string | null
): PaymentStep[] {
  const isSameChain = fromChain && toChain && String(fromChain).toLowerCase() === String(toChain).toLowerCase();

  // For same-chain: use network-specific confirmation times
  let depositTime: number;
  let routingTime: number;
  let processingTime: number;
  let sendingTime: number;

  if (isSameChain && fromChain) {
    // Same-chain: deposit confirmation + swap (~10-15s) + transfer confirmation
    const confirmationTime = getNetworkConfirmationTime(fromChain);
    depositTime = confirmationTime; // Network-specific confirmation
    routingTime = 10; // Swap execution on same chain is fast
    processingTime = 5; // Minimal processing for same-chain
    sendingTime = confirmationTime; // Network-specific confirmation for transfer
  } else if (averagePaymentTime) {
    // Cross-chain: use average time distribution
    // Distribution: deposit 20%, routing 40%, processing 15%, sending 25%
    depositTime = Math.round(averagePaymentTime * 0.2);
    routingTime = Math.round(averagePaymentTime * 0.4);
    processingTime = Math.round(averagePaymentTime * 0.15);
    sendingTime = Math.round(averagePaymentTime * 0.25);
  } else {
    // Default fallback
    depositTime = 30;
    routingTime = 45;
    processingTime = 20;
    sendingTime = 30;
  }

  const configWithTimes = {
    deposit: { ...STEP_CONFIG.deposit, estimatedTime: depositTime },
    routing: { ...STEP_CONFIG.routing, estimatedTime: routingTime },
    processing: { ...STEP_CONFIG.processing, estimatedTime: processingTime },
    sending: { ...STEP_CONFIG.sending, estimatedTime: sendingTime },
    success: { ...STEP_CONFIG.success }, // Success step doesn't need estimatedTime
  };
  const upperStatus = String(status || '').toUpperCase();

  if (upperStatus === 'SUCCESS') {
    return [
      { ...configWithTimes.deposit, status: 'completed' as const },
      { ...configWithTimes.routing, status: 'completed' as const },
      { ...configWithTimes.processing, status: 'completed' as const },
      { ...configWithTimes.sending, status: 'completed' as const },
      { ...configWithTimes.success, status: 'completed' as const },
    ];
  }

  if (upperStatus === 'PROCESSING' || upperStatus === 'KNOWN_DEPOSIT_TX') {
    return [
      { ...configWithTimes.deposit, status: 'completed' as const },
      { ...configWithTimes.routing, status: 'active' as const },
      { ...configWithTimes.processing, status: 'pending' as const },
      { ...configWithTimes.sending, status: 'pending' as const },
      { ...configWithTimes.success, status: 'pending' as const },
    ];
  }

  if (upperStatus === 'INCOMPLETE_DEPOSIT') {
    return [
      { ...configWithTimes.deposit, status: 'active' as const },
      { ...configWithTimes.routing, status: 'pending' as const },
      { ...configWithTimes.processing, status: 'pending' as const },
      { ...configWithTimes.sending, status: 'pending' as const },
      { ...configWithTimes.success, status: 'pending' as const },
    ];
  }

  // PENDING_DEPOSIT or default - show "Waiting for Deposit" not "Deposit Received"
  return [
    {
      ...configWithTimes.deposit,
      status: 'active' as const,
      label: 'Waiting for Deposit', // Change label for pending status
      description: 'Send the exact amount to the deposit address shown above',
    },
    { ...configWithTimes.routing, status: 'pending' as const },
    { ...configWithTimes.processing, status: 'pending' as const },
    { ...configWithTimes.sending, status: 'pending' as const },
    { ...configWithTimes.success, status: 'pending' as const },
  ];
}

function getStatusMessage(status: PaymentStatus | null): { title: string; subtitle: string } {
  const upperStatus = String(status || '').toUpperCase();

  console.log('status here then', status);
  switch (upperStatus) {
    case 'SUCCESS':
      return {
        title: 'Payment Complete! 🎉',
        subtitle: 'Your funds have been successfully sent to the recipient.',
      };
    case 'PROCESSING':
    case 'KNOWN_DEPOSIT_TX':
      return {
        title: 'Processing Your Payment',
        subtitle: 'We\'re routing your funds and executing the swap. This usually takes 1-2 minutes.',
      };
    case 'INCOMPLETE_DEPOSIT':
      return {
        title: 'Incomplete Deposit',
        subtitle: 'Please send the remaining amount to complete your payment.',
      };
    case 'PENDING_DEPOSIT':
      return {
        title: 'Waiting for Deposit',
        subtitle: 'Send the exact amount to the deposit address shown above.',
      };
    case 'REFUNDED':
      return {
        title: 'Payment Refunded',
        subtitle: 'Your deposit has been refunded. Please check your wallet.',
      };
    case 'FAILED':
      return {
        title: 'Payment Failed',
        subtitle: 'The payment could not be completed. Your funds may be refunded.',
      };
    default:
      return {
        title: 'Waiting for Deposit',
        subtitle: 'Send the exact amount to the deposit address shown above.',
      };
  }
}

function AnimatedCharacter({ status }: { status: PaymentStatus | null }) {
  const upperStatus = String(status || '').toUpperCase();
  const isProcessing = upperStatus === 'PROCESSING' || upperStatus === 'KNOWN_DEPOSIT_TX';
  const isSuccess = upperStatus === 'SUCCESS';
  const isWaiting = upperStatus === 'PENDING_DEPOSIT' || !status;

  return (
    <div className="relative w-32 h-32 mx-auto mb-6">
      {isSuccess ? (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          className="w-full h-full flex items-center justify-center"
        >
          <div className="relative">
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 2 }}
              className="text-6xl"
            >
              🎉
            </motion.div>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.2, 1] }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="absolute -top-2 -right-2 text-3xl"
            >
              ✅
            </motion.div>
          </div>
        </motion.div>
      ) : isProcessing ? (
        <motion.div
          animate={{
            y: [0, -10, 0],
            rotate: [0, 5, -5, 0]
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          className="w-full h-full flex items-center justify-center"
        >
          <div className="relative">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="text-6xl"
            >
              ⚡
            </motion.div>
            <motion.div
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.5, 1, 0.5]
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: 'easeInOut'
              }}
              className="absolute inset-0 rounded-full border-4 border-orange-400"
            />
          </div>
        </motion.div>
      ) : (
        <motion.div
          animate={{
            y: [0, -8, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          className="w-full h-full flex items-center justify-center"
        >
          <div className="text-6xl">💳</div>
        </motion.div>
      )}
    </div>
  );
}

function TimeEstimate({
  status,
  startedAt,
  depositReceivedAt,
  averagePaymentTime,
  fromChain,
  toChain,
  paidAt
}: {
  status: PaymentStatus | null;
  startedAt?: string | null;
  depositReceivedAt?: string | null;
  averagePaymentTime?: number | null;
  fromChain?: string | null;
  toChain?: string | null;
  paidAt?: string | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  const upperStatus = String(status || '').toUpperCase();

  // Only start timer when deposit is actually received (PROCESSING, KNOWN_DEPOSIT_TX, or later)
  // Don't start timer for: PENDING_DEPOSIT, INCOMPLETE_DEPOSIT, FAILED, REFUNDED
  const shouldStartTimer = (upperStatus === 'PROCESSING' || upperStatus === 'KNOWN_DEPOSIT_TX');

  const startTime = useMemo(() => {
    // Only use depositReceivedAt if status is PROCESSING or later
    if (shouldStartTimer && depositReceivedAt) {
      return new Date(depositReceivedAt).getTime();
    }
    // Don't start timer for PENDING_DEPOSIT
    if (!shouldStartTimer) return null;
    // Fallback to startedAt only if we should start timer
    if (startedAt) return new Date(startedAt).getTime();
    return Date.now();
  }, [depositReceivedAt, startedAt, shouldStartTimer]);

  // Calculate actual elapsed time for SUCCESS status
  // Use depositReceivedAt to paidAt if available, otherwise use startedAt to paidAt
  const actualElapsedTime = useMemo(() => {
    if (upperStatus === 'SUCCESS' && paidAt) {
      let startTime: number | null = null;
      
      // Prefer depositReceivedAt (time from when deposit was received to completion)
      if (depositReceivedAt) {
        startTime = new Date(depositReceivedAt).getTime();
      } else if (startedAt) {
        // Fallback to startedAt (time from claim creation to completion)
        startTime = new Date(startedAt).getTime();
      }
      
      if (startTime) {
        const paidTime = new Date(paidAt).getTime();
        const elapsed = Math.floor((paidTime - startTime) / 1000);
        return elapsed > 0 ? elapsed : null;
      }
    }
    return null;
  }, [upperStatus, depositReceivedAt, paidAt, startedAt]);

  useEffect(() => {
    // For SUCCESS status, use actual elapsed time from timestamps
    if (upperStatus === 'SUCCESS' && actualElapsedTime !== null) {
      setElapsed(actualElapsedTime);
      return;
    }

    // Stop timer for terminal states
    const isTerminal = upperStatus === 'SUCCESS' || upperStatus === 'FAILED' || upperStatus === 'REFUNDED';
    if (isTerminal || !shouldStartTimer || !startTime) {
      setElapsed(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, upperStatus, shouldStartTimer, actualElapsedTime]);

  const getEstimatedTimeRemaining = () => {
    if (upperStatus === 'SUCCESS') return null;
    // Don't show time estimate for PENDING_DEPOSIT or INCOMPLETE_DEPOSIT - deposit hasn't been fully received yet
    if (upperStatus === 'PENDING_DEPOSIT' || upperStatus === 'INCOMPLETE_DEPOSIT') return null;
    // Don't show for terminal states
    if (upperStatus === 'FAILED' || upperStatus === 'REFUNDED') return null;

    const steps = getStepsForStatus(status, averagePaymentTime, fromChain, toChain);
    const activeStepIndex = steps.findIndex(s => s.status === 'active');
    if (activeStepIndex === -1) return null;

    const activeStep = steps[activeStepIndex];
    const remainingSteps = steps.slice(activeStepIndex);
    const totalEstimate = remainingSteps.reduce((sum, step) =>
      sum + (step.estimatedTime || 0), 0
    );

    const remaining = Math.max(0, totalEstimate - elapsed);
    return remaining;
  };

  const estimatedRemaining = getEstimatedTimeRemaining();

  if (upperStatus === 'SUCCESS') {
    // Calculate elapsed time: from deposit received to payment completed
    // Use actualElapsedTime if available (calculated from timestamps), otherwise use elapsed state
    const totalSeconds = actualElapsedTime !== null ? actualElapsedTime : (elapsed > 0 ? elapsed : 0);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    // Format: show "Xm Ys" or just "Ys" if less than a minute
    const timeDisplay = minutes > 0 
      ? `${minutes}m ${seconds}s`
      : `${seconds}s`;
    
    return (
      <div className="text-center mt-4">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 text-emerald-700 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4" />
          Completed in {timeDisplay}
        </div>
      </div>
    );
  }

  if (!estimatedRemaining && estimatedRemaining !== 0) return null;

  // Show elapsed time during processing
  const elapsedMinutes = Math.floor(elapsed / 60);
  const elapsedSeconds = elapsed % 60;

  return (
    <div className="text-center mt-4">
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 text-blue-700 text-sm font-medium">
        <Clock className="w-4 h-4" />
        {elapsedMinutes > 0 ? `${elapsedMinutes}m ${elapsedSeconds}s` : `${elapsedSeconds}s`} elapsed
      </div>
    </div>
  );
}

export function PaymentStatusTracker({
  status,
  statusData,
  depositReceivedAt,
  startedAt,
  fromChain,
  toChain,
  depositAddress,
  timeEstimate,
  paidAt,
}: PaymentStatusTrackerProps) {
  const [averagePaymentTime, setAveragePaymentTime] = useState<number | null>(null);
  const [loadingAverages, setLoadingAverages] = useState(false);

  // Check if same-chain transaction
  const isSameChain = useMemo(() => {
    if (!fromChain || !toChain) return false;
    return String(fromChain).toLowerCase() === String(toChain).toLowerCase();
  }, [fromChain, toChain]);

  // Use timeEstimate from NEAR Intents quote, or fallback to same-chain network times
  useEffect(() => {
    if (timeEstimate && typeof timeEstimate === 'number' && timeEstimate > 0) {
      setAveragePaymentTime(timeEstimate);
      return;
    }

    // For same-chain, use network-specific confirmation times
    if (isSameChain && fromChain) {
      const sameChainTime = getSameChainProcessingTime(fromChain);
      setAveragePaymentTime(sameChainTime);
      return;
    }

    // Default fallback - no database call
    setAveragePaymentTime(null);
  }, [timeEstimate, isSameChain, fromChain]);

  const steps = useMemo(() => getStepsForStatus(status, averagePaymentTime, fromChain, toChain), [status, averagePaymentTime, fromChain, toChain]);
  const statusMessage = useMemo(() => getStatusMessage(status), [status]);
  const upperStatus = String(status || '').toUpperCase();

  const activeStepIndex = steps.findIndex(s => s.status === 'active');
  const completedSteps = steps.filter(s => s.status === 'completed').length;
  const progress = (completedSteps / (steps.length - 1)) * 100; // -1 because success step doesn't count

  return (
    <div className="w-full">
      {/* Animated Character - Hidden when used in split mode (shown separately above QR) */}
      <div className="hidden">
        <AnimatedCharacter status={status} />
      </div>

      {/* Status Message - Hidden when used in split mode (shown separately above QR) */}
      <div className="text-center mb-8 hidden">
        <h3 className="text-2xl font-semibold text-gray-900 mb-2">
          {statusMessage.title}
        </h3>
        <p className="text-gray-600 text-base">
          {statusMessage.subtitle}
        </p>
      </div>

      {/* Progress Bar - Hidden when used in split mode (shown separately above timeline) */}
      <div className="mb-8 hidden">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
          />
        </div>
        <div className="mt-2 text-center text-sm text-gray-500">
          Step {completedSteps} of {steps.length - 1}
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-4 relative">
        {steps.map((step, index) => {
          const isActive = step.status === 'active';
          const isCompleted = step.status === 'completed';
          const isPending = step.status === 'pending';

          return (
            <div key={step.id} className="relative">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`
                  flex items-start gap-4 p-4 rounded-xl border-2 transition-all relative
                  ${isActive
                    ? 'bg-orange-50 border-orange-300 shadow-md'
                    : isCompleted
                      ? 'bg-emerald-50 border-emerald-200'
                      : 'bg-gray-50 border-gray-200'
                  }
                `}
              >
                {/* Icon */}
                <div className="relative">
                  <div className={`
                    flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center relative z-10
                    ${isActive
                      ? 'bg-orange-500 text-white'
                      : isCompleted
                        ? 'bg-emerald-500 text-white'
                        : 'bg-gray-300 text-gray-500'
                    }
                  `}>
                    {isActive && (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                      >
                        {step.icon}
                      </motion.div>
                    )}
                    {isCompleted && <CheckCircle2 className="w-5 h-5" />}
                    {isPending && step.icon}
                  </div>

                  {/* Connector Line */}
                  {index < steps.length - 1 && (
                    <div className={`
                      absolute left-1/2 top-full w-0.5 h-4 -translate-x-1/2
                      ${isCompleted ? 'bg-emerald-300' : 'bg-gray-200'}
                    `} />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className={`
                      font-semibold text-base
                      ${isActive ? 'text-orange-900' : isCompleted ? 'text-emerald-900' : 'text-gray-600'}
                    `}>
                      {step.label}
                    </h4>
                    {isActive && step.estimatedTime && (
                      <span className="text-xs text-orange-600 font-medium">
                        ~{step.estimatedTime}s
                      </span>
                    )}
                  </div>
                  <p className={`
                    text-sm
                    ${isActive ? 'text-orange-700' : isCompleted ? 'text-emerald-700' : 'text-gray-500'}
                  `}>
                    {step.description}
                  </p>
                </div>
              </motion.div>
            </div>
          );
        })}
      </div>

      {/* Time Estimate */}
      <TimeEstimate
        status={status}
        startedAt={startedAt}
        depositReceivedAt={depositReceivedAt || statusData?.updatedAt}
        averagePaymentTime={averagePaymentTime}
        fromChain={fromChain}
        toChain={toChain}
        paidAt={paidAt}
      />

      {/* Additional Info for Processing */}
      {(upperStatus === 'PROCESSING' || upperStatus === 'KNOWN_DEPOSIT_TX') && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 p-4 rounded-xl bg-blue-50 border border-blue-200"
        >
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="font-semibold text-blue-900 mb-1">What's happening now?</h4>
              <p className="text-sm text-blue-700">
                Your deposit has been confirmed. We're now finding the best route to swap your tokens
                and will transfer them to the recipient once the swap is complete.
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}


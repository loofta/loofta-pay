import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Wallet, Info, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { usePayment } from '@/hooks/usePayment';
import { PAYMENT_ADDRESSES } from '@/lib/constants';
import { getTransactionUrl } from '@/lib/utils';

interface PaymentMethodProps {
  amount: number;
  currency: string;
  onSuccess?: (paymentHash: string, network: 'taraxa' | 'eth') => void;
  onError?: (error: string) => void;
  className?: string;
}

export default function PaymentMethod({ amount, currency, onSuccess, onError, className = '' }: PaymentMethodProps) {
  const { makePayment, isLoading: isPaymentLoading } = usePayment();
  const [selectedNetwork, setSelectedNetwork] = useState<'taraxa' | 'eth'>('taraxa');
  const [paymentStep, setPaymentStep] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [paymentHash, setPaymentHash] = useState<string>('');

  const handlePay = async () => {
    try {
      setPaymentStep('processing');
      console.log('Selected network:', selectedNetwork);
      console.log('Payment address:', PAYMENT_ADDRESSES[selectedNetwork]);

      const hash = await makePayment({
        amount: amount.toString(),
        currency: 'USDT',
        network: selectedNetwork,
        recipient: PAYMENT_ADDRESSES[selectedNetwork]
      });

      if (!hash) {
        setPaymentStep('error');
        toast({
          title: "Error",
          description: "Payment failed. Please try again.",
          variant: "destructive"
        });
        onError?.("Payment failed");
        return;
      }

      setPaymentHash(hash);
      setPaymentStep('success');
      onSuccess?.(hash, selectedNetwork);
    } catch (error) {
      setPaymentStep('error');
      console.error('Payment error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to process your payment. Please try again.",
        variant: "destructive",
      });
      onError?.(error instanceof Error ? error.message : "Payment failed");
    }
  };

  const resetPayment = () => {
    setPaymentStep('idle');
    setPaymentHash('');
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="bg-gray-50 p-4 rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Amount</span>
          <span className="font-medium text-sm">{amount} {currency}</span>
        </div>
      </div>

      {/* Payment Info Alert */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Secure Direct Payment</p>
            <p>Your payment will be sent directly to our platform wallet. No token approvals needed - this is a standard, secure transfer.</p>
          </div>
        </div>
      </div>

      {paymentStep === 'idle' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Payment Network</Label>
            <div className="grid grid-cols-2 gap-3">
              <div
                onClick={() => setSelectedNetwork('taraxa')}
                className={`flex items-center gap-2 p-4 border-2 rounded-md cursor-pointer transition-all ${selectedNetwork === 'taraxa'
                  ? 'border-orange-500 bg-orange-50/30'
                  : 'border-gray-200 hover:border-orange-200 hover:bg-orange-50/30'
                  }`}
              >
                <img src="/images/taraxa.png" alt="Taraxa" className="w-5 h-5" />
                <span className="font-medium">Taraxa</span>
              </div>
              <div
                onClick={() => setSelectedNetwork('eth')}
                className={`flex items-center gap-2 p-4 border-2 rounded-md cursor-pointer transition-all ${selectedNetwork === 'eth'
                  ? 'border-orange-500 bg-orange-50/30'
                  : 'border-gray-200 hover:border-orange-200 hover:bg-orange-50/30'
                  }`}
              >
                <img src="/images/eth.png" alt="Ethereum" className="w-5 h-5" />
                <span className="font-medium">Ethereum</span>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Choose your preferred network. Both support USDT payments.
            </p>
          </div>

          <Button
            onClick={handlePay}
            disabled={isPaymentLoading}
            className="w-full flex items-center justify-center gap-2 p-4 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Wallet className="w-5 h-5" />
            {isPaymentLoading ? "Please wait..." : `Pay ${amount} ${currency} on ${selectedNetwork === 'taraxa' ? 'Taraxa' : 'Ethereum'}`}
          </Button>
        </div>
      )}

      {paymentStep === 'processing' && (
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto"></div>
          <div className="space-y-2">
            <h3 className="font-medium text-gray-900">Processing Payment</h3>
            <p className="text-sm text-gray-600">
              Please confirm the transaction in your wallet. This is a direct transfer - no approvals needed.
            </p>
          </div>
        </div>
      )}

      {paymentStep === 'success' && (
        <div className="text-center space-y-4">
          <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle className="w-6 h-6 text-green-600" />
          </div>
          <div className="space-y-2">
            <h3 className="font-medium text-gray-900">Payment Successful!</h3>
            <p className="text-sm text-gray-600">Your payment has been processed successfully.</p>
            {paymentHash && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-600 mb-2">Transaction Hash:</p>
                <a
                  href={getTransactionUrl(paymentHash, selectedNetwork)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline flex items-center justify-center gap-1 break-all"
                >
                  {paymentHash.slice(0, 6)}...{paymentHash.slice(-4)}
                  <ExternalLink className="w-3 h-3" />
                </a>
                <p className="text-xs text-gray-500 mt-1">
                  View on {selectedNetwork === 'taraxa' ? 'Taraxa' : 'Ethereum'} Explorer
                </p>
              </div>
            )}
          </div>
          <Button onClick={resetPayment} variant="outline" className="w-full">
            Make Another Payment
          </Button>
        </div>
      )}

      {paymentStep === 'error' && (
        <div className="text-center space-y-4">
          <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-600" />
          </div>
          <div className="space-y-2">
            <h3 className="font-medium text-gray-900">Payment Failed</h3>
            <p className="text-sm text-gray-600">There was an issue processing your payment. Please try again.</p>
          </div>
          <Button onClick={resetPayment} variant="outline" className="w-full">
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
} 
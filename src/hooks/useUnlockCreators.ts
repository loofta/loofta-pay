import { toast } from "@/components/ui/use-toast";
import { useState } from "react";
import { messageNotification } from "@/services/notificationService";
import { UNLOCK_CREATORS_ACCESS_AMOUNT } from "@/lib/utils";
import { usePrivy } from '@privy-io/react-auth';
import { grantCreatorAccess } from "@/app/actions/creators/creators";
import { PAYMENT_ADDRESS } from "@/lib/constants";
import { usePayment } from "./usePayment";

export function useUnlockCreators() {
  const { user } = usePrivy();
  const { makePayment, isLoading } = usePayment();
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleUnlock = () => {
    if (!user?.id) {
      toast({
        title: "Error",
        description: "Please login first",
        variant: "destructive",
      });
      return;
    }
    setShowConfirmModal(true);
  };

  const handleConfirmPayment = async (network: 'taraxa', token: 'USDT') => {
    if (!user?.id) return;

    let amount = UNLOCK_CREATORS_ACCESS_AMOUNT.toString();
    try {
      const result = await makePayment({
        amount: String(amount),
        currency: token,
        network: network,
        recipient: PAYMENT_ADDRESS,
        privyId: user.id,
        userId: user.id
      });

      if (result) {
        // Update creatorAccess DB
        const accessResult = await grantCreatorAccess({
          privyId: user.id,
          userId: user.id,
          network: network,
          amount: UNLOCK_CREATORS_ACCESS_AMOUNT,
          currency: token,
          timestamp: Date.now(),
          transactionHash: result
        });

        if (accessResult.success) {
          // Show success toast and trigger a page refresh
          toast({
            title: "Success",
            description: "Access granted successfully! Please wait while we update your access...",
          });
          
          // Give a small delay before refreshing to ensure the toast is seen
          setTimeout(() => {
            window.location.reload();
          }, 1500);
          
          return;
        }
      }
      
      // Only show error if we didn't get a successful result
      toast({
        title: "Error",
        description: "Failed to process payment. Please try again or contact support if the issue persists.",
        variant: "destructive",
      });
    } catch (error) {
      console.error("Error in handleConfirmPayment:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to process payment",
        variant: "destructive",
      });
    }
  };

  return {
    handleUnlock,
    showConfirmModal,
    setShowConfirmModal,
    handleConfirmPayment,
    isLoading
  };
} 
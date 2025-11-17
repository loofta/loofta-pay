import { Children, ReactNode, useEffect, useState } from 'react';
import PrimaryBtn from '../PrimaryBtn';
import LoadingScreen from '../LoadingScreen';
import MobilePillMenu from '../BottomMenu';
import { useWallet } from '@/hooks/useWallet';
import { useRouter } from 'next/navigation';
import SecondaryBtn from '../SecondaryBtn';
import { notifyDealCreated } from '@/services/notificationService'; // Import the service
import { DEALS_ROUTE } from '@/app/utils/routes';

interface StepperProps {
  nextText: string[];
  children: ReactNode;
  isButtonEnabled: boolean;
  checkWallet: () => boolean;
  handleConfirm?: () => void;
  onStepChange?: (step: number) => void;
  onActivateAndPay?: () => Promise<boolean>;
  handleConnectWallet?: () => void;
  payLater?: boolean;
  dealId: string;
  senderTgId: number | undefined;
}

export default function Stepper({
  nextText,
  children,
  isButtonEnabled,
  checkWallet,
  handleConfirm,
  onStepChange,
  onActivateAndPay,
  handleConnectWallet,
  payLater,
  dealId,
  senderTgId,
}: StepperProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const { isWalletConnected, isLoading } = useWallet();
  const [isActivateAndPayLoading, setIsActivateAndPayLoading] = useState(false);
  const [buttonEnabled, setButtonEnabled] = useState(isButtonEnabled);
  const router = useRouter();

  useEffect(() => {
    if (!isWalletConnected && !isLoading) {
      router.push('/');
    }
  }, [isWalletConnected, isLoading, router]);

  useEffect(() => {
    if (currentStep === 0) {
      setButtonEnabled(true);
    } else if (currentStep === 3) {
      setButtonEnabled(isWalletConnected ?? false);
    } else {
      setButtonEnabled(isButtonEnabled);
    }
  }, [currentStep, isButtonEnabled, isWalletConnected]);

  const handleClose = async () => {
    router.push(DEALS_ROUTE);
    await notifyDealCreated(dealId, senderTgId);

  };

  const handleNext = async () => {
    if (currentStep === 0 && handleConnectWallet) {
      handleConnectWallet();
      if (isWalletConnected) {
        setCurrentStep(currentStep + 1);
        onStepChange?.(currentStep + 1);
      }
      return;
    }

    if (currentStep === 1) {
      if (!checkWallet()) {
        return;
      }
    }

    if (currentStep === 2 && handleConfirm) {
      handleConfirm();
    }

    if (currentStep === 3 && onActivateAndPay) {
      const isPaid = await onActivateAndPay();
      setIsActivateAndPayLoading(true);
      if (isPaid) {
        await notifyDealCreated(dealId, senderTgId);
        setCurrentStep(currentStep + 1);
        onStepChange?.(currentStep + 1);
        setIsActivateAndPayLoading(false);
      }
      return;
    }

    if (currentStep === 3) {
      await notifyDealCreated(dealId, senderTgId);
    }

    if (currentStep < Children.count(children) - 1) {
      setCurrentStep(currentStep + 1);
      onStepChange?.(currentStep + 1);
    }

    if (currentStep === Children.count(children) - 1) {
      router.push(DEALS_ROUTE);
    }
  };

  if (isLoading) {
    return <LoadingScreen text="Checking wallet connection..." isVisible={true} />;
  }

  if (isActivateAndPayLoading) {
    return <LoadingScreen text="Loading..." isVisible={true} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-4 mt-0 mx-4">
        {Children.toArray(children)[currentStep]}
      </div>

      <div className="w-full bg-white p-2 pb-1">
        {currentStep === 3 && (
          <SecondaryBtn
            text="Pay Later"
            onClick={handleClose}
          />
        )}
        <PrimaryBtn onClick={handleNext} text={nextText[currentStep]} disabled={!buttonEnabled} />
      </div>
    </div>
  );
}

import { TonConnectButton, useTonConnectUI } from "@tonconnect/ui-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SecondaryBtn from "./SecondaryBtn";
import { UserPlus } from "lucide-react";
import Image from "next/image";
import { RetroGrid } from "./ui/retro-grid";
import { DEALS_ROUTE, HOME_ROUTE, JOIN_ROUTE } from "@/app/utils/routes";

export default function CreatorOnboarding() {
  const router = useRouter();
  const [step, setStep] = useState<'wallet' | 'profile'>('wallet');
  const [tonConnectUI] = useTonConnectUI();
  const connected = tonConnectUI.connected;
  const walletAddress = tonConnectUI.account?.address;
  const [refresh, setRefresh] = useState(false);
  useEffect(() => {
    console.log("Local Storage - isWalletConnected:", localStorage.getItem('isWalletConnected'));

    if (connected) {
      console.log("Saving wallet connection status...");
      window.Telegram?.WebApp?.storage?.setItem('isWalletConnected', 'true');
      localStorage.setItem('isWalletConnected', 'true');
    }
  }, [connected]);

  useEffect(() => {
    if (connected && walletAddress) {
      setStep('profile'); // Ensure UI updates
      console.log("refresh");
      setRefresh(prev => !prev);
      // Update freelancer profile with wallet address
      const freelancerProfile =
        window.Telegram?.WebApp?.storage?.getItem('freelancerProfile') ||
        localStorage.getItem('freelancerProfile');

      if (freelancerProfile) {
        const updatedProfile = {
          ...JSON.parse(freelancerProfile),
          walletAddress: walletAddress,
        };
        window.Telegram?.WebApp?.storage?.setItem(
          'freelancerProfile',
          JSON.stringify(updatedProfile)
        );
        localStorage.setItem('freelancerProfile', JSON.stringify(updatedProfile));
      }

      // Save wallet connection status
      window.Telegram?.WebApp?.storage?.setItem('isWalletConnected', 'true');
      localStorage.setItem('isWalletConnected', 'true');
    }
  }, [connected, walletAddress]);


  const handleCreateProfile = () => {
    router.push(JOIN_ROUTE);
  };

  const handleSkipProfile = () => {
    router.push(DEALS_ROUTE);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative min-h-screen">
      <RetroGrid className="opacity-30" />

      <div className="w-full max-w-md mx-auto space-y-8 relative">
        <div className="flex flex-col items-center justify-center text-center mb-12">
          <Image
            src="/loofta.svg"
            alt="Loofta"
            width={120}
            height={120}
            className="mb-6"
          />
        </div>

        {step === 'wallet' ? (
          <>
            <div className="text-center space-y-4">
              <h1 className="text-2xl font-semibold">Connect Your Wallet</h1>
              <p className="text-gray-600">
                To receive payments from future deals, you&apos;ll need to connect your TON wallet
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-center w-full">
                <TonConnectButton />
              </div>
              {connected && walletAddress && (
                <button
                  onClick={() => window.location.reload()}
                  className="w-full bg-orange-500 text-white py-3 px-4 rounded-lg hover:bg-orange-600 transition-colors flex items-center justify-center gap-2"
                >
                  <span>Continue</span>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="text-center space-y-4">
              <h1 className="text-2xl font-semibold">Create Your Profile</h1>
              <p className="text-gray-600">
                Set up your creator profile to start receiving deals from brands
              </p>
            </div>

            <div className="space-y-4">
              <button
                onClick={handleCreateProfile}
                className="w-full bg-orange-500 text-white py-3 px-4 rounded-lg hover:bg-orange-600 transition-colors flex items-center justify-center gap-2"
              >
                <UserPlus className="w-5 h-5" />
                Create Profile Now
              </button>
              <SecondaryBtn
                text="I'll do it later"
                onClick={handleSkipProfile}
                customProperties="w-full justify-center"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
} 
'use client';

import { useTonAddress, useTonConnectModal, useTonConnectUI } from "@tonconnect/ui-react";
import { Button } from "@/components/ui/button";
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Edit2, Wallet, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import Title from "@/components/Title";
import { JOIN_ROUTE } from "@/app/utils/routes";
import { updateFreelancerWallet } from "@/app/actions/freelancers/freelancers";
import { toFriendlyAddress } from "@/lib/utils";
import { Freelancer } from "@/app/utils/interfaces";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import PrimaryBtn from "@/components/PrimaryBtn";
import { TonConnectButton } from "@tonconnect/ui-react";

interface StoredProfile {
  id: string;
  walletAddress: string;
  [key: string]: any;
}

export default function ProfileSettings() {
  const { open } = useTonConnectModal();
  const walletAddress = useTonAddress(true);
  const [tonConnectUI] = useTonConnectUI();
  const router = useRouter();
  const { toast } = useToast();
  const [storedFreelancerProfile, setStoredFreelancerProfile] = useState<StoredProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Update profile when wallet is connected
  useEffect(() => {
    const updateProfileWallet = async () => {
      if (walletAddress && storedFreelancerProfile?.id) {
        try {
          const result = await updateFreelancerWallet(storedFreelancerProfile.id, walletAddress);
          if (result.success) {
            // Update local state
            setStoredFreelancerProfile(prev => prev ? { ...prev, walletAddress } : null);
            // Update local storage
            const storedProfile = localStorage.getItem('freelancerProfile');
            if (storedProfile) {
              const parsedProfile = JSON.parse(storedProfile);
              parsedProfile.walletAddress = "";
              localStorage.setItem('freelancerProfile', JSON.stringify(parsedProfile));

              // Update Telegram storage if available
              if (window.Telegram?.WebApp?.storage) {
                window.Telegram.WebApp.storage.setItem('freelancerProfile', JSON.stringify(parsedProfile));
              }
            }


            toast({
              title: "Wallet Connected",
              description: "Your payment wallet has been updated successfully.",
            });
          }
        } catch (error) {
          console.error('Error updating wallet:', error);
          toast({
            title: "Error",
            description: "Failed to update wallet address",
            variant: "destructive",
          });
        }
      }
    };

    updateProfileWallet();
  }, [walletAddress, storedFreelancerProfile?.id]);

  // Load profile from storage
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profileData = window.Telegram?.WebApp?.storage?.getItem('freelancerProfile') ||
          localStorage.getItem('freelancerProfile');

        if (profileData) {
          const parsedProfile = JSON.parse(profileData);
          if (parsedProfile && typeof parsedProfile === 'object') {
            setStoredFreelancerProfile(parsedProfile as StoredProfile);
          }
        }
      } catch (e) {
        console.error('Error parsing freelancer profile:', e);
      }
    };

    loadProfile();
  }, []);

  // Only set loading to false when both profile and wallet status are determined
  useEffect(() => {
    if (walletAddress !== undefined && storedFreelancerProfile !== null) {
      setIsLoading(false);
    }
  }, [walletAddress, storedFreelancerProfile]);

  const handleDisconnectWallet = async () => {
    await tonConnectUI.disconnect();

    // Update profile with empty wallet address
    if (storedFreelancerProfile?.id) {
      await updateFreelancerWallet(storedFreelancerProfile.id, '');

      setStoredFreelancerProfile(prev => prev ? { ...prev, walletAddress: '' } : null);
    }

    toast({
      title: "Wallet disconnected",
      description: "Your wallet has been disconnected successfully."
    });
  };

  // Check if wallet is missing (only after loading)
  const isWalletMissing = !storedFreelancerProfile?.walletAddress && !walletAddress;

  return (
    <div className="tg-webview h-screen flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4 mt-8 px-4 mx-0">
        <Title text="Profile Settings" showWallet={false} />

        {/* Warning Alert for Missing Wallet (only show after loading) */}
        {isWalletMissing && (
          <Alert variant="destructive" className="border-red-500 bg-red-50">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Action Required</AlertTitle>
            <AlertDescription>
              You must connect a wallet to receive payments. Without a connected wallet, you won&apos;t be able to receive payments for completed deals.
            </AlertDescription>
          </Alert>
        )}

        {/* Profile Section */}
        <div className="p-4 bg-white rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Edit2 className="w-5 h-5 text-gray-600" />
            Profile Information
          </h2>
          <p className="text-gray-700">Update your profile details.</p>
          <Button
            variant="outline"
            className="w-full mt-2 flex items-center justify-center space-x-2"
            onClick={() => router.push(JOIN_ROUTE + '?edit=true')}
          >
            <Edit2 className="w-4 h-4" />
            <span>Edit Profile</span>
          </Button>
        </div>

        {/* Payment Wallet Section */}
        <div className={`p-4 bg-white rounded-lg shadow-md space-y-4 ${isWalletMissing ? 'border-2 border-red-200' : ''}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Wallet className="w-5 h-5 text-gray-600" />
              Payment Wallet
            </h2>
            {walletAddress && !isLoading && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <CheckCircle className="w-4 h-4" />
                Connected
              </span>
            )}
          </div>

          <div className="text-sm text-gray-700 space-y-2">
            <p>Your payment wallet is essential for:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Receiving payments for completed deals</li>
              <li>Secure transaction processing</li>
              <li>Managing your earnings</li>
            </ul>
          </div>

          {walletAddress ? (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium text-gray-600">Current Wallet</span>
                </div>
                <code className="bg-white px-2 py-1 rounded text-sm font-mono text-gray-800">
                  {toFriendlyAddress(walletAddress)}
                </code>
              </div>
              <Button
                variant="outline"
                className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={handleDisconnectWallet}
              >
                Disconnect Wallet
              </Button>
            </div>
          ) : (
            <>
              <Alert className="bg-amber-50 border-amber-200">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  No wallet connected. Connect your wallet to start receiving payments.
                </AlertDescription>
              </Alert>
              <TonConnectButton className="w-full mx-auto" />
            </>
          )}

          <div className="text-sm text-gray-500 mt-2">
            Note: Make sure to connect the wallet you want to use for receiving payments.
          </div>
        </div>
      </div>

      {/* Sticky bottom button */}
      <div className="w-full bg-white p-4 pb-1">
        <PrimaryBtn
          text="Go Back"
          customProperties="w-full justify-center"
          onClick={() => router.back()}
        />
      </div>
    </div>
  );
}

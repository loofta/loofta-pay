'use client';

import { useTonAddress, useTonConnectModal, useTonConnectUI } from "@tonconnect/ui-react";
import { Button } from "@/components/ui/button";
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import PrimaryBtn from "@/components/PrimaryBtn";
import { Repeat, Twitter, UserPlus, FileText, MessageSquareIcon, ArrowLeftRight, EditIcon, HelpCircle } from "lucide-react"; // Added FileText icon
import { useToast } from "@/components/ui/use-toast";
import MobilePillMenu from "@/components/BottomMenu";
import Title from "@/components/Title";
import SecondaryBtn from "@/components/SecondaryBtn";
import Link from 'next/link'; // Import Link for internal navigation
import { JOIN_ROUTE, LOGIN_ROUTE, PROFILE_ROUTE, TROUBLESHOOT_ROUTE } from "../utils/routes";
import { updateFreelancerTelegramAndWalletAddress, getFreelancerByTelegramData } from "../actions/freelancers/freelancers";
import { useTelegramUser } from "@/context/TelegramUserContext";

export default function SupportPage() {
  const { open, close } = useTonConnectModal();
  const walletAddress = useTonAddress(true);
  const [tonConnectUI] = useTonConnectUI();
  const router = useRouter();
  const { toast } = useToast();
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<string>(''); // 
  const [profileModalOpen, setProfileModalOpen] = useState(false); // Profile modal state
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false); // Disconnect modal state
  const { userData } = useTelegramUser();
  const [storedFreelancerProfile, setStoredFreelancerProfile] = useState<string | null>(null);

  useEffect(() => {
    if (walletAddress) {

      setIsConnected(true);
    } else {
      false
      setIsConnected(true);
    }
    // Fetch profile from storage
    const storedProfile = window.Telegram?.WebApp?.storage?.getItem('profile') || localStorage.getItem('profile');
    if (storedProfile) {
      setProfile(storedProfile);
    } else {
      setProfile('freelancer'); // Default profile
    }
  }, [walletAddress]);

  useEffect(() => {
    const profile = window.Telegram?.WebApp?.storage?.getItem('freelancerProfile') ||
      localStorage.getItem('freelancerProfile');
    setStoredFreelancerProfile(profile);
  }, []);

  const handleDisconnect = async () => {
    await tonConnectUI.disconnect(); // Disconnect the wallet
    toast({
      title: "Wallet Disconnected",
      description: "You have been disconnected from your wallet.",
    });
    setIsConnected(false);
  };

  const handleConnectWallet = () => {
    open();
  };

  const handleSwitchProfile = () => {
    const newProfile = profile === 'client' ? 'freelancer' : 'client';
    setProfile(newProfile);

    // Save profile to storage
    window.Telegram?.WebApp?.storage?.setItem('profile', newProfile);
    localStorage.setItem('profile', newProfile);

    toast({
      title: "Profile Updated",
      description: `Successfully switched to ${newProfile === 'client' ? 'Client' : 'Creator'}.`,
    });

    setProfileModalOpen(false); // Close modal after switch
  };

  const handleUpdateFreelancerData = async () => {
    if (!userData?.id || !userData?.username?.toLowerCase()) {
      toast({
        title: "User Data Not Available",
        description: "Please make sure your Telegram account is connected to update.",
        variant: "destructive",
      });
      return;
    }
    try {
      if (profile === 'freelancer') {
        // Fetch freelancer by telegram handle
        console.log('userData', userData);
        const freelancer = await getFreelancerByTelegramData(userData.id || 0);

        if (freelancer) {
          // Update freelancer data
          await updateFreelancerTelegramAndWalletAddress(freelancer.id, userData.id, walletAddress);

          toast({
            title: "Freelancer Data Updated",
            description: "Your Telegram ID and wallet address have been updated.",
          });
        } else {
          toast({
            title: "Freelancer Not Found",
            description: "No freelancer found with the provided Telegram handle: @" + userData?.username.toLowerCase(),
          });
        }
      } else {
        toast({
          title: "Not a Freelancer",
          description: "Switch to Freelancer profile to update data.",
        });
      }
    } catch (error) {
      console.error('Error updating freelancer data:', error);
      toast({
        title: "Update Failed",
        description: "There was an error updating your data. Please try again.",
      });
    }
  };

  const handleClearCache = async () => {

    await tonConnectUI.disconnect().then(() => {
      setIsConnected(false);
      localStorage.clear();
      window.Telegram?.WebApp?.storage?.clear();
      window.Telegram?.WebApp?.close();
      router.push('/');
    });

  };

  return (
    <div className="tg-webview h-screen flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4 mt-8 px-4 mx-0">
        <Title text="Settings" showWallet={false} customProperties="mx-4" />

        {/* Join as Freelancer Section */}
        {profile === 'freelancer' && (

          <div className="p-4 bg-white rounded-lg shadow-md space-y-4">
            {storedFreelancerProfile ? (
              <>

                <h2 className="text-xl font-semibold">👩‍💻 Your Profile</h2>
                <p className="text-gray-700">Update your details to stay visible and connected.</p>

                <Button
                  variant="outline"
                  className="w-full mt-2  flex items-center justify-center space-x-2"
                  onClick={() => router.push(PROFILE_ROUTE)}
                >
                  <EditIcon className="w-5 h-5" />
                  <span>Profile Settings</span>
                </Button></>
            ) : (
              <>
                <h2 className="text-xl font-semibold">Join Loofta</h2>
                <p className="text-gray-700">Start earning by offering your services on Loofta.</p>
                <Button
                  variant="outline"
                  className="w-full mt-2 bg-orange-100 flex items-center justify-center space-x-2"
                  onClick={() => router.push(JOIN_ROUTE)}
                >
                  <UserPlus className="w-5 h-5" />
                  <span>Become a KOL/Creator</span>
                </Button>
              </>
            )}

          </div>
        )}

        {/* Join as Freelancer Section */}
        {profile === 'client' && (
          <div className="p-4 bg-white rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold">👤 User profile</h2>
            <p className="text-gray-700">Your user is linked to the Telegram account: <span className="font-medium">@{userData?.username?.toLowerCase()}</span>  </p>
            <Button
              variant="outline"
              className="w-full mt-2 bg-orange-100 flex items-center justify-center space-x-2"
              onClick={() => router.push(LOGIN_ROUTE)}
            >

              <span>Disconnect</span>
            </Button>
          </div>
        )}

        {/* New Button to Update Freelancer Data */}
        {/*    <div className="p-4 bg-white rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold">Refresh Freelancer Data</h2>
          <Button
            variant="outline"
            className="w-full mt-2"
            onClick={handleUpdateFreelancerData}
          >
            Update Telegram and Wallet Address
          </Button>
        </div> */}

        {/* Connect with Community Section */}
        <div className="p-4 bg-white rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold">🤝 Connect with our Community</h2>
          <p className="text-gray-700">Support available 24/7 - replies within 2 hours.</p>
          <Button
            variant="outline"
            className="w-full mt-2"
            onClick={() => window.open('https://t.me/loofta', '_blank')}
          >
            Join Loofta Telegram Channel
          </Button>
          <Button
            variant="outline"
            className="w-full mt-2"
            onClick={() => window.open('https://t.me/looftaxyz', '_blank')}
          >
            <MessageSquareIcon className="w-4 h-4 inline-block mr-2" />
            Contact us on Telegram
          </Button>
        </div>

        {/* Support Us Section */}
        <div className="p-4 bg-white rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold">🧡 Support Us</h2>
          <Button
            variant="outline"
            className="flex items-center justify-center w-full space-x-2"
            onClick={() => window.open('https://twitter.com/looftaxyz', '_blank')}
          >
            <Twitter className="w-5 h-5" />
            <span>Follow us on Twitter</span>
          </Button>
        </div>

        {/* Tokenomics Section */}
        <div className="p-4 bg-white rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold">🔄 Switch Profile</h2>
          <p className="text-gray-700">Switch between Client and Creator profiles.</p>
          {/* Switch Profile Button */}
          <SecondaryBtn
            icon={Repeat}
            text={`Switch to ${profile === 'client' ? 'Creator' : 'Client'}`}
            onClick={() => setProfileModalOpen(true)} // Open Profile Modal
          />
        </div>

        {/* About Us Section */}
        <div className="p-4 bg-white rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold">📄 About Us</h2>
          <Button
            variant="outline"
            className="w-full mt-2"
            onClick={() => window.open('https://loofta.xyz/whitepaper', '_blank')}
          >
            Read our Whitepaper
          </Button>
          {/*   <Button
            variant="outline"
            className="w-full mt-2"
            onClick={() => window.open('https://loofta.xyz/tokenomics', '_blank')}
          >
            Explore our Tokenomics
          </Button> */}
        </div>

        {/* New Section: Terms and Conditions */}
        <div className="p-4 bg-white rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold">📜 Terms and Conditions</h2>
          <p className="text-gray-700">
            By using Loofta, you agree to our <Link href="https://loofta.xyz/terms-and-conditions" target="_blank" className="underline">Terms and Conditions</Link>. Please read them carefully before proceeding.
          </p>
        </div>

        {/* Replace the Clear Cache section with Troubleshooting */}
        <div className="bg-white rounded-lg p-4 shadow-sm border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <HelpCircle className="w-5 h-5 text-blue-500" />
              <h2 className="text-base font-medium text-gray-800">Need Help?</h2>
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Having issues? Check our troubleshooting guide for common problems and solutions.
          </p>
          <Button
            variant="outline"
            onClick={() => router.push(TROUBLESHOOT_ROUTE)}
            className="w-full justify-between"
          >
            <span>View Troubleshooting Guide</span>
            <ArrowLeftRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Add this new section after Terms & Conditions */}
        <div className="mt-8 p-4 bg-white rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold">⚙️ Advanced Settings</h2>
          <div className="space-y-4">
            <div className="border-t pt-4">
              <p className="text-sm text-gray-600 mb-4">
                Clear all local storage data and reset the application. This will log you out and remove all cached data.
              </p>
              <button
                onClick={handleClearCache}
                className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg transition duration-200 flex items-center justify-center gap-2"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
                Clear Cache & Reload
              </button>
            </div>
          </div>
        </div>

        {/* Profile Switch Modal */}
        {profileModalOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[50]"
              onClick={() => setProfileModalOpen(false)}
            />
            <div className="fixed bottom-0 left-0 right-0 z-[51] p-6 bg-white rounded-t-2xl shadow-xl animate-slide-up">
              <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-6" />

              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold mb-2">Switch Profile</h2>
                <p className="text-gray-600">
                  Are you sure you want to switch to {profile === 'client' ? 'Creator' : 'Client'} mode?
                </p>
              </div>

              <div className="space-y-3">
                <PrimaryBtn
                  text={`Yes, switch to ${profile === 'client' ? 'Creator' : 'Client'}`}
                  customProperties="w-full justify-center"
                  onClick={handleSwitchProfile}
                />
                <SecondaryBtn
                  text="Cancel"
                  customProperties="w-full justify-center"
                  onClick={() => setProfileModalOpen(false)}
                />
              </div>
            </div>
          </>
        )}


      </div>

      {/* Bottom Menu - Hide when modal is open */}
      <div className={profileModalOpen ? 'hidden' : 'block'}>
        <MobilePillMenu />
      </div>
    </div>
  );
}

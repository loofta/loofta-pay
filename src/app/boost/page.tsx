"use client";

import { useState } from 'react';
import { Zap, Users, Check, Clock, Shield, Wallet, History } from 'lucide-react';
import PrimaryBtn from "@/components/PrimaryBtn";
import { Input } from "@/components/ui/input";
import DashboardLayout from '@/components/layouts/DashboardLayout';
import Title from '@/components/Title';
import { toast } from "@/components/ui/use-toast";
import { useWallet } from '@/hooks/useWallet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { usePayment } from '@/hooks/usePayment';
import { BOOST_PRICE, PAYMENT_ADDRESSES } from '@/lib/constants';
import { createBoost, deleteBoost, updateBoostStatus } from '@/app/actions/boosts/boosts';
import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import confetti from 'canvas-confetti';

const TARAXA_NETWORK = {
  chainId: '0x349', // 841 in hex
  chainName: 'Taraxa Mainnet',
  nativeCurrency: {
    name: 'TARA',
    symbol: 'TARA',
    decimals: 18,
  },
  rpcUrls: ['https://rpc.mainnet.taraxa.io/'],
  blockExplorerUrls: ['https://explorer.mainnet.taraxa.io/'],
};

const ETH_NETWORK = {
  chainId: '0x1', // 1 in hex
  chainName: 'Ethereum Mainnet',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['https://eth.llamarpc.com'],
  blockExplorerUrls: ['https://etherscan.io'],
};

const validatePostLink = (link: string): boolean => {
  // Remove any whitespace
  const trimmedLink = link.trim();

  // Regular expression to match X post URLs
  // Matches:
  // - x.com/username/status/...
  // - twitter.com/username/status/...
  // - https://x.com/username/status/...
  // - https://twitter.com/username/status/...
  const xPostRegex = /^(https?:\/\/)?(www\.)?(x\.com|twitter\.com)\/[a-zA-Z0-9_]{1,15}\/status\/[0-9]+(\/)?$/;

  return xPostRegex.test(trimmedLink);
};

export default function BoostPost() {
  const [postLink, setPostLink] = useState('');
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState<'taraxa' | 'eth' | null>(null);
  const [selectedToken, setSelectedToken] = useState<'USDT'>('USDT');
  const { isWalletConnected, isLoading: isWalletLoading } = useWallet();
  const { makePayment, isLoading: isPaymentLoading } = usePayment();
  const [boostId, setBoostId] = useState<string | null>(null);
  const { user } = usePrivy();

  const switchToTaraxaNetwork = async (provider: any) => {
    if (!provider) return false;

    try {
      // First try to switch to the network
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: TARAXA_NETWORK.chainId }],
      });
      return true;
    } catch (switchError: any) {
      // This error code indicates that the chain has not been added to MetaMask
      if (switchError.code === 4902) {
        try {
          // Add the network to MetaMask
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [TARAXA_NETWORK],
          });
          return true;
        } catch (addError) {
          console.error('Error adding Taraxa network:', addError);
          return false;
        }
      }
      console.error('Error switching to Taraxa network:', switchError);
      return false;
    }
  };

  const handleSubmit = () => {
    if (!postLink) {
      toast({
        title: "Error",
        description: "Please enter a post link",
        variant: "destructive",
      });
      return;
    }

    if (!validatePostLink(postLink)) {
      toast({
        title: "Invalid Post Link",
        description: "Please enter a valid X (Twitter) post URL in the format: x.com/username/status/...",
        variant: "destructive",
      });
      return;
    }

    setShowNetworkModal(true);
  };

  const handleNetworkSelect = (network: 'taraxa' | 'eth') => {
    setSelectedNetwork(network);
    setShowNetworkModal(false);
    setSelectedToken('USDT');
    setShowPaymentModal(true);
  };

  const handlePay = async () => {
    if (!isWalletConnected) {
      toast({
        title: "Error",
        description: "Please connect your wallet first",
        variant: "destructive",
      });
      return;
    }

    if (!user?.id) {
      toast({
        title: "Error",
        description: "Please sign in first",
        variant: "destructive",
      });
      return;
    }

    try {
      // Create boost record with pending status
      const result = await createBoost({
        postLink,
        userId: user.id,
        amount: BOOST_PRICE,
        currency: selectedToken,
        status: 'pending'
      });

      if (!result.success || !result.boost) {
        toast({
          title: "Error",
          description: "Failed to create boost record",
          variant: "destructive",
        });
        return;
      }

      setBoostId(result.boost.id);
      if (!selectedNetwork) {
        toast({
          title: "Error",
          description: "Please select a network",
          variant: "destructive",
        });
        return;
      }

      const paymentHash = await makePayment({
        amount: BOOST_PRICE.toString(),
        currency: selectedToken,
        network: selectedNetwork,
        recipient: PAYMENT_ADDRESSES[selectedNetwork]
      });

      setShowPaymentModal(false);

      if (!paymentHash) {
        toast({
          title: "Error",
          description: "Payment failed. Please try again.",
          variant: "destructive"
        });
        deleteBoost(result.boost.id);
      }
      // Update boost status to paid
      await updateBoostStatus(result.boost.id, 'paid', paymentHash);


      // Trigger confetti animation
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });

      toast({
        title: "Success",
        description: "Payment successful! Your post will start getting boosted soon.",
        variant: "default"
      });
    } catch (error) {
      console.error('Payment error:', error);

      // Update boost status to failed if it exists
      if (boostId) {
        await updateBoostStatus(boostId, 'failed');
      }

      toast({
        title: "Error",
        description: "Payment failed. Please try again.",
        variant: "destructive"
      });
    }
  };

  return (
    <DashboardLayout>
      <div className='h-screen tg-webview flex flex-col relative'>
        <div className='flex-1 overflow-y-auto p-4'>
          <Title text="Boost Post" showWallet={false} showPrevious={true} />

          <div className="max-w-4xl mx-auto">
            {/* Header Section */}
            <div className="mb-8">
              <div className="flex justify-end mb-4">
                <Link href="/boost/history">
                  <Button className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white shadow-sm">
                    <History className="w-4 h-4" />
                    View Boost History
                  </Button>
                </Link>
              </div>
            </div>

            {/* Service Overview */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/75 mb-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-gradient-to-br from-orange-100 to-orange-50 p-2.5 rounded-xl">
                  <Zap className="h-7 w-7 text-orange-600" />
                </div>
                <h2 className="text-xl font-semibold">Get More Engagement</h2>
              </div>
              <p className="text-gray-600 mb-6">
                For just {BOOST_PRICE} USDT, we'll engage real Web3 users to like, comment, and retweet your post. Our service ensures organic growth through genuine interactions from active community members. You'll receive detailed analytics and can track the progress of your boost in real-time through our dashboard. Payment available on both Taraxa and Ethereum networks.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-orange-50 p-4 rounded-xl border border-orange-100">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="h-5 w-5 text-orange-600" />
                    <span className="font-medium text-orange-700">100+ Engagement</span>
                  </div>
                  <p className="text-sm text-orange-600">Likes, comments & retweets</p>
                </div>
                <div className="bg-orange-50 p-4 rounded-xl border border-orange-100">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-5 w-5 text-orange-600" />
                    <span className="font-medium text-orange-700">24 Hours</span>
                  </div>
                  <p className="text-sm text-orange-600">Results guaranteed</p>
                </div>
                <div className="bg-orange-50 p-4 rounded-xl border border-orange-100">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-5 w-5 text-orange-600" />
                    <span className="font-medium text-orange-700">No Bots</span>
                  </div>
                  <p className="text-sm text-orange-600">Only real Web3 users</p>
                </div>
              </div>
            </div>

            {/* Post Link Form */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/75">
              <h3 className="text-lg font-medium mb-4">Enter Post URL</h3>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">
                    X (Twitter) Post Link
                  </label>
                  <Input
                    type="url"
                    placeholder="https://x.com/username/status/..."
                    value={postLink}
                    onChange={(e) => setPostLink(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-lg font-bold text-orange-600">{BOOST_PRICE} USDT</div>
                    <div className="text-sm text-gray-500">per boost</div>
                  </div>
                  <PrimaryBtn
                    text="Boost Now"
                    onClick={handleSubmit}
                    customProperties="w-fit px-6"
                    icon={Zap}
                    disabled={!postLink.trim() || !validatePostLink(postLink)}
                  />
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* Network Selection Modal */}
        <Dialog open={showNetworkModal} onOpenChange={setShowNetworkModal}>
          <DialogContent className="sm:max-w-[425px] fixed animate-in fade-in-0 zoom-in-95 duration-200">
            <DialogHeader>
              <DialogTitle>Select Network</DialogTitle>
              <DialogDescription>
                Choose your preferred network for payment
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <button
                onClick={() => handleNetworkSelect('taraxa')}
                className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:border-orange-200 hover:bg-orange-50 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-orange-50 p-2 rounded-lg">
                    <img src="/images/taraxa.png" alt="Taraxa" className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium">Taraxa (Tether USDT)</p>
                    <p className="text-sm text-gray-500">Pay with MetaMask</p>
                  </div>
                </div>
                <div className="text-orange-600">→</div>
              </button>
              <button
                onClick={() => handleNetworkSelect('eth')}
                className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:border-orange-200 hover:bg-orange-50 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-blue-50 p-2 rounded-lg">
                    <img src="/images/eth.png" alt="Ethereum" className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium">Ethereum (Tether USDT)</p>
                    <p className="text-sm text-gray-500">Pay with MetaMask</p>
                  </div>
                </div>
                <div className="text-orange-600">→</div>
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Payment Modal */}
        <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
          <DialogContent className="sm:max-w-[425px] fixed animate-in fade-in-0 zoom-in-95 duration-200">
            <DialogHeader>
              <DialogTitle>Payment Details</DialogTitle>
              <DialogDescription>
                Complete your payment to boost your post
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-600">Post Link</span>
                  <span className="font-medium truncate max-w-[200px]">{postLink}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-600">Network</span>
                  <span className="font-medium">{selectedNetwork === 'taraxa' ? 'Taraxa' : 'Ethereum'}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-600">Amount</span>
                  <span className="font-medium">{BOOST_PRICE} {selectedToken}</span>
                </div>
              </div>
              <div className="space-y-2">
                <button
                  onClick={handlePay}
                  disabled={isPaymentLoading}
                  className="w-full flex items-center justify-center gap-2 p-4 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Wallet className="w-5 h-5" />
                  {isPaymentLoading ? "Please wait..." : `Pay Now`}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
} 
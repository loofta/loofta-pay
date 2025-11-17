import { useState } from 'react';
import { toast } from '@/components/ui/use-toast';
import { ethers } from 'ethers';
import { env } from 'process';

declare global {
  interface Window {
    ethereum?: Record<string, unknown>;
  }
}

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

// USDT Contracts
const USDT_CONTRACTS = {
  taraxa: "0x69D411CbF6dBaD54Bfe36f81d0a39922625bC78c",
  eth: "0xdAC17F958D2ee523a2206206994597C13D831ec7" // Ethereum Mainnet USDT
};

const USDT_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];



interface PaymentConfig {
  amount: string;
  currency: "USDT";
  network: "taraxa" | "eth";
  recipient: string;
  privyId?: string;
  userId?: string;
}

export function usePayment() {
  const [isLoading, setIsLoading] = useState(false);

  const getWalletProvider = async () => {
    if (!window.ethereum) {
      throw new Error("No Ethereum provider found");
    }
    
    try {
      const provider = new ethers.BrowserProvider(window.ethereum as any);
      return provider.getSigner();
    } catch (error) {
      console.error('Error creating provider:', error);
      throw new Error("Failed to connect to wallet provider");
    }
  };

  const switchToNetwork = async (provider: any, network: "taraxa" | "eth") => {
    if (!provider) {
      console.error('No provider available');
      return false;
    }

    const networkConfig = network === "taraxa" ? TARAXA_NETWORK : ETH_NETWORK;
    console.log('Switching to network:', network);
    console.log('Network config:', networkConfig);

    try {
      // Check current network first
      const currentChainId = await provider.request({ method: 'eth_chainId' });
      console.log('Current chain ID:', currentChainId);
      console.log('Target chain ID:', networkConfig.chainId);
      
      if (currentChainId === networkConfig.chainId) {
        console.log('Already on correct network');
        return true;
      }

      console.log('Attempting to switch network...');
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: networkConfig.chainId }],
      });
      console.log('Network switch successful');
      return true;
    } catch (switchError: any) {
      console.log('Switch error code:', switchError.code);
      console.log('Switch error message:', switchError.message);
      
      if (switchError.code === 4902) {
        console.log('Network not found, attempting to add...');
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [networkConfig],
          });
          console.log('Network added successfully');
          return true;
        } catch (addError) {
          console.error(`Error adding ${network} network:`, addError);
          return false;
        }
      }
      console.error(`Error switching to ${network} network:`, switchError);
      return false;
    }
  };

  const makePayment = async (config: PaymentConfig) => {
    setIsLoading(true);
    try {
      const signer = await getWalletProvider();
      if (!signer) {
        throw new Error("No signer available");
      }

      // Switch to selected network
      console.log('Attempting to switch to network:', config.network);
      const switched = await switchToNetwork(window.ethereum, config.network);
      console.log('Network switch result:', switched);
      if (!switched) {
        throw new Error(`Failed to switch to ${config.network} network`);
      }

      if (process.env.NODE_ENV === "development") {
        config.amount = "1";
      } 
      // Format amount with correct decimals
      const formattedAmount = ethers.parseUnits(config.amount.toString(), 6);

      // Get the appropriate contract based on network
      const contractAddress = USDT_CONTRACTS[config.network];
      console.log('Using contract address:', contractAddress);
      console.log('Network:', config.network);
      console.log('Currency:', config.currency);
      const contractABI = USDT_ABI;
      const contract = new ethers.Contract(contractAddress, contractABI, signer);

      // Check balance
      const balance = await contract.balanceOf(await signer.getAddress());
      console.log('Balance:', ethers.formatUnits(balance, 6));
      console.log('Required amount:', ethers.formatUnits(formattedAmount, 6));
      
      if (balance < formattedAmount) {
        throw new Error(`Insufficient ${config.currency} balance. Required: ${ethers.formatUnits(formattedAmount, 6)} ${config.currency}, Available: ${ethers.formatUnits(balance, 6)} ${config.currency}`);
      }

      // Direct transfer - no approval needed
      // We use direct transfer instead of approve + transfer to avoid wallet security warnings
      // about EOA approvals that can look suspicious to users
      console.log('Creating transfer transaction...');
      console.log('Recipient:', config.recipient);
      console.log('Amount:', ethers.formatUnits(formattedAmount, 6));
      
      const tx = await contract.transfer(config.recipient, formattedAmount);
      console.log('Transaction sent:', tx.hash);
      
      const receipt = await tx.wait();
      console.log('Transaction confirmed:', receipt.hash);
      
      return receipt.hash;
    } catch (error) {
      console.error('Payment error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };


  return { makePayment, isLoading };
} 
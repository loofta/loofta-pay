import { useTonAddress, useTonConnectModal, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { useState } from "react";
import axios from "axios";
import TonWeb from "tonweb";
import { updateDealPaymentStatus, updateDealStatus, updateDealTx } from "@/app/actions/deals/deals";
import { toast } from "@/components/ui/use-toast";
import { Address, beginCell, toNano } from "@ton/core";
import { GIVEAWAY__FEE, UNLOCK_CREATORS_ACCESS_AMOUNT, usdtToFriendlyUnits } from "@/lib/utils";
import { whitelistNewClient } from "@/app/actions/freelancers/freelancers";

const useSendPayment = () => {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const { open } = useTonConnectModal();
  const userFriendlyAddress = useTonAddress();
  const platformFeePercentage = 3; // 3% platform fee
  const platformWalletAddress = "UQCmXf2tAb63DYnOVSrSWHhxBuze6Nu_z8Qqzkm9f8GJNMtz"; // Platform wallet address

  const sendPayment = async (description: string, amount: string, recipientWalletAddress: string, generatedId: string) => {
    if (wallet === null) {
      open();
      return false;
    }
    await updateDealPaymentStatus(generatedId, 'paid', "");
    await updateDealStatus(generatedId, 'done');
    const forwardPayload = beginCell()
      .storeUint(0, 32)
      .storeStringTail("Payment for deals - Loofta")
      .endCell();

      const recipientWalletAddressParsed = Address.parse(recipientWalletAddress);
      const platformWalletAddressParsed = Address.parse(platformWalletAddress);

      if (!process.env.NEXT_PUBLIC_USDT_JETTON_ADDRESS) {
      return;
      }

      const tonweb = new TonWeb(new TonWeb.HttpProvider(process.env.NEXT_PUBLIC_TON_HTTP_PROVIDER));
    let jettonWallet;
    let myTransaction;

    try {
      // Fetch the Jetton Wallet address for the sender
     // @ts-ignore 
      const jettonMinter = new TonWeb.token.jetton.JettonMinter(tonweb.provider, { address: new TonWeb.utils.Address(process.env.NEXT_PUBLIC_USDT_JETTON_ADDRESS) });
        // @ts-ignore 
      const address = await jettonMinter.getJettonWalletAddress(new TonWeb.utils.Address(userFriendlyAddress), new TonWeb.utils.Address(recipientWalletAddressParsed));
      jettonWallet = new TonWeb.token.jetton.JettonWallet(tonweb.provider, { address: address });

      if (jettonWallet.address === undefined) {
        return;
      }

      const data = await jettonWallet.getData();
      const balanceAvailable = data.balance;
      const amountParsed = usdtToFriendlyUnits(Number.parseFloat(amount));

      // Calculate the platform fee
      const platformFee = (amountParsed * platformFeePercentage) / 100;

      if (balanceAvailable < amountParsed + platformFee) {
        toast({ description: "Insufficient balance", variant: "destructive" });
        return false;
      }

      // Create the transaction body for the recipient
      const bodyRecipient = beginCell()
        .storeUint(0xf8a7ea5, 32)
        .storeUint(0, 64)
        .storeCoins(amountParsed) // Amount sent to the recipient
        .storeAddress(recipientWalletAddressParsed)
        .storeAddress(recipientWalletAddressParsed)
        .storeBit(0)
        .storeCoins(toNano(0.02))
        .storeBit(1)
        .storeRef(forwardPayload)
        .endCell();

      // Create the transaction body for the platform fee
      const bodyPlatform = beginCell()
        .storeUint(0xf8a7ea5, 32)
        .storeUint(0, 64)
        .storeCoins(platformFee) // Platform fee sent to platform wallet
        .storeAddress(platformWalletAddressParsed)
        .storeAddress(platformWalletAddressParsed)
        .storeBit(0)
        .storeCoins(toNano(0.02))
        .storeBit(1)
        .storeRef(forwardPayload)
        .endCell();

      // Create a transaction with two messages: one for the recipient and one for the platform fee
      myTransaction = {
        validUntil: Math.floor(Date.now() / 1000) + 360,
        messages: [
          {
            address: jettonWallet.address.toString(),
            amount: toNano(0.1).toString(),
            payload: bodyRecipient.toBoc().toString("base64"),
          }
        ]
      };

      console.log("Sending transaction:", myTransaction);
      const tx = await tonConnectUI.sendTransaction(myTransaction);
      await updateDealTx(generatedId, tx.boc);
      console.log('Transaction data:', tx.boc);
      const boc = tx.boc;
      
      let transactionHashBase64;
      try {
        const bocCellBytes = await TonWeb.boc.Cell.oneFromBoc(TonWeb.utils.base64ToBytes(boc)).hash();
        transactionHashBase64 = TonWeb.utils.bytesToBase64(bocCellBytes);
      } catch (error) {
        console.error("=== Decode BOC error : ", error);
        return false;
      }

      await updateDealPaymentStatus(generatedId, 'paid', transactionHashBase64);

      return true;  // Return success once transaction is sent

    } catch (error) {
      console.error("Error sending transaction:", error);
      await updateDealPaymentStatus(generatedId, 'unpaid', "");
      toast({ description: "Error sending transaction", variant: "destructive" });
      return false;
    }
  };

  const verifyPaymentStatus = async (generatedId: string, transactionHash: string | undefined) => {
    try {
        const res = await axios.get(`https://tonapi.io/v2/blockchain/transactions/${transactionHash}`);
        
      if (res.data && res.data.success) {
            await updateDealPaymentStatus(generatedId, 'paid', transactionHash);
            return true;
        } else if (res.data && res.data.aborted) {
            await updateDealPaymentStatus(generatedId, 'paid', transactionHash);
            return false;
        }

        return false;
    } catch (error) {
        console.error('Error checking transaction status:', error);
        return false;
    }
};

  const sendGiveawayPayment = async (amount: number, taskCount: number) => {
    try {
      if (!wallet) {
        toast({ 
          title: "Wallet not connected",
          description: "Please install TonKeeper and connect your wallet first", 
          variant: "destructive" 
        });
        // Wait a bit before opening connect modal to allow toast to be seen
        setTimeout(() => {
          open();
        }, 1500);
        return false;
      }

      if (!userFriendlyAddress) {
        throw new Error('Wallet address not found');
      }

      // const totalAmount = amount + GIVEAWAY__FEE;
      const totalAmount = 1;
      const recipientWalletAddress = "UQAdFe6F7DRQMQhJI2dUjKiMhU-oa5G9LNP8OAoWZ1LX2ILj";

      const forwardPayload = beginCell()
        .storeUint(0, 32)
        .storeStringTail("Giveaway Creation Payment - Loofta")
        .endCell();

      const recipientWalletAddressParsed = Address.parse(recipientWalletAddress);
      
      if (!process.env.NEXT_PUBLIC_USDT_JETTON_ADDRESS) {
        throw new Error('USDT contract address not configured');
      }

      const tonweb = new TonWeb(new TonWeb.HttpProvider('https://toncenter.com/api/v2/jsonRPC', {
        apiKey: "85a70c88d6931f81c89af32f6b29c34c3b738534c385ba1303097aa0e8887ccf"
      }));

      // @ts-ignore
      const jettonMinter = new TonWeb.token.jetton.JettonMinter(tonweb.provider, { 
        address: new TonWeb.utils.Address(process.env.NEXT_PUBLIC_USDT_JETTON_ADDRESS) 
      });
      
      const address = await jettonMinter.getJettonWalletAddress(new TonWeb.utils.Address(userFriendlyAddress));
      if (!address) {
        throw new Error('Could not get jetton wallet address');
      }

      const jettonWallet = new TonWeb.token.jetton.JettonWallet(tonweb.provider, { address });
      const data = await jettonWallet.getData();
      const balanceAvailable = data.balance;
      const amountParsed = usdtToFriendlyUnits(totalAmount);

      if (balanceAvailable < amountParsed) {
        toast({ description: "Insufficient balance, top up your wallet and try again", variant: "destructive" });
        return false;
      }

      const body = beginCell()
        .storeUint(0xf8a7ea5, 32)
        .storeUint(0, 64)
        .storeCoins(amountParsed)
        .storeAddress(recipientWalletAddressParsed)
        .storeAddress(recipientWalletAddressParsed)
        .storeBit(0)
        .storeCoins(toNano(0.02))
        .storeBit(1)
        .storeRef(forwardPayload)
        .endCell();

      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 360,
        messages: [
          {
            address: address.toString(),
            amount: toNano(0.1).toString(),
            payload: body.toBoc().toString("base64"),
          }
        ]
      };

      const result = await tonConnectUI.sendTransaction(transaction);
      return result.boc;

    } catch (error: any) {
      console.error("Error sending giveaway payment:", error);
      
      // Handle specific error cases
      if (error.message?.includes('scheme does not have a registered handler')) {
        toast({ 
          title: "TonKeeper not found",
          description: "Please install TonKeeper wallet to continue", 
          variant: "destructive" 
        });
        // Open TonKeeper website in new tab
        window.open('https://tonkeeper.com/', '_blank');
        return false;
      }

      toast({ 
        description: error.message || "Error sending payment. Please try again.", 
        variant: "destructive" 
      });
      return false;
    }
  };

  const sendUnlockPayment = async (userId: number, username: string) => {
    try {
      if (!wallet) {
        toast({ 
          title: "Wallet not connected",
          description: "Please install TonKeeper and connect your wallet first", 
          variant: "destructive" 
        });
        // Wait a bit before opening connect modal to allow toast to be seen
        setTimeout(() => {
          open();
        }, 1500);
        return false;
      }

      if (!userFriendlyAddress) {
        throw new Error('Wallet address not found');
      }

      const recipientWalletAddress = "UQAdFe6F7DRQMQhJI2dUjKiMhU-oa5G9LNP8OAoWZ1LX2ILj";
      const amount = UNLOCK_CREATORS_ACCESS_AMOUNT; // 59 USDT

      const forwardPayload = beginCell()
        .storeUint(0, 32)
        .storeStringTail("Unlock Creators Access - Loofta")
        .endCell();

      const recipientWalletAddressParsed = Address.parse(recipientWalletAddress);
      
      if (!process.env.NEXT_PUBLIC_USDT_JETTON_ADDRESS) {
        throw new Error('USDT contract address not configured');
      }

      const tonweb = new TonWeb(new TonWeb.HttpProvider(process.env.NEXT_PUBLIC_TON_HTTP_PROVIDER));
      // @ts-ignore
      const jettonMinter = new TonWeb.token.jetton.JettonMinter(tonweb.provider, { 
        address: new TonWeb.utils.Address(process.env.NEXT_PUBLIC_USDT_JETTON_ADDRESS) 
      });
      
      const address = await jettonMinter.getJettonWalletAddress(new TonWeb.utils.Address(userFriendlyAddress));
      if (!address) {
        throw new Error('Could not get jetton wallet address');
      }

      const jettonWallet = new TonWeb.token.jetton.JettonWallet(tonweb.provider, { address });
      const data = await jettonWallet.getData();
      const balanceAvailable = data.balance;
      const amountParsed = usdtToFriendlyUnits(amount);

      if (balanceAvailable < amountParsed) {
        toast({ description: "Insufficient balance", variant: "destructive" });
        return false;
      }

      const body = beginCell()
        .storeUint(0xf8a7ea5, 32)
        .storeUint(0, 64)
        .storeCoins(amountParsed)
        .storeAddress(recipientWalletAddressParsed)
        .storeAddress(recipientWalletAddressParsed)
        .storeBit(0)
        .storeCoins(toNano(0.02))
        .storeBit(1)
        .storeRef(forwardPayload)
        .endCell();

      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 360,
        messages: [
          {
            address: address.toString(),
            amount: toNano(0.1).toString(),
            payload: body.toBoc().toString("base64"),
          }
        ]
      };

      const result = await tonConnectUI.sendTransaction(transaction);
      
      // If transaction successful, try to whitelist the user
      if (result.boc) {
        try {
          const whitelistResult = await whitelistNewClient(userId, username, userFriendlyAddress);
          if (whitelistResult.success) {
            toast({
              title: "Success!",
              description: "You now have full access to all creators!",
            });
            return true;
          }
        } catch (error) {
          console.error("Error whitelisting user:", error);
          toast({
            title: "Warning",
            description: "Payment successful but access not granted. Please contact support.",
            variant: "destructive",
          });
        }
      }
      
      return false;

    } catch (error: any) {
      console.error("Error sending unlock payment:", error);
      
      if (error.message?.includes('scheme does not have a registered handler')) {
        toast({ 
          title: "TonKeeper not found",
          description: "Please install TonKeeper wallet to continue", 
          variant: "destructive" 
        });
        window.open('https://tonkeeper.com/', '_blank');
        return false;
      }

      toast({ 
        description: error.message || "Error sending payment. Please try again.", 
        variant: "destructive" 
      });
      return false;
    }
  };

  const sendStorePayment = async (amount: number): Promise<string | null> => {
    try {
      const result = await sendPayment(
        "Store Purchase",
        amount.toString(),
        "UQAdFe6F7DRQMQhJI2dUjKiMhU-oa5G9LNP8OAoWZ1LX2ILj",
        "store-payment"
      );
      return typeof result === 'string' ? result : null;
    } catch (error) {
      console.error('Error sending store payment:', error);
      return null;
    }
  };

  return { sendPayment, verifyPaymentStatus, sendGiveawayPayment, sendUnlockPayment, sendStorePayment };
};

export default useSendPayment;

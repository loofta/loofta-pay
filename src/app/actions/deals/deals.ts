"use server"



import { buildDealLink } from '@/lib/utils';
import db from '../../../firebase/firebase';
import { Campaign, CampaignStatus, ICreateDeal, IOngoingDealCardProps, IPastDealCardProps } from '@/app/utils/interfaces';


export async function createDeal({ id, title, points, walletAddress, description, paymentStatus, expectedDeliveryDate, recipientWalletAddress, recipientId, amount, senderTgId, senderTgUsername, recipientTgId, recipientTgUsername, campaignId }: ICreateDeal) {
  try {
      
   
    
      const dealId = id; 
      const newDeal = {
        title,
        walletAddress,
        description: description,
        dateCreated: Date.now(),
        paymentStatus,
        expectedDeliveryDate,
        dealId,
        recipientWalletAddress,
        recipientId,
        amount,
        campaignId,
        points,
        dealStatus: 'pending',
        senderTgId,
        senderTgUsername: senderTgUsername.toLowerCase(),
        recipientTgId,
        recipientTgUsername: recipientTgUsername.toLowerCase(),
      };
      console.log("Creating deal:", newDeal);
      await db.collection('deals').doc(dealId).set(newDeal);
  
      const uniqueLink = buildDealLink(dealId); 
  
      return { success: true, dealId, uniqueLink };
    } catch (error) {
      console.error("Error creating deal:", error);
      return { success: false, error: 'Error creating deal' };
    }
  }


  
  export async function getDeal(dealId: string) {
    try {
      const deal = await db.collection('deals').doc(dealId).get();
      if (!deal.exists) {
        console.error("Deal does not exist");
        return { success: false, error: 'Deal does not exist' };
      }
      return { success: true, deal: deal.data() };
    } catch (error) {
      console.error("Error getting deal:", error);
      return { success: false, error: 'Error getting deal' };
    }
  }

  export async function deleteDeal(dealId: string) {
    try {
      const deal = await db.collection('deals').doc(dealId).get();
      const deleted = await db.collection('deals').doc(dealId).delete();
      if (!deleted.writeTime) {
        console.error("Deal does not exist");
        return { success: false, error: 'Deal does not exist' };
      }
      return { success: true, deal: deal.data() };
    } catch (error) {
      console.error("Error getting deal:", error);
      return { success: false, error: 'Error getting deal' };
    }
  }


  export async function updateDealPaymentStatus(dealId: string, status: string, transactionHash?: string) {
    console.log('Attempting to update deal status for deal:', dealId);
    try {
        // Create the update object
        const updateData: any = { paymentStatus: status };

        // Add transactionHash only if it's not undefined
        if (transactionHash !== undefined) {
            updateData.transactionHash = transactionHash;
        }

        // Perform the update with the conditional data
        await db.collection('deals').doc(dealId).update(updateData);
        console.log('Deal status updated successfully');
        return { success: true };
    } catch (error) {
        console.error('Error updating deal status:', error);
        return { success: false, error: 'Error updating deal status' };
    }
  }
export async function updateDealStatus(dealId: string, status: string) {
  try {
    await db.collection('deals').doc(dealId).update({ dealStatus: status });
    return { success: true };
  } catch (error) {
    console.error('Error updating deal status:', error);
    return { success: false, error: 'Error updating deal status' };
  }
}

export async function updateDealTx(dealId: string, tx: any) {
  console.log('Attempting to update deal status for deal:', dealId);
  try {
      
    if(tx){
      await db.collection('deals').doc(dealId).update({ tx: tx });
      return { success: true };

    }

    return { success: false, error: 'Error updating deal tx' };


  } catch (error) {
      console.error('Error updating deal tx:', error);
      return { success: false, error: 'Error updating deal tx' };
  }
}

  export async function getRoleFromDeal(dealId: string, telegramHandle: string ) {
    try {
      const deal = await db.collection('deals').doc(dealId).get();

      if (!deal.exists) {
        console.error("Deal does not exist");
        return 'unknown';
      }
  
      const dealData = deal.data();
      if (dealData?.senderTgUsername === telegramHandle) {
        return 'client';
      } else if (dealData?.recipientTgUsername === telegramHandle) {
        return 'freelancer';
      }
  
      return 'unknown';
    } catch (error) {
      console.error("Error getting role from deal:", error);
      return 'unknown';
    }
  }

  export async function acceptDeal(dealId: string) {
    try {
      await db.collection('deals').doc(dealId).update({ dealStatus: 'ongoing' });
      return { success: true };
    } catch (error) {
      console.error("Error accepting deal:", error);
      return { success: false, error: 'Error accepting deal' };
    }
  }

  export async function declineDeal(dealId: string) {
    try {
      await db.collection('deals').doc(dealId).update({ dealStatus: 'declined' });
      return { success: true };
    } catch (error) {
      console.error("Error accepting deal:", error);
      return { success: false, error: 'Error accepting deal' };
    }
  }

  export async function updateDealPaymentStatusNoHash(dealId: string, status: string) {
    try {
      await db.collection('deals').doc(dealId).update({ paymentStatus: status });
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Error updating deal status' };
    }
  }

  export async function confirmDelivery(dealId: string, submission?: string) {
    try {
      const updateData: any = {
        dealStatus: 'done',
        confirmedDeliveryDate: Date.now()
      };

      if (submission) {
        updateData.submission = submission;
      }

      await db.collection('deals').doc(dealId).update(updateData);
      return { success: true };
    } catch (error) {
      console.error("Error confirming delivery:", error);
      return { success: false, error: 'Error confirming delivery' };
    }
  }


  export async function getOngoingDeals(senderTgId: number | null, senderTgUsername: string) {
    try {
      let combinedDeals: IOngoingDealCardProps[] = [];
  
      // If senderTgId is provided, fetch deals using it
      if (senderTgId) {
        const dealsByTgId = await db.collection('deals')
          .where('senderTgId', '==', senderTgId)
          .where('dealStatus', 'in', ['ongoing', 'pending', 'done'])
          .get();
  
        combinedDeals = dealsByTgId.docs.map(doc => doc.data() as IOngoingDealCardProps);
      }
  
      // If senderTgUsername is provided and senderTgId is empty or null, fetch deals using senderTgUsername
      if (senderTgUsername) {
        const dealsByTgUsername = await db.collection('deals')
          .where('senderTgUsername', '==', senderTgUsername)
          .where('dealStatus', 'in', ['ongoing', 'pending', 'done'])
          .get();
  
        const dealsFromUsername = dealsByTgUsername.docs.map(doc => doc.data() as IOngoingDealCardProps);
        combinedDeals = [...combinedDeals, ...dealsFromUsername]; // Combine results
      }
  
      // Optional: remove duplicates by deal ID
      const uniqueDeals = Array.from(
        new Map(
          combinedDeals
            .filter(deal => !(deal.dealStatus === 'done' && deal.paymentStatus === 'paid'))
            .map(deal => [deal.dealId, deal])
        ).values()
      );
      return { success: true, deals: uniqueDeals };
    } catch (error) {
      console.error("Error getting ongoing deals:", error);
      return { success: false, error: 'Error getting ongoing deals' };
    }
  }
  

  export async function getOngoingReceivedDeals(recipientTgId: number | null, recipientTgUsername: string) {
    try {
      let combinedDeals: IOngoingDealCardProps[] = [];
  
      // Fetch deals by recipientTgId if provided
      if (recipientTgId) {
        const dealsByTgId = await db.collection('deals')
          .where('recipientTgId', '==', recipientTgId)
          .where('dealStatus', 'in', ['ongoing', 'pending'])
          .get();
  
        combinedDeals = dealsByTgId.docs.map(doc => doc.data() as IOngoingDealCardProps);
      }
  
      // Fetch deals by recipientTgUsername if provided
      if (recipientTgUsername) {
        const dealsByTgUsername = await db.collection('deals')
          .where('recipientTgUsername', '==', recipientTgUsername)
          .where('dealStatus', 'in', ['ongoing', 'pending', 'done'])
          .get();
  
        const dealsFromUsername = dealsByTgUsername.docs.map(doc => doc.data() as IOngoingDealCardProps);
        combinedDeals = [...combinedDeals, ...dealsFromUsername];
      }
  
      const uniqueDeals = Array.from(
        new Map(
          combinedDeals
            .filter(deal => !(deal.dealStatus === 'done' && deal.paymentStatus === 'paid'))
            .map(deal => [deal.dealId, deal])
        ).values()
      );
      return { success: true, deals: uniqueDeals };
    } catch (error) {
      console.error("Error getting ongoing received deals:", error);
      return { success: false, error: 'Error getting ongoing received deals' };
    }
  }
  

export async function getPastReceivedDeals(recipientTgId: number | null, recipientTgUsername: string) {
  try {
    let combinedDeals: IPastDealCardProps[] = [];

    // Fetch deals by recipientTgId if provided
    if (recipientTgId) {
      const dealsByTgId = await db.collection('deals')
        .where('recipientTgId', '==', recipientTgId)
        .where('paymentStatus', '==', 'paid')
        .where('dealStatus', '==', 'done')
        .get();

      combinedDeals = dealsByTgId.docs.map(doc => doc.data() as IPastDealCardProps);
    }

    // Fetch deals by recipientTgUsername if provided
    if (recipientTgUsername) {
      const dealsByTgUsername = await db.collection('deals')
        .where('recipientTgUsername', '==', recipientTgUsername)
        .where('dealStatus', '==', 'done')
        .where('paymentStatus', '==', 'paid')
        .get();

      const dealsFromUsername = dealsByTgUsername.docs.map(doc => doc.data() as IPastDealCardProps);
      combinedDeals = [...combinedDeals, ...dealsFromUsername];
    }

    // Remove duplicates by dealId
    const uniqueDeals = Array.from(new Map(combinedDeals.map(deal => [deal.dealId, deal])).values());

    return { success: true, deals: uniqueDeals };
  } catch (error) {
    console.error("Error getting past received deals:", error);
    return { success: false, error: 'Error getting past received deals' };
  }
}


export async function getPastDeals(senderTgId: number | null, senderTgUsername: string) {
  try {
    let combinedDeals: IPastDealCardProps[] = [];

    // Fetch deals by senderTgId if provided
    if (senderTgId) {
      const dealsByTgId = await db.collection('deals')
        .where('senderTgId', '==', senderTgId)
        .where('dealStatus', '==', 'done')
        .where('paymentStatus', '==', 'paid')
        .get();

      combinedDeals = dealsByTgId.docs.map(doc => doc.data() as IPastDealCardProps);
    }

    // Fetch deals by senderTgUsername if provided
    if (senderTgUsername) {
      const dealsByTgUsername = await db.collection('deals')
        .where('senderTgUsername', '==', senderTgUsername)
        .where('dealStatus', '==', 'done')
        .where('paymentStatus', '==', 'paid')
        .get();

      const dealsFromUsername = dealsByTgUsername.docs.map(doc => doc.data() as IPastDealCardProps);
      combinedDeals = [...combinedDeals, ...dealsFromUsername];
    }

    // Remove duplicates by dealId
    const uniqueDeals = Array.from(new Map(combinedDeals.map(deal => [deal.dealId, deal])).values());



    return { success: true, deals: uniqueDeals };
  } catch (error) {
    console.error("Error getting past deals:", error);
    return { success: false, error: 'Error getting past deals' };
  }
}




export async function getTotalSpent(senderTgId: number | null, senderTgUsername: string) {
  try {
    let totalSpent = 0;
    const uniqueDealIds = new Set<string>(); // Store unique deal IDs to avoid duplicates

    // Fetch total spent by senderTgId if provided
    if (senderTgId) {
      const dealsByTgId = await db.collection('deals')
        .where('senderTgId', '==', senderTgId)
        .where('dealStatus', '==', 'done')
        .where('paymentStatus', '==', 'paid')
        .get();

      dealsByTgId.docs.forEach((doc) => {
        const dealData = doc.data();
        if (!uniqueDealIds.has(doc.id)) {
          uniqueDealIds.add(doc.id);
          totalSpent += dealData.amount || 0; // Add deal amount if unique
        }
      });
    }

    // Fetch total spent by senderTgUsername if provided
    if (senderTgUsername) {
      const dealsByTgUsername = await db.collection('deals')
        .where('senderTgUsername', '==', senderTgUsername)
        .where('dealStatus', '==', 'done')
        .where('paymentStatus', '==', 'paid')
        .get();

      dealsByTgUsername.docs.forEach((doc) => {
        const dealData = doc.data();
        if (!uniqueDealIds.has(doc.id)) {
          uniqueDealIds.add(doc.id);
          totalSpent += dealData.amount || 0; // Add deal amount if unique
        }
      });
    }
    console.log('total spent', totalSpent)
    return { success: true, totalSpent: totalSpent.toFixed(1) };
  } catch (error) {
    console.error("Error getting total spent:", error);
    return { success: false, error: 'Error getting total spent' };
  }
}



  export async function updateTelegramRecipientInformation(dealId: string, recipientTgId: number, recipientTgUsername: string) {
    try {
      await db.collection('deals').doc(dealId).update({ recipientTgId, recipientTgUsername });
      return { success: true };
    } catch (error) {
      console.error("Error updating telegram receipment information:", error);
      return { success: false, error: 'Error updating telegram receipment information' };
    }
  }

